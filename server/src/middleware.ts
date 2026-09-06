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
import {
  can,
  denialReason,
  resolveRole,
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
const freshUsers = new Map<string, { globalRole: GlobalRole; active: boolean; at: number }>();

/** Сбрасывает кэш пользователя — вызывать при смене global_role/активности админом. */
export function invalidateUserCache(userId: string): void {
  freshUsers.delete(userId);
}

export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }

  const id = req.user.sub;
  let fresh = freshUsers.get(id);
  if (!fresh || Date.now() - fresh.at > FRESH_TTL_MS) {
    const row = await one<{ global_role: GlobalRole; is_active: boolean }>(
      `SELECT global_role, is_active FROM users WHERE id = $1`,
      [id],
    );
    if (!row) throw unauthorized("Пользователь больше не существует");
    fresh = { globalRole: row.global_role, active: row.is_active, at: Date.now() };
    freshUsers.set(id, fresh);
  }
  if (!fresh.active) throw unauthorized("Аккаунт деактивирован администратором");

  // Глобальная роль из БД новее токена — перезаписываем для всех последующих проверок.
  // Payload токена (может быть без globalRole у старых токенов) для авторизации не используется.
  req.user = { ...req.user, globalRole: fresh.globalRole };
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
    membershipCache.set(key, { role, at: Date.now() });
  }
  return role ? { projectId, role } : null;
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
   Роуту достаточно указать только requirePerm/requireIssuePerm в preHandler. */
export function requirePerm(perm: PermId): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const projectId = paramProjectId(req);
    const project = await projectById(projectId);
    if (!project) throw notFound("Проект не найден");
    const membership = await loadProjectMembership(u.id, projectId);
    req.project = project;
    req.membership = membership;
    req.projectRole = resolveRole(u, membership);
    if (can(u, membership, perm)) return;
    await audit(u.id, "access.denied", perm, null, { path: req.url, method: req.method, projectId });
    throw forbidden(denialReason(u, membership, perm));
  };
}

/* -------- проверка права с контекстом задачи (edit/transition/delete/comment) --------
   Тоже гарантирует аутентификацию сама. Загружает задачу в req.issueRef, сверяет
   её project_id с :projectId (иначе 404 — защита от /projects/A/issues/<из B>),
   резолвит членство и проверяет can() с учётом уровня задачи. */
export function requireIssuePerm(perm: PermId): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const projectId = paramProjectId(req);
    const project = await projectById(projectId);
    if (!project) throw notFound("Проект не найден");
    const id = (req.params as { id?: string }).id;
    if (!id) throw notFound("Задача не указана");
    const row = await one<{ id: string; project_id: string; assignee_id: string | null; reporter_id: string }>(
      `SELECT id, project_id, assignee_id, reporter_id FROM issues WHERE id = $1`,
      [id],
    );
    if (!row || row.project_id !== projectId) throw notFound("Задача не найдена в этом проекте");
    const issueRef: IssueRef = { id: row.id, assigneeId: row.assignee_id, reporterId: row.reporter_id };
    req.project = project;
    req.issueRef = issueRef;
    const membership = await loadProjectMembership(u.id, projectId);
    req.membership = membership;
    req.projectRole = resolveRole(u, membership);
    if (!can(u, membership, perm, issueRef)) {
      await audit(u.id, "access.denied", perm, issueRef.id, { path: req.url, method: req.method, projectId });
      throw forbidden(denialReason(u, membership, perm, issueRef));
    }
  };
}
