/** Шаблоны задач проекта: чтение (все), правка (editWorkflow — та же
 *  «структурная схема проекта», что workflow/custom-fields; см. миграцию 022).
 *  Применение шаблона — client-side prefill формы создания, не роут. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import { conflict } from "../services/workflow.js";
import {
  createIssueTemplate,
  deleteIssueTemplate,
  getIssueTemplateInProject,
  listIssueTemplates,
  updateIssueTemplate,
} from "../services/issueTemplates.js";
import { IssueTemplateBody, IssueTemplateParams, LIMITS } from "../contract.js";
import { one } from "../db.js";

/** Обе проверки дубля имени (POST и PATCH ниже) сами по себе TOCTOU-гонка —
 *  SELECT-then-INSERT/UPDATE не защищён от второго конкурентного запроса с
 *  тем же именем между проверкой и записью. issue_templates_name_uk
 *  (миграция 022, UNIQUE по lower(name)) — реальная защита; 400 из
 *  app-level проверки — только быстрый путь без лишнего round-trip'а на
 *  обычный (не гоночный) дубль (ревью PR #47). */
function templateConflict(e: unknown): never {
  if ((e as { code?: string }).code === "23505") throw conflict("Шаблон с таким названием уже есть в проекте");
  throw e;
}

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

      // Один SELECT вместо двух (count + list) — existing.length уже даёт
      // счётчик для лимита, отдельный countIssueTemplates() был лишним
      // round-trip'ом на каждый POST без поведенческой пользы (ревью PR #47).
      const existing = await listIssueTemplates(project.id);
      if (existing.length >= LIMITS.issueTemplatesPerProject) {
        throw badRequest(`В проекте не может быть больше ${LIMITS.issueTemplatesPerProject} шаблонов`);
      }
      if (existing.some((t) => t.name.toLowerCase() === body.name.toLowerCase())) {
        throw badRequest("Шаблон с таким названием уже есть в проекте");
      }
      const statusId = await assertStatusInProject(project.id, body.statusId);

      let template;
      try {
        template = await createIssueTemplate(project.id, { ...body, statusId });
      } catch (e) {
        templateConflict(e);
      }
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
      // Дубль имени при переименовании раньше не проверялся вовсе (в отличие
      // от POST) — PATCH на существующее в проекте имя падал неперехваченным
      // 500 на UNIQUE-ограничении БД вместо честного 4xx (ревью PR #47).
      const others = await listIssueTemplates(project.id);
      if (others.some((t) => t.id !== templateId && t.name.toLowerCase() === body.name.toLowerCase())) {
        throw badRequest("Шаблон с таким названием уже есть в проекте");
      }
      const statusId = await assertStatusInProject(project.id, body.statusId);
      try {
        return await updateIssueTemplate(templateId, { ...body, statusId });
      } catch (e) {
        templateConflict(e);
      }
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
