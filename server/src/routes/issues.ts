/**
 * Задачи: CRUD, смена статуса по workflow, перенос по спринтам, подписка (watchers).
 * Все мутации защищены правами на сервере; ранги и переходы — только после проверок.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import {
  badRequest,
  forbidden,
  notFound,
  requireIssuePerm,
  requirePerm,
  zbody,
  zquery,
  type JwtPayload,
} from "../middleware.js";
import { roleDenialReason, roleHas } from "../permissions.js";
import { audit } from "../audit.js";
import { currentProject } from "../services/project.js";
import { assertTransition, statusName } from "../services/workflow.js";
import { computeRank } from "../services/rank.js";
import { getIssueDto, loadIssue, logActivity, mapIssue, nextIssueNum, type IssueRow } from "../services/issues.js";
import {
  IssueCreateBody,
  IssuePatchBody,
  IssueQuery,
  MoveToSprintBody,
  TransitionBody,
} from "../contract.js";

const PRIORITY_NAMES: Record<string, string> = {
  highest: "Высший",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  lowest: "Низший",
};

const escLike = (s: string) => s.replace(/[%_\\]/g, "\\$&");

const me = (req: { user: JwtPayload }) => req.user;

export async function issuesRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------- список с фильтрами */
  app.get(
    "/",
    { preHandler: [requirePerm("browse"), zquery(IssueQuery)] },
    async (req, reply) => {
      const project = await currentProject();
      const f = req.query as z.infer<typeof IssueQuery>;

      const clauses: string[] = ["i.project_id = $1"];
      const params: unknown[] = [project.id];
      const add = (clause: string, ...vals: unknown[]) => {
        for (const v of vals) {
          params.push(v);
          clause = clause.replace("?", `$${params.length}`);
        }
        clauses.push(clause);
      };

      if (f.status) add("i.status_id = ?", f.status);
      if (f.sprint) add("i.sprint_id = ?", f.sprint);
      if (f.assignee) add("i.assignee_id = ?", f.assignee);
      if (f.type) add("i.type_id = ?", f.type);
      if (f.q) add("(i.title ILIKE ? OR i.key ILIKE ?)", `%${escLike(f.q)}%`, `%${escLike(f.q)}%`);
      if (f.dueFrom) add("i.due_date >= ?", f.dueFrom);
      if (f.dueTo) add("i.due_date <= ?", f.dueTo);
      if (f.overdue) clauses.push("i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND ws.category <> 'done'");

      const where = clauses.join(" AND ");
      const total = (
        await one<{ n: string }>(
          `SELECT count(*)::text AS n FROM issues i
             JOIN workflow_statuses ws ON ws.id = i.status_id
            WHERE ${where}`,
          params,
        )
      )!;
      params.push(f.limit, f.offset);
      const rows = await q<IssueRow>(
        `SELECT i.* FROM issues i
           JOIN workflow_statuses ws ON ws.id = i.status_id
          WHERE ${where}
          ORDER BY i.rank, i.id
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      reply.send({ items: rows.map(mapIssue), total: Number(total.n) });
    },
  );

  /* ---------------------------------------------------------- создание */
  app.post(
    "/",
    { preHandler: requirePerm("create"), preValidation: zbody(IssueCreateBody) },
    async (req, reply) => {
      const project = await currentProject();
      const body = req.body as z.infer<typeof IssueCreateBody>;
      const user = me(req);

      // Статус: заданный клиентом (с проверкой) или первый из категории todo
      let statusId = body.statusId ?? null;
      if (statusId) {
        const known = await one<{ id: string }>(
          `SELECT id FROM workflow_statuses WHERE id = $1 AND project_id = $2`,
          [statusId, project.id],
        );
        if (!known) throw badRequest("Статус не найден в проекте");
      } else {
        const first = await one<{ id: string }>(
          `SELECT id FROM workflow_statuses
            WHERE project_id = $1 AND category = 'todo'
            ORDER BY position LIMIT 1`,
          [project.id],
        );
        if (!first) throw notFound("В проекте нет статуса категории «todo» — проверьте workflow");
        statusId = first.id;
      }

      if (body.assigneeId) {
        const u = await one<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND is_active`, [body.assigneeId]);
        if (!u) throw badRequest("Исполнитель не найден");
      }
      if (body.epicId) {
        const e = await one<{ id: string }>(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [body.epicId, project.id]);
        if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
      }
      if (body.sprintId) {
        const s = await one<{ id: string }>(`SELECT id FROM sprints WHERE id = $1 AND project_id = $2`, [body.sprintId, project.id]);
        if (!s) throw badRequest("Спринт не найден в проекте");
      }

      const rank = await computeRank(statusId, null);
      const num = await nextIssueNum(project.id);
      const key = `${project.key}-${num}`;

      const row = (
        await q<IssueRow>(
          `INSERT INTO issues
             (project_id, num, key, title, description, type_id, status_id, priority_id,
              assignee_id, reporter_id, epic_id, labels, points, sprint_id, due_date, rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [
            project.id, num, key, body.title, body.description, body.typeId, statusId, body.priorityId,
            body.assigneeId, user.sub, body.epicId, body.labels, body.points, body.sprintId,
            body.dueDate ?? null, rank,
          ],
        )
      )[0];

      await logActivity(row.id, user.sub, "создал(а) задачу");
      await audit(user.sub, "issue.create", "issue", row.id, { key });
      reply.code(201).send(mapIssue(row));
    },
  );

  /* ---------------------------------------------------------- чтение одной */
  app.get("/:id", { preHandler: requirePerm("browse") }, async (req) => {
    const project = await currentProject();
    const { id } = req.params as { id: string };
    return getIssueDto(project.id, id);
  });

  /* ---------------------------------------------------------- правка полей */
  app.patch(
    "/:id",
    { preHandler: requireIssuePerm("edit"), preValidation: zbody(IssuePatchBody) },
    async (req) => {
      const project = await currentProject();
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof IssuePatchBody>;
      const iss = await loadIssue(project.id, id);

      // Перенос по спринтам — отдельное право manageSprints.
      // req.projectRole выставлен requireIssuePerm("edit") для проекта этой задачи.
      if (body.sprintId !== undefined && body.sprintId !== iss.sprint_id) {
        if (!req.projectRole || !roleHas(req.projectRole, "manageSprints")) {
          await audit(user.sub, "access.denied", "manageSprints", iss.id, {
            path: req.url,
            method: req.method,
            projectId: project.id,
          });
          throw forbidden(roleDenialReason(req.projectRole ?? null, "manageSprints"));
        }
        if (body.sprintId !== null) {
          const s = await one<{ id: string }>(`SELECT id FROM sprints WHERE id = $1 AND project_id = $2`, [body.sprintId, project.id]);
          if (!s) throw badRequest("Спринт не найден в проекте");
        }
      }
      if (body.assigneeId !== undefined && body.assigneeId !== null) {
        const u = await one<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND is_active`, [body.assigneeId]);
        if (!u) throw badRequest("Исполнитель не найден");
      }
      if (body.epicId !== undefined && body.epicId !== null) {
        const e = await one<{ id: string }>(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [body.epicId, project.id]);
        if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => {
        vals.push(val);
        sets.push(`${col} = $${vals.length}`);
      };
      const log: string[] = [];

      if (body.title !== undefined && body.title !== iss.title) {
        push("title", body.title);
        log.push("переименовал(а) задачу");
      }
      if (body.description !== undefined && body.description !== iss.description) {
        push("description", body.description);
        log.push("обновил(а) описание");
      }
      if (body.priorityId !== undefined && body.priorityId !== iss.priority_id) {
        push("priority_id", body.priorityId);
        log.push(`изменил(а) приоритет: ${PRIORITY_NAMES[iss.priority_id]} → ${PRIORITY_NAMES[body.priorityId]}`);
      }
      if (body.assigneeId !== undefined && body.assigneeId !== iss.assignee_id) {
        push("assignee_id", body.assigneeId);
        if (body.assigneeId) {
          const u = await one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [body.assigneeId]);
          log.push(`назначил(а) исполнителем ${u?.name ?? "?"}`);
        } else {
          log.push("снял(а) исполнителя");
        }
      }
      if (body.epicId !== undefined && body.epicId !== iss.epic_id) {
        push("epic_id", body.epicId);
        log.push("изменил(а) группу (эпик)");
      }
      if (body.labels !== undefined && JSON.stringify(body.labels) !== JSON.stringify(iss.labels)) {
        push("labels", body.labels);
        log.push("обновил(а) метки");
      }
      if (body.points !== undefined && body.points !== iss.points) {
        push("points", body.points);
        log.push(`изменил(а) оценку: ${iss.points ?? "—"} → ${body.points ?? "—"}`);
      }
      if (body.sprintId !== undefined && body.sprintId !== iss.sprint_id) {
        push("sprint_id", body.sprintId);
        if (body.sprintId) {
          const s = await one<{ name: string }>(`SELECT name FROM sprints WHERE id = $1`, [body.sprintId]);
          log.push(`переместил(а) в ${s?.name ?? "?"}`);
        } else {
          log.push("вернул(а) в бэклог");
        }
      }
      if (body.dueDate !== undefined && body.dueDate !== iss.due_date) {
        push("due_date", body.dueDate);
        log.push(`изменил(а) срок: ${iss.due_date ?? "—"} → ${body.dueDate ?? "—"}`);
      }
      if (body.tStart !== undefined) push("t_start", body.tStart);
      if (body.tSpan !== undefined) push("t_span", body.tSpan);
      if (body.color !== undefined) push("color", body.color);

      if (sets.length === 0) return mapIssue(iss);

      vals.push(iss.id);
      const row = (
        await q<IssueRow>(
          `UPDATE issues SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
          vals,
        )
      )[0];

      for (const text of log) await logActivity(iss.id, user.sub, text);
      await audit(user.sub, "issue.update", "issue", iss.id, { key: iss.key, fields: Object.keys(body) });
      return mapIssue(row);
    },
  );

  /* ---------------------------------------------------------- удаление */
  app.delete(
    "/:id",
    { preHandler: requireIssuePerm("delete") },
    async (req, reply) => {
      const project = await currentProject();
      const { id } = req.params as { id: string };
      const user = me(req);
      const iss = await loadIssue(project.id, id);
      // Каскады: комментарии/activity/watchers; epic_id дочерних обнулится FK
      await q(`DELETE FROM issues WHERE id = $1`, [iss.id]);
      await audit(user.sub, "issue.delete", "issue", iss.id, { key: iss.key });
      reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------- смена статуса (workflow + ранг) */
  app.post(
    "/:id/transition",
    { preHandler: requireIssuePerm("transition"), preValidation: zbody(TransitionBody) },
    async (req) => {
      const project = await currentProject();
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof TransitionBody>;
      const iss = await loadIssue(project.id, id);

      if (body.beforeId) {
        const anchor = await one<{ status_id: string }>(`SELECT status_id FROM issues WHERE id = $1`, [body.beforeId]);
        if (!anchor) throw notFound("Задача-ориентир (beforeId) не найдена");
        if (anchor.status_id !== body.to) throw badRequest("Позиция «перед» указывает на задачу из другой колонки");
      }

      // Схема workflow — источник правды; нарушение даёт 409 CONFLICT
      await assertTransition(project.id, iss.status_id, body.to);

      const rank = await computeRank(body.to, body.beforeId ?? null, iss.id);
      const changed = iss.status_id !== body.to;
      const row = (
        await q<IssueRow>(
          `UPDATE issues SET status_id = $1, rank = $2, updated_at = now() WHERE id = $3 RETURNING *`,
          [body.to, rank, iss.id],
        )
      )[0];

      if (changed) {
        const [from, to] = [await statusName(iss.status_id), await statusName(body.to)];
        await logActivity(iss.id, user.sub, `переместил(а) из «${from}» в «${to}»`);
      }
      await audit(user.sub, "issue.transition", "issue", iss.id, { key: iss.key, from: iss.status_id, to: body.to });
      return mapIssue(row);
    },
  );

  /* ---------------------------------------------------------- перенос между спринтом и бэклогом */
  app.patch(
    "/:id/sprint",
    { preHandler: requirePerm("manageSprints"), preValidation: zbody(MoveToSprintBody) },
    async (req) => {
      const project = await currentProject();
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof MoveToSprintBody>;
      const iss = await loadIssue(project.id, id);

      if (body.sprintId !== null) {
        const s = await one<{ id: string }>(`SELECT id FROM sprints WHERE id = $1 AND project_id = $2`, [body.sprintId, project.id]);
        if (!s) throw badRequest("Спринт не найден в проекте");
      }
      if (body.sprintId === iss.sprint_id) return mapIssue(iss);

      const row = (
        await q<IssueRow>(`UPDATE issues SET sprint_id = $1, updated_at = now() WHERE id = $2 RETURNING *`, [body.sprintId, iss.id])
      )[0];
      const sName = body.sprintId ? (await one<{ name: string }>(`SELECT name FROM sprints WHERE id = $1`, [body.sprintId]))?.name : null;
      await logActivity(iss.id, user.sub, sName ? `переместил(а) в ${sName}` : "вернул(а) в бэклог");
      await audit(user.sub, "issue.sprint.move", "issue", iss.id, { key: iss.key, sprintId: body.sprintId });
      return mapIssue(row);
    },
  );

  /* ---------------------------------------------------------- подписка на задачу */
  app.post("/:id/watchers/me", { preHandler: requirePerm("browse") }, async (req) => {
    const project = await currentProject();
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    await q(`INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [iss.id, user.sub]);
    const n = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM issue_watchers WHERE issue_id = $1`, [iss.id]))!;
    await audit(user.sub, "watcher.add", "issue", iss.id, { key: iss.key });
    return { watching: true, watchers: Number(n.n) };
  });

  app.delete("/:id/watchers/me", { preHandler: requirePerm("browse") }, async (req) => {
    const project = await currentProject();
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    await q(`DELETE FROM issue_watchers WHERE issue_id = $1 AND user_id = $2`, [iss.id, user.sub]);
    const n = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM issue_watchers WHERE issue_id = $1`, [iss.id]))!;
    await audit(user.sub, "watcher.remove", "issue", iss.id, { key: iss.key });
    return { watching: false, watchers: Number(n.n) };
  });
}


