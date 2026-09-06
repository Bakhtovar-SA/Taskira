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

      const current = await one<{ role: ProjectRole }>(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [project.id, userId],
      );

      // Нельзя понизить последнего активного менеджера проекта (аналог гарда
      // «последний активный admin» в routes/users.ts — покрывает и понижение, и удаление).
      if (current?.role === "manager" && role !== "manager") {
        await assertNotLastManager(project.id, userId);
      }

      const row = (
        await q<MemberRow>(
          `INSERT INTO project_members (project_id, user_id, role)
             VALUES ($1, $2, $3)
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING user_id, role`,
          [project.id, userId, role],
        )
      )[0];

      invalidateMembership(userId, project.id);
      await audit(actor.sub, current ? "member.role.change" : "member.add", "user", userId, {
        projectId: project.id,
        from: current?.role ?? null,
        to: role,
      });
      return { userId: row.user_id, role: row.role };
    },
  );

  app.delete(
    "/project/members/:userId",
    { preHandler: requirePerm("manageAccess"), preValidation: zparams(MemberParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { userId } = req.params as z.infer<typeof MemberParams>;
      const project = await currentProject();

      const current = await one<{ role: ProjectRole }>(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [project.id, userId],
      );
      if (!current) throw notFound("Пользователь не состоит в проекте");
      if (current.role === "manager") await assertNotLastManager(project.id, userId);

      await q(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, userId]);
      invalidateMembership(userId, project.id);
      await audit(actor.sub, "member.remove", "user", userId, { projectId: project.id, was: current.role });
      reply.code(204).send();
    },
  );
}

/** 409, если userId — единственный активный менеджер проекта. */
async function assertNotLastManager(projectId: string, userId: string): Promise<void> {
  const row = (await one<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1 AND pm.role = 'manager' AND u.is_active AND pm.user_id <> $2`,
    [projectId, userId],
  ))!;
  if (Number(row.n) === 0)
    throw conflict("Нельзя убрать или понизить последнего активного менеджера проекта — сначала назначьте другого");
}
