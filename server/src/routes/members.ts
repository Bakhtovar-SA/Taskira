/** Состав проекта: /api/projects/:projectId/members/:userId  [global admin].
 *
 *  PUT    — добавить участника / сменить его роль (upsert)
 *  DELETE — убрать из проекта
 *
 *  Гард «последний активный менеджер проекта» встроен в WHERE самой записи —
 *  проверка и запись в одном стейтменте (без TOCTOU-окна). Блокирует, только
 *  если target сам — активный менеджер и другого активного менеджера нет.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { invalidateMembership, notFound, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { audit } from "../audit.js";
import { MemberParams, SetMemberBody } from "../contract.js";
import type { ProjectRole } from "../permissions.js";

interface MemberRow {
  user_id: string;
  role: ProjectRole;
}

const LAST_MANAGER_MSG =
  "Нельзя убрать или понизить последнего активного менеджера проекта — сначала назначьте другого";

export async function memberRoutes(app: FastifyInstance): Promise<void> {
  app.put(
    "/:userId",
    { preHandler: requirePerm("manageAccess"), preValidation: [zparams(MemberParams), zbody(SetMemberBody)] },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { userId } = req.params as z.infer<typeof MemberParams>;
      const { role } = req.body as z.infer<typeof SetMemberBody>;
      const project = req.project!;

      const target = await one<{ id: string; is_active: boolean }>(`SELECT id, is_active FROM users WHERE id = $1`, [userId]);
      if (!target) throw notFound("Пользователь не найден");
      if (!target.is_active) throw conflict("Пользователь деактивирован — сначала активируйте аккаунт");

      const before = await one<{ role: ProjectRole }>(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [project.id, userId],
      );

      const rows = await q<MemberRow>(
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
         WHERE project_members.role <> 'manager'
            OR EXCLUDED.role = 'manager'
            OR NOT (SELECT is_active FROM users WHERE id = $2)
            OR EXISTS (
                 SELECT 1 FROM project_members pm
                   JOIN users u ON u.id = pm.user_id
                  WHERE pm.project_id = $1 AND pm.role = 'manager'
                    AND u.is_active AND pm.user_id <> $2
               )
         RETURNING user_id, role`,
        [project.id, userId, role],
      );
      if (rows.length === 0) throw conflict(LAST_MANAGER_MSG);

      invalidateMembership(userId, project.id);
      await audit(actor.sub, before ? "member.role.change" : "member.add", "user", userId, {
        projectId: project.id,
        from: before?.role ?? null,
        to: rows[0].role,
      });
      return { userId: rows[0].user_id, role: rows[0].role };
    },
  );

  app.delete(
    "/:userId",
    { preHandler: requirePerm("manageAccess"), preValidation: zparams(MemberParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { userId } = req.params as z.infer<typeof MemberParams>;
      const project = req.project!;

      const deleted = await q<{ role: ProjectRole }>(
        `DELETE FROM project_members
          WHERE project_id = $1 AND user_id = $2
            AND (
              role <> 'manager'
              OR NOT (SELECT is_active FROM users WHERE id = $2)
              OR EXISTS (
                   SELECT 1 FROM project_members pm
                     JOIN users u ON u.id = pm.user_id
                    WHERE pm.project_id = $1 AND pm.role = 'manager'
                      AND u.is_active AND pm.user_id <> $2
                 )
            )
          RETURNING role`,
        [project.id, userId],
      );

      if (deleted.length === 0) {
        const still = await one<{ role: ProjectRole }>(
          `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
          [project.id, userId],
        );
        if (!still) throw notFound("Пользователь не состоит в проекте");
        throw conflict(LAST_MANAGER_MSG);
      }

      invalidateMembership(userId, project.id);
      await audit(actor.sub, "member.remove", "user", userId, { projectId: project.id, was: deleted[0].role });
      reply.code(204).send();
    },
  );
}
