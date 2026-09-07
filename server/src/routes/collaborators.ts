/** Приглашённые участники задачи: /api/projects/:projectId/issues/:id/collaborators
 *
 *  GET               — список (видят участники проекта и сам приглашённый)
 *  PUT    /:userId    — подключить человека к задаче            [manageCollaborators]
 *  DELETE /:userId    — отключить                                [manageCollaborators]
 *
 *  manageCollaborators (COLLAB_MIGRATION.md D2) = admin ∪ manager проекта,
 *  проверяется issue-scoped через requireIssuePerm. Цель PUT — любой активный
 *  пользователь (в этом смысл кросс-департаментного подключения); в исполнители
 *  приглашённый при этом НЕ попадает (проверка assignee не изменена).
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one } from "../db.js";
import { badRequest, notFound, requireIssuePerm, zparams, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import { addCollaborator, listCollaborators, removeCollaborator } from "../services/collaborators.js";
import { CollaboratorParams } from "../contract.js";

export async function collaboratorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/collaborators", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const { id } = req.params as { id: string };
    return listCollaborators(id);
  });

  app.put(
    "/:id/collaborators/:userId",
    { preHandler: requireIssuePerm("manageCollaborators"), preValidation: zparams(CollaboratorParams) },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as { id: string };
      const { userId } = req.params as z.infer<typeof CollaboratorParams>;

      const target = await one<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM users WHERE id = $1`,
        [userId],
      );
      if (!target) throw notFound("Пользователь не найден");
      if (!target.is_active) throw badRequest("Пользователь деактивирован");

      const dto = await addCollaborator(id, userId, actor.sub);
      await audit(actor.sub, "issue.collaborator.add", "issue", id, { userId, projectId: req.project!.id });
      return dto;
    },
  );

  app.delete(
    "/:id/collaborators/:userId",
    { preHandler: requireIssuePerm("manageCollaborators"), preValidation: zparams(CollaboratorParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as { id: string };
      const { userId } = req.params as z.infer<typeof CollaboratorParams>;

      const removed = await removeCollaborator(id, userId);
      if (!removed) throw notFound("Пользователь не подключён к задаче");
      await audit(actor.sub, "issue.collaborator.remove", "issue", id, { userId, projectId: req.project!.id });
      reply.code(204).send();
    },
  );
}
