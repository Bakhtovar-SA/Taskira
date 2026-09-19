/**
 * Стражи запросов: JWT-аутентификация, права, валидация тел.
 * Любой отказ — единый формат { error: { code, reason } } (см. contract.ts).
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler, preValidationHookHandler } from "fastify";
import { ZodError, type ZodType } from "zod";
import { audit } from "./audit.js";
import { one } from "./db.js";
import { ApiHttpError } from "./errors.js";
import { projectById, type ProjectRow } from "./services/project.js";
import { isIssueCollaborator } from "./services/collaborators.js";
import { closeUserSockets } from "./services/wsHub.js";
import {
  resolveRole,
  roleCan,
  roleDenialReason,
  roleHas,
  type AccessRole,
  type GlobalRole,
  type IssueRef,
  type Membership,
  type PermId,
  type ProjectRole,
  type ServerUser,
} from "./permissions.js";

// ApiHttpError переехал в ./errors.js (разрыв цикла middleware <-> services/project);
// ре-экспорт — чтобы существующие импорты из middleware.js продолжали работать.
export { ApiHttpError } from "./errors.js";

/* -------- типы JWT и расширений запроса -------- */
export interface JwtPayload {
  sub: string;
  /** Монотонная версия сессии из users.session_version (миграция 029). */
  sessionVersion?: number;
  /** Стандартные JWT timestamps добавляет @fastify/jwt. */
  iat?: number;
  exp?: number;
  /** Глобальная роль (users.global_role). В токене может быть устаревшей —
   *  requireAuth всегда перезаписывает свежим значением из БД. */
  globalRole: GlobalRole;
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    issueRef?: IssueRef;
    /** Проект запроса (из :projectId), загружен requirePerm/requireIssuePerm. */
    project?: ProjectRow;
    /** Членство текущего пользователя в проекте запроса. */
    membership?: Membership;
    /** Эффективная роль в проекте запроса: resolveRole(user, membership). */
    projectRole?: AccessRole | null;
    /** true — доступ к задаче дан не ролью, а строкой issue_collaborators
     *  (приглашённый: только browse/comment по ЭТОЙ задаче). */
    isCollaborator?: boolean;
    /** true — роли в project_members нет, но browse дан по членству в
     *  департаменте проекта или is_shared (LDAP_MIGRATION.md D8). */
    impliedViewer?: boolean;
  }
}

export const unauthorized = (reason = "Требуется авторизация — войдите заново") => new ApiHttpError(401, "UNAUTHORIZED", reason);
export const forbidden = (reason: string) => new ApiHttpError(403, "FORBIDDEN", reason);
export const notFound = (reason = "Объект не найден") => new ApiHttpError(404, "NOT_FOUND", reason);
export const badRequest = (reason: string) => new ApiHttpError(400, "VALIDATION", reason);

export function formatZod(e: ZodError): string {
  const first = e.issues[0];
  if (!first) return "Некорректные данные запроса";
  const path = first.path.length ? first.path.join(".") : "тело запроса";
  return `${path}: ${first.message}`;
}

/* -------- валидация JSON-тела zod-схемой из contract.ts -------- */
export function zbody<T extends ZodType>(schema: T): preValidationHookHandler {
  return async (req) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest(formatZod(parsed.error));
    req.body = parsed.data;
  };
}

/* -------- валидация query-параметров (GET-фильтры, пагинация) -------- */
export function zquery<T extends ZodType>(schema: T): preValidationHookHandler {
  return async (req) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw badRequest(formatZod(parsed.error));
    req.query = parsed.data as typeof req.query;
  };
}

/* -------- валидация path-параметров (:id, :userId, …) --------
   Мержит разобранное поверх req.params — прочие параметры роута (напр. :projectId
   у вложенных ресурсов) не теряются, даже если их нет в схеме. */
export function zparams<T extends ZodType>(schema: T): preValidationHookHandler {
  return async (req) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) throw badRequest(formatZod(parsed.error));
    req.params = { ...(req.params as Record<string, unknown>), ...(parsed.data as Record<string, unknown>) } as typeof req.params;
  };
}

