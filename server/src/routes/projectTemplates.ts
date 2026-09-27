/** Шаблоны проектов (ТЗ 5.10).
 *
 *  GET    /api/project-templates                          — встроенные + шаблоны организации   [global admin]
 *  POST   /api/projects/:projectId/save-as-template       — снимок проекта в шаблон организации [saveProjectTemplate]
 *  DELETE /api/project-templates/:templateId              — удалить шаблон организации          [global admin]
 *
 *  Создание проекта из шаблона — POST /api/projects с `templateId` (routes/projects.ts). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, notFound, requireGlobalAdmin, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { listProjectTemplates, snapshotProject } from "../services/projectTemplates.js";
import { audit } from "../audit.js";
import { ProjectParams, ProjectTemplateParams, SaveProjectTemplateBody, type ProjectTemplateDto } from "../contract.js";

export async function projectTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/project-templates", { preHandler: requireGlobalAdmin }, async (): Promise<ProjectTemplateDto[]> => listProjectTemplates());

  app.post(
    "/projects/:projectId/save-as-template",
    { preHandler: requirePerm("saveProjectTemplate"), preValidation: [zparams(ProjectParams), zbody(SaveProjectTemplateBody)] },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const project = req.project!;
      const body = req.body as z.infer<typeof SaveProjectTemplateBody>;
      const snap = await snapshotProject(project.id);
      if (!snap.success) throw badRequest(`Проект нельзя сохранить как шаблон: ${snap.error.issues[0]?.message ?? "неверная конфигурация"}`);
      let row: { id: string } | null;
      try {
        row = await one<{ id: string }>(
          `INSERT INTO project_templates (name, description, spec, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
          [body.name, body.description, JSON.stringify(snap.data), actor.sub],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Шаблон с таким названием уже есть");
        throw e;
      }
      await audit(actor.sub, "projectTemplate.create", "project_template", row!.id, { fromProject: project.id, name: body.name });
      const dto: ProjectTemplateDto = { id: row!.id, name: body.name, description: body.description, builtin: false, spec: snap.data };
      reply.code(201).send(dto);
    },
  );

  app.delete(
    "/project-templates/:templateId",
    { preHandler: requireGlobalAdmin, preValidation: zparams(ProjectTemplateParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { templateId } = req.params as z.infer<typeof ProjectTemplateParams>;
      const rows = await q<{ id: string }>(`DELETE FROM project_templates WHERE id = $1 RETURNING id`, [templateId]);
      if (!rows.length) throw notFound("Шаблон не найден");
      await audit(actor.sub, "projectTemplate.delete", "project_template", templateId, {});
      reply.code(204).send();
    },
  );
}
