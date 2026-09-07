/** «Мои подключения»: задачи, к которым пользователь приглашён (issue_collaborators),
 *  через все проекты. Project-less — регистрируется на уровне /api (COLLAB_MIGRATION.md
 *  Фаза 6). Даёт минимум для списка; сама задача открывается через
 *  GET /api/projects/:projectId/issues/:id (fallback приглашённого, Фаза 2). */
import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requireAuth, type JwtPayload } from "../middleware.js";

interface Row {
  issue_id: string;
  project_id: string;
  key: string;
  title: string;
  status_id: string;
  status_name: string;
  status_category: string;
  project_key: string;
  project_name: string;
}

export async function collaboratingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/issues/collaborating", { preHandler: requireAuth }, async (req) => {
    const user: JwtPayload = req.user;
    // Только задачи в проектах, к которым у пользователя НЕТ ролевого доступа:
    // глобальный admin и участник проекта видят задачу обычным путём (доска/бэклог),
    // дублировать её в «Моих подключениях» незачем (auto-review PR #13 C1).
    const rows = await q<Row>(
      `SELECT i.id AS issue_id, i.project_id, i.key, i.title, i.status_id,
              ws.name AS status_name, ws.category AS status_category,
              p.key AS project_key, p.name AS project_name
         FROM issue_collaborators ic
         JOIN issues i  ON i.id = ic.issue_id
         JOIN projects p ON p.id = i.project_id
         JOIN workflow_statuses ws ON ws.id = i.status_id
         JOIN users u ON u.id = ic.user_id
        WHERE ic.user_id = $1
          AND u.global_role <> 'admin'
          AND NOT EXISTS (
                SELECT 1 FROM project_members pm
                 WHERE pm.project_id = i.project_id AND pm.user_id = $1
              )
        ORDER BY p.name, i.num`,
      [user.sub],
    );
    return rows.map((r) => ({
      issueId: r.issue_id,
      projectId: r.project_id,
      key: r.key,
      title: r.title,
      statusId: r.status_id,
      statusName: r.status_name,
      statusCategory: r.status_category,
      projectKey: r.project_key,
      projectName: r.project_name,
    }));
  });
}