/* -------- аутентификация --------
   JWT подтверждает личность, но роль и активность берём из БД (fix 3a):
   смена роли админом или деактивация аккаунта действуют без ожидания
   истечения токена (12h). Лёгкий кэш на 30 секунд бережёт БД на внутренней сети. */
const FRESH_TTL_MS = 30_000;
const AUTH_CACHE_MAX = 10_000;
function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= AUTH_CACHE_MAX) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
const freshUsers = new Map<
  string,
  { globalRole: GlobalRole; active: boolean; sessionVersion: number; at: number }
>();

/** Сбрасывает 30-секундный кэш свежести — безопасно вызывать при ЛЮБОЙ записи
 *  в строку users, даже если по факту ничего не поменялось (JIT-логин при
 *  каждом входе в userProvisioning.ts, «сохранить» без изменений в PATCH
 *  /users/:id): следующий requireAuth/WS-хендшейк просто перечитает из БД
 *  на 30 секунд раньше срока — дёшево. НЕ рвёт WS-соединения — для этого
 *  revokeUserSessions() ниже, вызывать только при настоящем отзыве доступа. */
export function invalidateUserCache(userId: string): void {
  freshUsers.delete(userId);
}

/** Настоящий отзыв: логаут, деактивация, смена роли, отзыв токена. В отличие
 *  от invalidateUserCache() — рвёт открытые WS-соединения (Этап 3c), а не
 *  только сбрасывает кэш. assertFreshUser сверяет активность/отзыв один раз,
 *  на хендшейке, поэтому без этого разлогиненный/деактивированный пользователь
 *  с открытой вкладкой продолжал бы получать push до её закрытия.
 *
 *  Не вызывать на каждую запись в users «на всякий случай» — обычный
 *  JIT-релогин или ре-сохранение без изменений НЕ должны разрывать чужую
 *  живую вкладку с тем же аккаунтом (было багом в предыдущей версии фикса:
 *  invalidateUserCache сама рвала сокеты и вызывалась в т.ч. из мест, где
 *  ничего не отзывалось). */
export function revokeUserSessions(userId: string, reason: string): void {
  freshUsers.delete(userId);
  closeUserSockets(userId, reason);
}

/**
 * Общая часть requireAuth и WS-хендшейка (routes/ws.ts): JWT уже разобран
 * (payload на руках), осталось сверить «свежесть» — активность и отзыв
 * токенов — по БД. Бросает unauthorized(), иначе отдаёт актуальную
 * global_role (из БД, не из токена — тот мог устареть).
 */
export async function assertFreshUser(userId: string, sessionVersion: number | undefined): Promise<GlobalRole> {
  let fresh = freshUsers.get(userId);
  if (!fresh || Date.now() - fresh.at > FRESH_TTL_MS) {
    const row = await one<{ global_role: GlobalRole; is_active: boolean; session_version: string | number }>(
      `SELECT global_role, is_active, session_version FROM users WHERE id = $1`,
      [userId],
    );
    if (!row) throw unauthorized("Пользователь больше не существует");
    fresh = {
      globalRole: row.global_role,
      active: row.is_active,
      sessionVersion: Number(row.session_version),
      at: Date.now(),
    };
    boundedSet(freshUsers, userId, fresh);
  }
  if (!fresh.active) throw unauthorized("Аккаунт деактивирован администратором");

  if (sessionVersion === undefined || sessionVersion !== fresh.sessionVersion) {
    throw unauthorized("Сессия завершена — войдите заново");
  }

  return fresh.globalRole;
}

export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }

  // Глобальная роль из БД новее токена — перезаписываем для всех последующих проверок.
  // Payload токена (может быть без globalRole у старых токенов) для авторизации не используется.
  const globalRole = await assertFreshUser(req.user.sub, req.user.sessionVersion);
  req.user = { ...req.user, globalRole };
};

const serverUser = (req: FastifyRequest): ServerUser => ({ id: req.user.sub, globalRole: req.user.globalRole });

/* -------- членство в проекте --------
   Кэш на 30 секунд по паре (пользователь, проект), рядом с freshUsers.
   Сбрасывать invalidateMembership() при правке состава/ролей проекта (Фаза 3). */
