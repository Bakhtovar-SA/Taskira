/** Проект: bootstrap приложения + управление составом участников.
 *
 *  GET    /api/project                     — проект, активные пользователи, состав, workflow, спринты
 *  PUT    /api/project/members/:userId     — добавить участника / сменить его роль   [global admin]
 *  DELETE /api/project/members/:userId     — убрать участника из проекта             [global admin]
 *
 *  Деактивированные пользователи в bootstrap не отдаются (они видны админу в GET /api/users). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, invalidateMembership, notFound, requirePerm, zbody, zparams } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { audit } from "../audit.js";
import { safeUser, type UserRow } from "../auth.js";
import { currentProject } from "../services/project.js";
import { getWorkflow } from "../services/workflow.js";
import { mapSprint, type SprintRow } from "../services/sprints.js";
import { MemberParams, SetMemberBody } from "../contract.js";
import type { JwtPayload } from "../middleware.js";
import type { ProjectRole } from "../permissions.js";

interface MemberRow {
  user_id: string;
  role: ProjectRole;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/project", { preHandler: requirePerm("browse") }, async () => {
    const project = await currentProject();
    const users = (await q<UserRow>(`SELECT * FROM users WHERE is_active = true ORDER BY name`, [])).map(safeUser);
    const members = (
      await q<MemberRow>(`SELECT user_id, role FROM project_members WHERE project_id = $1`, [project.id])
    ).map((m) => ({ userId: m.user_id, role: m.role }));
    const workflow = await getWorkflow(project.id);
    const sprints = (
      await q<SprintRow>(`SELECT * FROM sprints WHERE project_id = $1 ORDER BY created_at`, [project.id])
    ).map(mapSprint);
    return { project, users, members, workflow, sprints };
  });

  /* -------- состав проекта (только глобальный admin: manageAccess = ['admin']) -------- */

  /* Гард «последний активный менеджер проекта» встроен прямо в WHERE записи —
     проверка и запись в одном стейтменте, одном снапшоте, без отдельного SELECT
     (устраняет TOCTOU-окно между round-trip'ами). Блокируем, только если target
     сам — активный менеджер И другого активного менеджера в проекте нет; убрать
     мёртвую строку `manager` деактивированного пользователя всегда можно. */
  const LAST_MANAGER_MSG =
    "Нельзя убрать или понизить последнего активного менеджера проекта — сначала назначьте другого";

  app.put(
    "/project/members/:userId",
    { preHandler: requirePerm("manageAccess"), preValidation: [zparams(MemberParams), zbody(SetMemberBody)] },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { userId } = req.params as z.infer<typeof MemberParams>;
      const { role } = req.body as z.infer<typeof SetMemberBody>;
      const project = await currentProject();

      const target = await one<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM users WHERE id = $1`,
        [userId],
      );
      if (!target) throw notFound("Пользователь не найден");
      if (!target.is_active) throw badRequest("Пользователь деактивирован — сначала активируйте аккаунт");

      // from-роль нужна только для аудита; на гард не влияет (он в SQL ниже).
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
      // 0 строк = был конфликт (участник есть), но WHERE запретил апдейт →
      // это понижение последнего активного менеджера.
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
    "/project/members/:userId",
    { preHandler: requirePerm("manageAccess"), preValidation: zparams(MemberParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { userId } = req.params as z.infer<typeof MemberParams>;
      const project = await currentProject();

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
        // Либо не участник (404), либо последний активный менеджер (409) — различаем.
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
