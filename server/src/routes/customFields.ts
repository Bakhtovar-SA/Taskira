/** Определения пользовательских полей проекта: чтение (все), правка (editWorkflow —
 *  тем же правом, что и схема workflow; см. миграцию 020). Значение на конкретной
 *  задаче правится через issues.ts (/:id/custom-fields/:fieldId, право `edit`). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import {
  createCustomField,
  deleteCustomField,
  getCustomFieldInProject,
  listCustomFields,
  renameCustomField,
} from "../services/customFields.js";
import { CustomFieldCreateBody, CustomFieldParams, CustomFieldPatchBody, LIMITS } from "../contract.js";

export async function customFieldsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, async (req) => {
    return listCustomFields(req.project!.id);
  });

  app.post(
    "/",
    { preHandler: requirePerm("editWorkflow"), preValidation: zbody(CustomFieldCreateBody) },
    async (req, reply) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const body = req.body as z.infer<typeof CustomFieldCreateBody>;

      const existing = await listCustomFields(project.id);
      if (existing.length >= LIMITS.customFieldsPerProject) {
        throw badRequest(`В проекте не может быть больше ${LIMITS.customFieldsPerProject} полей`);
      }
      if (existing.some((f) => f.name.toLowerCase() === body.name.toLowerCase())) {
        throw badRequest("Поле с таким названием уже есть в проекте");
      }
      if (body.fieldType === "select" && body.options.length === 0) {
        throw badRequest("У поля типа «список» должен быть хотя бы один вариант");
      }

      const field = await createCustomField(project.id, body);
      await audit(user.sub, "customField.add", "project", project.id, { fieldId: field.id, name: field.name });
      reply.code(201).send(field);
    },
  );

  app.patch(
    "/:fieldId",
    { preHandler: requirePerm("editWorkflow"), preValidation: [zparams(CustomFieldParams), zbody(CustomFieldPatchBody)] },
    async (req) => {
      const project = req.project!;
      const { fieldId } = req.params as z.infer<typeof CustomFieldParams>;
      const body = req.body as z.infer<typeof CustomFieldPatchBody>;

      const field = await getCustomFieldInProject(project.id, fieldId);
      if (!field) throw notFound("Поле не найдено");
      return renameCustomField(fieldId, body.name);
    },
  );

  app.delete(
    "/:fieldId",
    { preHandler: requirePerm("editWorkflow"), preValidation: zparams(CustomFieldParams) },
    async (req, reply) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const { fieldId } = req.params as z.infer<typeof CustomFieldParams>;

      const field = await getCustomFieldInProject(project.id, fieldId);
      if (!field) throw notFound("Поле не найдено");
      await deleteCustomField(fieldId);
      await audit(user.sub, "customField.remove", "project", project.id, { fieldId, name: field.name });
      reply.code(204).send();
    },
  );
}
