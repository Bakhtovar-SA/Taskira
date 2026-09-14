/** Шаблоны задач проекта: чтение (все), правка (editWorkflow — та же
 *  «структурная схема проекта», что workflow/custom-fields; см. миграцию 022).
 *  Применение шаблона — client-side prefill формы создания, не роут. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import {
  countIssueTemplates,
  createIssueTemplate,
  deleteIssueTemplate,
  getIssueTemplateInProject,
  listIssueTemplates,
  updateIssueTemplate,
} from "../services/issueTemplates.js";
import { IssueTemplateBody, IssueTemplateParams, LIMITS } from "../contract.js";
import { one } from "../db.js";

export async function issueTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, async (req) => {
    return listIssueTemplates(req.project!.id);
  });

  async function assertStatusInProject(projectId: string, statusId: string | null | undefined): Promise<string | null> {
    if (!statusId) return null;
    const st = await one<{ id: string }>(`SELECT id FROM workflow_statuses WHERE id = $1 AND project_id = $2`, [statusId, projectId]);
    if (!st) throw notFound("Статус не найден в проекте");
    return statusId;
  }

  app.post(
    "/",
    { preHandler: requirePerm("editWorkflow"), preValidation: zbody(IssueTemplateBody) },
    async (req, reply) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const body = req.body as z.infer<typeof IssueTemplateBody>;

      if ((await countIssueTemplates(project.id)) >= LIMITS.issueTemplatesPerProject) {
        throw badRequest(`В проекте не может быть больше ${LIMITS.issueTemplatesPerProject} шаблонов`);
      }
      const existing = await listIssueTemplates(project.id);
      if (existing.some((t) => t.name.toLowerCase() === body.name.toLowerCase())) {
        throw badRequest("Шаблон с таким названием уже есть в проекте");
      }
      const statusId = await assertStatusInProject(project.id, body.statusId);

      const template = await createIssueTemplate(project.id, { ...body, statusId });
      await audit(user.sub, "issueTemplate.add", "project", project.id, { templateId: template.id, name: template.name });
      reply.code(201).send(template);
    },
  );

  app.patch(
    "/:templateId",
    { preHandler: requirePerm("editWorkflow"), preValidation: [zparams(IssueTemplateParams), zbody(IssueTemplateBody)] },
    async (req) => {
      const project = req.project!;
      const { templateId } = req.params as z.infer<typeof IssueTemplateParams>;
      const body = req.body as z.infer<typeof IssueTemplateBody>;

      const existing = await getIssueTemplateInProject(project.id, templateId);
      if (!existing) throw notFound("Шаблон не найден");
      const statusId = await assertStatusInProject(project.id, body.statusId);
      return updateIssueTemplate(templateId, { ...body, statusId });
    },
  );

  app.delete(
    "/:templateId",
    { preHandler: requirePerm("editWorkflow"), preValidation: zparams(IssueTemplateParams) },
    async (req, reply) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const { templateId } = req.params as z.infer<typeof IssueTemplateParams>;

      const existing = await getIssueTemplateInProject(project.id, templateId);
      if (!existing) throw notFound("Шаблон не найден");
      await deleteIssueTemplate(templateId);
      await audit(user.sub, "issueTemplate.remove", "project", project.id, { templateId, name: existing.name });
      reply.code(204).send();
    },
  );
}
