/** Главный экран: задачи, назначенные текущему пользователю, по ВСЕМ видимым
 *  проектам. Project-less — регистрируется на уровне /api (UI_RESTRUCTURE.md D4).
 *  Открытие задачи идёт обычным путём GET /api/projects/:projectId/issues/:id. */
import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requireAuth, type JwtPayload } from "../middleware.js";

interface Row {
  issue_id: string;
  project_id: string;
  key: string;
  title: string;
  priority_id: string;
  status_id: string;
  status_name: string;
  status_category: string;
  project_key: string;
  project_name: string;
}

export async function homeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/issues/assigned-to-me", { preHandler: requireAuth }, async (req) => {
    const user: JwtPayload = req.user;
    const isGlobalAdmin = user.globalRole === "admin";

    // Открытые (категория статуса <> 'done') задачи, где assignee = me,
    // в проектах, которые пользователь может browse. Предикат видимости
    // ОБЯЗАН совпадать с services/projects.ts listVisibleProjects
    // (участник ∪ департамент ∪ is_shared ∪ глобальный admin), иначе экран
    // покажет задачи из проектов, которые потом не открыть.
    const rows = await q<Row>(
      `SELECT i.id AS issue_id, i.project_id, i.key, i.title, i.priority_id, i.status_id,
              ws.name AS status_name, ws.category AS status_category,
              p.key AS project_key, p.name AS project_name
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         JOIN workflow_statuses ws ON ws.id = i.status_id
        WHERE i.assignee_id = $1
          AND ws.category <> 'done'
          AND ($2
               OR EXISTS (SELECT 1 FROM project_members pm
                           WHERE pm.project_id = p.id AND pm.user_id = $1)
               OR EXISTS (SELECT 1 FROM department_members dm
                           WHERE dm.department_id = p.department_id AND dm.user_id = $1)
               OR p.is_shared)
        ORDER BY array_position(ARRAY['highest','high','medium','low','lowest']::text[], i.priority_id),
                 i.updated_at DESC`,
      [user.sub, isGlobalAdmin],
    );

    return rows.map((r) => ({
      issueId: r.issue_id,
      projectId: r.project_id,
      key: r.key,
      title: r.title,
      priorityId: r.priority_id,
      statusId: r.status_id,
      statusName: r.status_name,
      statusCategory: r.status_category,
      projectKey: r.project_key,
      projectName: r.project_name,
    }));
  });
}
