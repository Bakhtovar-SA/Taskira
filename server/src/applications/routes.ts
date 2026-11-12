import type { FastifyInstance } from "fastify";
import { q, withTransaction } from "../db.js";
import { requireGlobalAdmin, requireSession, zbody } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { ApplicationsPatchBody, type ApplicationsDto } from "../applicationContract.js";
import { listVisibleProjects } from "../services/projects.js";
import { APPLICATIONS, applicationSettings } from "./registry.js";

async function catalogue(userId: string, admin: boolean): Promise<ApplicationsDto> {
  const settings = await applicationSettings();
  const projects = await listVisibleProjects(userId, admin);
  const available = await q<{ id: string; knowledge: boolean; objects: boolean }>(
    `SELECT p.id, (coalesce(m.documents,false) OR EXISTS(SELECT 1 FROM workspace_documents d WHERE d.project_id=p.id)) knowledge,
     (coalesce(m.objects,false) OR EXISTS(SELECT 1 FROM workspace_objects o WHERE o.project_id=p.id)) objects
     FROM projects p LEFT JOIN workspace_modules m ON m.project_id=p.id WHERE p.id=ANY($1::uuid[])`,
    [projects.map(project => project.id)],
  );
  return {
    revision: settings.revision,
    canManage: admin,
    applications: APPLICATIONS.map(({ id }) => ({
      id, enabled: settings[id],
      projectIds: projects.filter(project => id === "work" || available.some(row => row.id === project.id && row[id])).map(project => project.id),
    })),
  };
}

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/applications", { preHandler: requireSession }, req => catalogue(req.user.sub, req.user.globalRole === "admin"));
  app.patch("/applications", { preHandler: requireGlobalAdmin, preValidation: zbody(ApplicationsPatchBody) }, async req => {
    const body = req.body as ApplicationsPatchBody;
    await withTransaction(async client => {
      const rows = (await client.query<{ revision: number }>(
        `UPDATE application_settings SET work=$2,knowledge=$3,objects=$4,revision=revision+1,updated_by=$5,updated_at=now()
         WHERE singleton AND revision=$1 RETURNING revision`,
        [body.revision, body.enabled.work, body.enabled.knowledge, body.enabled.objects, req.user.sub],
      )).rows;
      if (!rows.length) throw new ApiHttpError(409, "CONFLICT", "Настройки приложений изменились. Обновите их и повторите действие");
      await client.query(`INSERT INTO audit_log(actor_id,action,entity,details,result) VALUES($1,'applications.changed','applications',$2::jsonb,'success')`,
        [req.user.sub, JSON.stringify({ revision: rows[0].revision, enabled: body.enabled })]);
    });
    return catalogue(req.user.sub, true);
  });
}
