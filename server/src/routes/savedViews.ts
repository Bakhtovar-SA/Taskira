/** Сохранённые вьюхи проекта (ТЗ 3.2, план v2 Трек 3): личные — `browse` (любой
 *  участник, читающий проект) достаточно, в отличие от issue_templates/custom_fields/
 *  workflow (`editWorkflow` — структурная схема проекта, общая для всех). Никто, кроме
 *  автора, свою вьюху не видит и не может её задеть — `user_id` в каждом запросе
 *  сервиса, не только в WHERE списка. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import {
  countSavedViews,
  createSavedView,
  deleteSavedView,
  getSavedViewForUser,
  listSavedViews,
  updateSavedView,
} from "../services/savedViews.js";
import { LIMITS, SavedViewBody, SavedViewParams } from "../contract.js";

export async function savedViewsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, async (req) => {
    const user: JwtPayload = req.user;
    return listSavedViews(user.sub, req.project!.id);
  });

  app.post("/", { preHandler: requirePerm("browse"), preValidation: zbody(SavedViewBody) }, async (req, reply) => {
    const project = req.project!;
    const user: JwtPayload = req.user;
    const body = req.body as z.infer<typeof SavedViewBody>;

    const existing = await countSavedViews(user.sub, project.id);
    if (existing >= LIMITS.savedViewsPerUserProject) {
      throw badRequest(`Нельзя сохранить больше ${LIMITS.savedViewsPerUserProject} вьюх в проекте`);
    }
    const view = await createSavedView(user.sub, project.id, { name: body.name, filter: body.filter, isDefault: body.isDefault });
    await audit(user.sub, "savedView.add", "project", project.id, { viewId: view.id, name: view.name });
    reply.code(201).send(view);
  });

  app.patch(
    "/:viewId",
    { preHandler: requirePerm("browse"), preValidation: [zparams(SavedViewParams), zbody(SavedViewBody)] },
    async (req) => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const { viewId } = req.params as z.infer<typeof SavedViewParams>;
      const body = req.body as z.infer<typeof SavedViewBody>;

      const existing = await getSavedViewForUser(user.sub, project.id, viewId);
      if (!existing) throw notFound("Вьюха не найдена");
      return updateSavedView(user.sub, project.id, viewId, { name: body.name, filter: body.filter, isDefault: body.isDefault });
    },
  );

  app.delete("/:viewId", { preHandler: requirePerm("browse"), preValidation: zparams(SavedViewParams) }, async (req, reply) => {
    const project = req.project!;
    const user: JwtPayload = req.user;
    const { viewId } = req.params as z.infer<typeof SavedViewParams>;

    const existing = await getSavedViewForUser(user.sub, project.id, viewId);
    if (!existing) throw notFound("Вьюха не найдена");
    await deleteSavedView(user.sub, project.id, viewId);
    await audit(user.sub, "savedView.remove", "project", project.id, { viewId, name: existing.name });
    reply.code(204).send();
  });
}
