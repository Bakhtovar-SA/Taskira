/** Схема рабочего процесса: чтение (все), правка переходов (admin). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, notFound, requirePerm, zbody, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import { conflict, DEFAULT_TRANSITIONS, getWorkflow, statusName } from "../services/workflow.js";
import { TransitionCreateBody } from "../contract.js";

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, async (req) => {
    const project = req.project!;
    const wf = await getWorkflow(project.id);
    const counts = await q<{ status_id: string; n: string }>(
      `SELECT status_id, count(*)::text AS n FROM issues WHERE project_id = $1 GROUP BY status_id`,
      [project.id],
    );
    const issueCounts: Record<string, number> = {};
    for (const c of counts) issueCounts[c.status_id] = Number(c.n);
    return { ...wf, issueCounts };
  });

  app.post(
    "/transitions",
    { preHandler: requirePerm("editWorkflow"), preValidation: zbody(TransitionCreateBody) },
    async (req, reply) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const body = req.body as z.infer<typeof TransitionCreateBody>;

      if (body.from === body.to) throw badRequest("Статусы «из» и «в» совпадают");
      const statuses = await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1`, [project.id]);
      const known = new Set(statuses.map((s) => s.id));
      if (!known.has(body.from) || !known.has(body.to)) throw badRequest("Статус не найден в проекте");

      const dup = await one<{ id: string }>(
        `SELECT id FROM workflow_transitions
          WHERE project_id = $1 AND from_status_id = $2 AND to_status_id = $3`,
        [project.id, body.from, body.to],
      );
      if (dup) throw conflict("Такой переход уже есть в схеме");

      const row = (
        await q<{ id: string; from_status_id: string; to_status_id: string }>(
          `INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id)
           VALUES ($1, $2, $3) RETURNING id, from_status_id, to_status_id`,
          [project.id, body.from, body.to],
        )
      )[0];

      const [from, to] = [await statusName(body.from), await statusName(body.to)];
      await audit(user.sub, "workflow.transition.add", "workflow", row.id, { from, to });
      reply.code(201).send(row);
    },
  );

  app.delete("/transitions/:id", { preHandler: requirePerm("editWorkflow") }, async (req, reply) => {
    const project = req.project!;
    const user: JwtPayload = req.user;
    const { id } = req.params as { id: string };

    const row = await one<{ id: string; from_status_id: string; to_status_id: string }>(
      `SELECT id, from_status_id, to_status_id FROM workflow_transitions WHERE id = $1 AND project_id = $2`,
      [id, project.id],
    );
    if (!row) throw notFound("Переход не найден");
    await q(`DELETE FROM workflow_transitions WHERE id = $1`, [row.id]);

    const [from, to] = [await statusName(row.from_status_id), await statusName(row.to_status_id)];
    await audit(user.sub, "workflow.transition.remove", "workflow", row.id, { from, to });
    reply.code(204).send();
  });

  /** Сброс переходов к дефолтному графу. Статусы не трогаются никогда —
      на них могут ссылаться существующие задачи; сбрасываются только рёбра. */
  app.post("/reset", { preHandler: requirePerm("editWorkflow") }, async (req) => {
    const project = req.project!;
    const user: JwtPayload = req.user;

    const statuses = await q<{ id: string; sid: string }>(
      `SELECT id, sid FROM workflow_statuses WHERE project_id = $1`,
      [project.id],
    );
    const bySid = new Map(statuses.map((s) => [s.sid, s.id]));

    await q(`DELETE FROM workflow_transitions WHERE project_id = $1`, [project.id]);
    for (const [fromSid, toSid] of DEFAULT_TRANSITIONS) {
      const fromId = bySid.get(fromSid);
      const toId = bySid.get(toSid);
      if (!fromId || !toId) continue; // статус удалён/переименован — ребро пропускается
      await q(
        `INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES ($1, $2, $3)`,
        [project.id, fromId, toId],
      );
    }

    await audit(user.sub, "workflow.reset", "workflow", null, {});
    return getWorkflow(project.id);
  });
}
