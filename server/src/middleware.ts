/**
 * Стражи запросов: JWT-аутентификация, права, валидация тел.
 * Любой отказ — единый формат { error: { code, reason } } (см. contract.ts).
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler, preValidationHookHandler } from "fastify";
import { ZodError, type ZodType } from "zod";
import { audit } from "./audit.js";
import { one } from "./db.js";
import { can, denialReason, roleHas, type AccessRole, type IssueRef, type PermId, type ServerUser } from "./permissions.js";

/* -------- типы JWT и расширений запроса -------- */
export interface JwtPayload {
  sub: string;
  role: ServerUser["accessRole"];
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
  }
}

/* -------- ошибки с кодом и причиной -------- */
export class ApiHttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    reason: string,
  ) {
    super(reason);
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

/* -------- аутентификация --------
   JWT подтверждает личность, но роль и активность берём из БД (fix 3a):
   смена роли админом или деактивация аккаунта действуют без ожидания
   истечения токена (12h). Лёгкий кэш на 30 секунд бережёт БД на внутренней сети. */
const FRESH_TTL_MS = 30_000;
const freshUsers = new Map<string, { role: AccessRole; active: boolean; at: number }>();

/** Сбрасывает кэш пользователя — вызывать при смене роли/активности админом. */
export function invalidateUserCache(userId: string): void {
  freshUsers.delete(userId);
}

export const requireAuth: preHandlerHookHandler = async (req) => {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }

  const id = req.user.sub;
  let fresh = freshUsers.get(id);
  if (!fresh || Date.now() - fresh.at > FRESH_TTL_MS) {
    const row = await one<{ access_role: AccessRole; is_active: boolean }>(
      `SELECT access_role, is_active FROM users WHERE id = $1`,
      [id],
    );
    if (!row) throw unauthorized("Пользователь больше не существует");
    fresh = { role: row.access_role, active: row.is_active, at: Date.now() };
    freshUsers.set(id, fresh);
  }
  if (!fresh.active) throw unauthorized("Аккаунт деактивирован администратором");

  // Роль из БД новее роли в токене — перезаписываем для всех последующих проверок
  req.user = { ...req.user, role: fresh.role };
};

const serverUser = (req: FastifyRequest): ServerUser => ({ id: req.user.sub, accessRole: req.user.role });

/* -------- проверка права (общие, без контекста задачи) -------- */
export function requirePerm(perm: PermId): preHandlerHookHandler {
  return async (req, reply: FastifyReply) => {
    const u = serverUser(req);
    if (roleHas(u.accessRole, perm)) return;
    await audit(u.id, "access.denied", perm, null, { path: req.url, method: req.method });
    throw forbidden(denialReason(u, perm));
  };
}

/* -------- проверка права с контекстом задачи (edit/transition/delete/comment) --------
   Загружает минимальную задачу в req.issueRef и проверяет can() с учётом уровня задачи. */
export function requireIssuePerm(perm: PermId): preHandlerHookHandler {
  return async (req) => {
    const u = serverUser(req);
    const id = (req.params as { id?: string }).id;
    if (!id) throw notFound("Задача не указана");
    const row = await one<{ id: string; assignee_id: string | null; reporter_id: string }>(
      `SELECT id, assignee_id, reporter_id FROM issues WHERE id = $1`,
      [id],
    );
    if (!row) throw notFound("Задача не найдена или удалена");
    const issueRef: IssueRef = { id: row.id, assigneeId: row.assignee_id, reporterId: row.reporter_id };
    req.issueRef = issueRef;
    if (!can(u, perm, issueRef)) {
      await audit(u.id, "access.denied", perm, issueRef.id, { path: req.url, method: req.method });
      throw forbidden(denialReason(u, perm, issueRef));
    }
  };
}
