/** Проекты: список видимых, CRUD (глобальный admin) и bootstrap одного проекта.
 *
 *  GET    /api/projects                — проекты, видимые пользователю
 *  POST   /api/projects                — создать проект + дефолтный workflow   [global admin]
 *  GET    /api/projects/:projectId     — bootstrap: проект, участники, состав, workflow
 *  PATCH  /api/projects/:projectId     — правка (name/description/departmentId/isShared)   [global admin]
 *  DELETE /api/projects/:projectId     — удалить (каскад issues/members/workflow)  [global admin]
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import {
  badRequest,
  notFound,
  requireAuth,
  requireGlobalAdmin,
  requirePerm,
  zbody,
  zparams,
  type JwtPayload,
} from "../middleware.js";
import { conflict, getWorkflow, seedProjectWorkflow } from "../services/workflow.js";
import { listIssueTemplates } from "../services/issueTemplates.js";
import { listCustomFields } from "../services/customFields.js";
import { listSprints } from "../services/sprints.js";
import { addFavoriteProject, removeFavoriteProject } from "../services/favorites.js";
import { audit } from "../audit.js";
import { safeUser, type UserRow } from "../auth.js";
import { invalidateProjectCache } from "../services/project.js";
import { listVisibleProjects, projectRowToDto, type ProjectDto } from "../services/projects.js";
import { storageKeysForProject, deleteStorageObjects } from "../services/attachments.js";
import { ProjectCreateBody, ProjectParams, ProjectPatchBody } from "../contract.js";
import type { ProjectRole } from "../permissions.js";

interface MemberRow {
  user_id: string;
  role: ProjectRole;
}

async function projectDtoById(id: string): Promise<ProjectDto | null> {
  const r = await one<{
    id: string;
    key: string;
    name: string;
    description: string;
    department_id: string;
    is_shared: boolean;
    sprints_enabled: boolean;
  }>(`SELECT id, key, name, description, department_id, is_shared, sprints_enabled FROM projects WHERE id = $1`, [id]);
  return r
    ? {
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        departmentId: r.department_id,
        isShared: r.is_shared,
        sprintsEnabled: r.sprints_enabled,
      }
    : null;
}

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------- список видимых */
  app.get("/projects", { preHandler: requireAuth }, async (req) => {
    return listVisibleProjects(req.user.sub, req.user.globalRole === "admin");
  });

  /* ---------------------------------------------------------- создание */
  app.post(
    "/projects",
    { preHandler: requireGlobalAdmin, preValidation: zbody(ProjectCreateBody) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const body = req.body as z.infer<typeof ProjectCreateBody>;

      const dep = await one<{ id: string }>(`SELECT id FROM departments WHERE id = $1`, [body.departmentId]);
      if (!dep) throw badRequest("Отдел не найден");

      let projectId: string;
      try {
        projectId = (
          await one<{ id: string }>(
            `INSERT INTO projects (key, name, description, department_id, is_shared, sprints_enabled)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [body.key, body.name, body.description, body.departmentId, body.isShared, body.sprintsEnabled],
          )
        )!.id;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Проект с таким ключом уже есть");
        throw e;
      }

      await seedProjectWorkflow(projectId);
      await audit(actor.sub, "project.create", "project", projectId, { key: body.key });
      reply.code(201).send(await projectDtoById(projectId));
    },
  );

  /* ---------------------------------------------------------- bootstrap одного проекта */
  app.get(
    "/projects/:projectId",
    { preHandler: [requirePerm("browse")], preValidation: zparams(ProjectParams) },
    async (req) => {
      const project = req.project!;
      // Активные: участники проекта + глобальные админы + участники департамента
      // проекта; а если проект is_shared — вообще все активные (тот же неявный
      // viewer, что даёт effectiveRole в middleware, LDAP_MIGRATION.md D8).
      // Нужно, чтобы текущий юзер резолвился в клиентском me-memo.
      // Пять независимых чтений — параллельно, а не пять последовательных
      // round trip'ов на каждый вход в проект (ревью PR #47).
      const [userRows, memberRows, workflow, issueTemplates, customFields, sprints] = await Promise.all([
        q<UserRow>(
          `SELECT u.* FROM users u
            WHERE u.is_active
              AND ($3
                   OR u.global_role = 'admin'
                   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id)
                   OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = $2 AND dm.user_id = u.id))
            ORDER BY u.name`,
          [project.id, project.departmentId, project.isShared],
        ),
        q<MemberRow>(`SELECT user_id, role FROM project_members WHERE project_id = $1`, [project.id]),
        getWorkflow(project.id),
        listIssueTemplates(project.id),
        listCustomFields(project.id),
        // Гейтим флагом, а не полагаемся на "таблица пуста без него" — это
        // было бы верно только для проекта, который НИКОГДА не включал модуль.
        // Проект, где спринты создали, а потом sprintsEnabled выключили назад
        // (ровно тот сценарий, который подразумевает чекбокс в AdminView),
        // иначе продолжал бы отдавать все спринты — включая текст goal — в
        // bootstrap любому участнику с одним лишь browse, хотя /sprints* уже
        // 404-ят и вкладка скрыта (ревью PR #49).
        project.sprintsEnabled ? listSprints(project.id) : Promise.resolve([]),
      ]);
      const users = userRows.map(safeUser);
      const members = memberRows.map((m) => ({ userId: m.user_id, role: m.role }));
      return { project: projectRowToDto(project), users, members, workflow, issueTemplates, customFields, sprints };
    },
  );

  /* ---------------------------------------------------------- правка */
  app.patch(
    "/projects/:projectId",
    { preHandler: requireGlobalAdmin, preValidation: [zparams(ProjectParams), zbody(ProjectPatchBody)] },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { projectId } = req.params as z.infer<typeof ProjectParams>;
      const body = req.body as z.infer<typeof ProjectPatchBody>;

      const exists = await one<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [projectId]);
      if (!exists) throw notFound("Проект не найден");
      if (body.departmentId) {
        const dep = await one<{ id: string }>(`SELECT id FROM departments WHERE id = $1`, [body.departmentId]);
        if (!dep) throw badRequest("Отдел не найден");
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => {
        vals.push(val);
        sets.push(`${col} = $${vals.length}`);
      };
      if (body.name !== undefined) push("name", body.name);
      if (body.description !== undefined) push("description", body.description);
      if (body.departmentId !== undefined) push("department_id", body.departmentId);
      if (body.isShared !== undefined) push("is_shared", body.isShared);
      if (body.sprintsEnabled !== undefined) push("sprints_enabled", body.sprintsEnabled);
      vals.push(projectId);
      await q(`UPDATE projects SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);

      invalidateProjectCache(projectId);
      await audit(actor.sub, "project.update", "project", projectId, { fields: Object.keys(body) });
      return projectDtoById(projectId);
    },
  );

  /* ---------------------------------------------------------- удаление */
  app.delete(
    "/projects/:projectId",
    { preHandler: requireGlobalAdmin, preValidation: zparams(ProjectParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { projectId } = req.params as z.infer<typeof ProjectParams>;
      const proj = await one<{ key: string }>(`SELECT key FROM projects WHERE id = $1`, [projectId]);
      if (!proj) throw notFound("Проект не найден");
      // Ключи вложений собираем ДО удаления — ровно как в DELETE /issues/:id.
      // Каскад FK снесёт строки attachments, но не файлы в хранилище, и после
      // удаления проекта найти их будет уже нечем (аудит BUG-01).
      const attachKeys = await storageKeysForProject(projectId);
      // Каскады по FK: issues / project_members / workflow_* / project_counters.
      await q(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await deleteStorageObjects(attachKeys); // best-effort уборка хранилища
      invalidateProjectCache(projectId);
      await audit(actor.sub, "project.delete", "project", projectId, { key: proj.key });
      reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------- избранное (миграция 024)
     requirePerm("browse"), не requireGlobalAdmin/manageAccess — своё избранное
     помечает любой участник видимого проекта, это персональная UX-настройка,
     не структурная схема. Идемпотентно в обе стороны (ON CONFLICT DO NOTHING /
     DELETE без предварительного SELECT) — повторный клик не 409-ит. */
  app.put(
    "/projects/:projectId/favorite",
    { preHandler: requirePerm("browse"), preValidation: zparams(ProjectParams) },
    async (req, reply) => {
      await addFavoriteProject(req.user.sub, req.project!.id);
      reply.code(204).send();
    },
  );

  app.delete(
    "/projects/:projectId/favorite",
    { preHandler: requirePerm("browse"), preValidation: zparams(ProjectParams) },
    async (req, reply) => {
      await removeFavoriteProject(req.user.sub, req.project!.id);
      reply.code(204).send();
    },
  );
}
