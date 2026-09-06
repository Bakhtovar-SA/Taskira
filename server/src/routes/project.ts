/** GET /api/project — bootstrap приложения: проект, активные пользователи, workflow, спринты.
    Деактивированные пользователи здесь не отдаются (они видны админу в GET /api/users). */
import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requirePerm } from "../middleware.js";
import { safeUser, type UserRow } from "../auth.js";
import { currentProject } from "../services/project.js";
import { getWorkflow } from "../services/workflow.js";
import { mapSprint, type SprintRow } from "../services/sprints.js";

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/project",
    { preHandler: requirePerm("browse") },
    async () => {
      const project = await currentProject();
      const users = (await q<UserRow>(`SELECT * FROM users WHERE is_active = true ORDER BY name`, [])).map(safeUser);
      const workflow = await getWorkflow(project.id);
      const sprints = (
        await q<SprintRow>(`SELECT * FROM sprints WHERE project_id = $1 ORDER BY created_at`, [project.id])
      ).map(mapSprint);
      return { project, users, workflow, sprints };
    },
  );
}