const MEMBERSHIP_TTL_MS = 30_000;
const membershipCache = new Map<string, { role: ProjectRole | null; at: number }>();
const mkey = (userId: string, projectId: string) => `${userId}::${projectId}`;

export function invalidateMembership(userId: string, projectId: string): void {
  membershipCache.delete(mkey(userId, projectId));
}

async function loadProjectMembership(userId: string, projectId: string): Promise<Membership> {
  const key = mkey(userId, projectId);
  const cached = membershipCache.get(key);
  let role: ProjectRole | null;
  if (cached && Date.now() - cached.at <= MEMBERSHIP_TTL_MS) {
    role = cached.role;
  } else {
    const row = await one<{ role: ProjectRole }>(
      `SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId],
    );
    role = row?.role ?? null;
    boundedSet(membershipCache, key, { role, at: Date.now() });
  }
  return role ? { projectId, role } : null;
}

/* -------- членство в департаменте (LDAP_MIGRATION.md D8) --------
   Такой же 30-секундный кэш; спрашивается только для пользователей без явной
   роли в проекте (участники/админы сюда не попадают). */
const deptMemberCache = new Map<string, { member: boolean; at: number }>();

export function invalidateDeptMembership(userId: string, departmentId: string): void {
  deptMemberCache.delete(mkey(userId, departmentId));
}

async function isDeptMember(userId: string, departmentId: string): Promise<boolean> {
  const key = mkey(userId, departmentId);
  const cached = deptMemberCache.get(key);
  if (cached && Date.now() - cached.at <= MEMBERSHIP_TTL_MS) return cached.member;
  const row = await one<{ one: number }>(
    `SELECT 1 AS one FROM department_members WHERE user_id = $1 AND department_id = $2`,
    [userId, departmentId],
  );
  const member = !!row;
  boundedSet(deptMemberCache, key, { member, at: Date.now() });
  return member;
}

/** Эффективная роль в проекте: явная (resolveRole) либо неявный viewer —
 *  участник департамента проекта или is_shared (D8). null → нет доступа. */
async function effectiveRole(u: ServerUser, membership: Membership, project: ProjectRow): Promise<AccessRole | null> {
  const explicit = resolveRole(u, membership); // вернёт "admin" для глоб. админа
  if (explicit) return explicit;
  if (project.isShared || (await isDeptMember(u.id, project.departmentId))) return "viewer";
  return null;
}

/* -------- глобальный admin (без контекста проекта) --------
   Для CRUD департаментов/проектов и управления пользователями. */
export const requireGlobalAdmin: preHandlerAsyncHookHandler = async (req, reply: FastifyReply) => {
  await requireAuth.call(req.server, req, reply);
  if (req.user.globalRole === "admin") return;
  await audit(req.user.sub, "access.denied", "globalAdmin", null, { path: req.url, method: req.method });
  throw forbidden("Действие доступно только администратору ресурса");
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** projectId из :projectId роута (валидируем формат сами — на вложенных ресурсах
    его нет в zod-схеме параметров). */
function paramProjectId(req: FastifyRequest): string {
  const id = (req.params as { projectId?: string }).projectId;
  if (!id) throw new ApiHttpError(500, "INTERNAL", "requirePerm вне scope /projects/:projectId");
  if (!UUID_RE.test(id)) throw notFound("Проект не найден");
  return id;
}

/* -------- проверка права в контексте проекта запроса --------
   Сама гарантирует аутентификацию (requireAuth), резолвит проект из :projectId
   и членство пользователя в нём, кладёт req.project / req.membership / req.projectRole.
   Роуту достаточно указать только requirePerm/requireIssuePerm в preHandler.

   gate — необязательная проверка ПОСЛЕ резолва проекта, но ДО проверки роли
   (например, requireSprintsEnabled ниже) — нужна опциональным модулям, у
   которых "роута не существует для этого проекта" (404) должно быть верно
   независимо от роли звонящего, а не только для тех, кто прошёл бы проверку
   права. Если поставить такую проверку внутри самого хендлера (как было
   изначально в routes/sprints.ts), preHandler с обычным requirePerm(perm)
   успевает отдать 403 раньше, чем хендлер вообще запустится — ревью PR #49. */
export function requirePerm(perm: PermId, gate?: (project: ProjectRow) => void): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const projectId = paramProjectId(req);
    const project = await projectById(projectId);
    if (!project) throw notFound("Проект не найден");
    gate?.(project);
    const membership = await loadProjectMembership(u.id, projectId);
    const role = await effectiveRole(u, membership, project);
    req.project = project;
    req.membership = membership;
    req.projectRole = role;
    req.impliedViewer = !membership && role === "viewer";
    if (roleCan(role, perm)) return;
    await audit(u.id, "access.denied", perm, null, { path: req.url, method: req.method, projectId });
    throw forbidden(roleDenialReason(role, perm));
  };
}

/* -------- проверка права с контекстом задачи (edit/transition/delete/comment) --------
   Тоже гарантирует аутентификацию сама. Загружает задачу в req.issueRef, сверяет
   её project_id с :projectId (иначе 404 — защита от /projects/A/issues/<из B>),
   резолвит членство и проверяет can() с учётом уровня задачи.

   Fallback приглашённого (COLLAB_MIGRATION.md D1): если ролевой can() не прошёл,
   но perm ∈ {browse, comment} и есть строка issue_collaborators(issue, user) —
   доступ разрешён, req.isCollaborator = true. Строго issue-scoped: список задач и
   bootstrap проекта идут через requirePerm (без issueRef) и остаются 403. */
const COLLABORATOR_PERMS = new Set<PermId>(["browse", "comment"]);

/** gate — см. requirePerm() выше, тот же смысл: проверка опционального
 *  модуля ДО резолва роли/приглашённого, чтобы 404 не зависело от прав. */
export function requireIssuePerm(perm: PermId, gate?: (project: ProjectRow) => void): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const projectId = paramProjectId(req);
    const project = await projectById(projectId);
    if (!project) throw notFound("Проект не найден");
    gate?.(project);
    const id = (req.params as { id?: string }).id;
    if (!id || !UUID_RE.test(id)) throw notFound("Задача не найдена в этом проекте");
    // Один round-trip: исполнители (issue_assignees, миграция 025) агрегируются
    // тут же через array_agg, а не отдельным запросом — это горячий путь,
    // выполняется на каждый issue-scoped запрос.
    const row = await one<{ id: string; project_id: string; reporter_id: string; assignee_ids: string[] }>(
      `SELECT i.id, i.project_id, i.reporter_id,
              COALESCE(array_agg(ia.user_id) FILTER (WHERE ia.user_id IS NOT NULL), '{}') AS assignee_ids
         FROM issues i
         LEFT JOIN issue_assignees ia ON ia.issue_id = i.id
        WHERE i.id = $1
        GROUP BY i.id`,
      [id],
    );
    if (!row || row.project_id !== projectId) throw notFound("Задача не найдена в этом проекте");
    const issueRef: IssueRef = { id: row.id, assigneeIds: row.assignee_ids, reporterId: row.reporter_id };
    req.project = project;
    req.issueRef = issueRef;
    const membership = await loadProjectMembership(u.id, projectId);
    const role = await effectiveRole(u, membership, project);
    req.membership = membership;
    req.projectRole = role;
    req.impliedViewer = !membership && role === "viewer";
    if (roleCan(role, perm, { userId: u.id, issue: issueRef })) return;

    if (COLLABORATOR_PERMS.has(perm) && (await isIssueCollaborator(u.id, issueRef.id))) {
      req.isCollaborator = true;
      return;
    }
    await audit(u.id, "access.denied", perm, issueRef.id, { path: req.url, method: req.method, projectId });
    const ownViolation =
      (perm === "edit" || perm === "transition") &&
      !!role &&
      roleHas(role, perm) &&
      !roleCan(role, perm, { userId: u.id, issue: issueRef });
    throw forbidden(roleDenialReason(role, perm, ownViolation));
  };
}
