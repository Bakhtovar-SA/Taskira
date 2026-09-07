/** Спринты (опциональный модуль): список, старт, завершение. */
import type { FastifyInstance } from "fastify";
import { one, q } from "../db.js";
import { notFound, requirePerm } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { audit } from "../audit.js";
import { mapSprint, type SprintRow } from "../services/sprints.js";

export async function sprintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, async (req) => {
    const project = req.project!;
    const rows = await q<SprintRow>(`SELECT * FROM sprints WHERE project_id = $1 ORDER BY created_at`, [project.id]);
    return rows.map(mapSprint);
  });

  /** Активировать ближайший будущий спринт; если будущего нет — создать активный. */
  app.post("/start", { preHandler: requirePerm("manageSprints") }, async (req, reply) => {
    const project = req.project!;
    const user = req.user;

    const future = await one<SprintRow>(
      `SELECT * FROM sprints WHERE project_id = $1 AND status = 'future' ORDER BY created_at LIMIT 1`,
      [project.id],
    );

    let row: SprintRow;
    if (future) {
      row = (
        await q<SprintRow>(
          `UPDATE sprints SET status = 'active', start_date = CURRENT_DATE, end_date = CURRENT_DATE + 14
            WHERE id = $1 RETURNING *`,
          [future.id],
        )
      )[0];
    } else {
      const cnt = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM sprints WHERE project_id = $1`, [project.id]))!;
      row = (
        await q<SprintRow>(
          `INSERT INTO sprints (project_id, name, goal, status, start_date, end_date)
           VALUES ($1, $2, '', 'active', CURRENT_DATE, CURRENT_DATE + 14)
           RETURNING *`,
          [project.id, `Спринт ${Number(cnt.n) + 1}`],
        )
      )[0];
    }

    await audit(user.sub, "sprint.start", "sprint", row.id, { name: row.name });
    reply.code(201).send(mapSprint(row));
  });

  /** Завершить активный спринт: недозакрытые задачи → sprint_id = NULL, создаётся следующий будущий. */
  app.post("/:id/complete", { preHandler: requirePerm("manageSprints") }, async (req) => {
    const project = req.project!;
    const user = req.user;
    const { id } = req.params as { id: string };

    const sprint = await one<SprintRow>(`SELECT * FROM sprints WHERE id = $1 AND project_id = $2`, [id, project.id]);
    if (!sprint) throw notFound("Спринт не найден");
    if (sprint.status !== "active") throw conflict("Спринт не активен — завершать нечего");

    // Недозакрытые (статус не в категории done) возвращаются в бэклог
    const moved = await q<{ n: string }>(
      `WITH undone AS (
         SELECT i.id FROM issues i
           JOIN workflow_statuses ws ON ws.id = i.status_id
          WHERE i.sprint_id = $1 AND ws.category <> 'done'
       )
       UPDATE issues SET sprint_id = NULL, updated_at = now()
        WHERE id IN (SELECT id FROM undone)
       RETURNING 1 AS n`,
      [sprint.id],
    );

    const completed = (await q<SprintRow>(`UPDATE sprints SET status = 'completed' WHERE id = $1 RETURNING *`, [sprint.id]))[0];

    const cnt = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM sprints WHERE project_id = $1`, [project.id]))!;
    const next = (
      await q<SprintRow>(
        `INSERT INTO sprints (project_id, name, goal, status, start_date, end_date)
         VALUES ($1, $2, '', 'future', CURRENT_DATE + 15, CURRENT_DATE + 28)
         RETURNING *`,
        [project.id, `Спринт ${Number(cnt.n) + 1}`],
      )
    )[0];

    await audit(user.sub, "sprint.complete", "sprint", sprint.id, { name: sprint.name, unfinished: moved.length });
    return { completed: mapSprint(completed), next: mapSprint(next), unfinished: moved.length };
  });
}
