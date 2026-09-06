/**
 * Стражи запросов: JWT-аутентификация, права, валидация тел.
 * Любой отказ — единый формат { error: { code, reason } } (см. contract.ts).
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler, preValidationHookHandler } from "fastify";
import { ZodError, type ZodType } from "zod";
import { audit } from "./audit.js";
import { one } from "./db.js";
import { ApiHttpError } from "./errors.js";
import { currentProject } from "./services/project.js";
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
    /** Членство текущего пользователя в проекте запроса (Фаза 2). */
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

/* -------- проверка права (общие, без контекста задачи) --------
   Сама гарантирует аутентификацию (requireAuth) перед проверкой права —
   роуту достаточно указать только requirePerm/requireIssuePerm в preHandler,
   без риска забыть requireAuth первым элементом цепочки (баг fix 3b-hotfix:
   req.user был null на всех роутах, кроме /auth/me, где requireAuth стоял явно). */
export function requirePerm(perm: PermId): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const project = await currentProject();
    const membership = await loadProjectMembership(u.id, project.id);
    req.membership = membership;
    req.projectRole = resolveRole(u, membership);
    if (can(u, membership, perm)) return;
    await audit(u.id, "access.denied", perm, null, { path: req.url, method: req.method, projectId: project.id });
    throw forbidden(denialReason(u, membership, perm));
  };
}

/* -------- проверка права с контекстом задачи (edit/transition/delete/comment) --------
   Тоже гарантирует аутентификацию сама (см. комментарий выше у requirePerm).
   Загружает минимальную задачу в req.issueRef, резолвит членство для проекта
   ЭТОЙ задачи и проверяет can() с учётом уровня задачи. */
export function requireIssuePerm(perm: PermId): preHandlerAsyncHookHandler {
  return async (req, reply: FastifyReply) => {
    await requireAuth.call(req.server, req, reply);
    const u = serverUser(req);
    const id = (req.params as { id?: string }).id;
    if (!id) throw notFound("Задача не указана");
    const row = await one<{ id: string; project_id: string; assignee_id: string | null; reporter_id: string }>(
      `SELECT id, project_id, assignee_id, reporter_id FROM issues WHERE id = $1`,
      [id],
    );
    if (!row) throw notFound("Задача не найдена или удалена");
    const issueRef: IssueRef = { id: row.id, assigneeId: row.assignee_id, reporterId: row.reporter_id };
    req.issueRef = issueRef;
    const membership = await loadProjectMembership(u.id, row.project_id);
    req.membership = membership;
    req.projectRole = resolveRole(u, membership);
    if (!can(u, membership, perm, issueRef)) {
      await audit(u.id, "access.denied", perm, issueRef.id, {
        path: req.url,
        method: req.method,
        projectId: row.project_id,
      });
      throw forbidden(denialReason(u, membership, perm, issueRef));
    }
  };
}
