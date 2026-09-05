/**
 * Taskira. Единый контракт API (Этап 2).
 *
 * Этот файл — единственный источник правды о форматах запросов/ответов:
 *  - сервер валидирует входящие тела этими zod-схемами;
 *  - клиент (Этап 4) переиспользует типы ответов.
 *
 * Лимиты зеркалят src/validation.ts фронтенда — меняются в двух местах синхронно.
 * Зависимости сервера ставятся отдельно (Этап 3): npm i zod fastify @fastify/jwt @fastify/cors @fastify/websocket pg bcrypt
 */
import { z } from "zod";

/* ---------------- лимиты (зеркало клиента) ---------------- */
export const LIMITS = {
  title: { min: 1, max: 250 },
  description: { max: 5000 },
  comment: { min: 1, max: 2000 },
  label: { max: 30 },
  labelsPerIssue: 10,
  points: { min: 0, max: 100 },
  goal: { max: 200 },
  username: { min: 3, max: 32 },
} as const;

/* ---------------- справочники ---------------- */
export const ACCESS_ROLES = ["admin", "manager", "developer", "viewer"] as const;
export const ISSUE_TYPES = ["story", "task", "bug", "epic"] as const;
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export const STATUS_CATEGORIES = ["todo", "inprogress", "done"] as const;
export const SPRINT_STATUSES = ["future", "active", "completed"] as const;

const uuid = z.string().uuid("Ожидается UUID");
const oneLine = (max: number) =>
  z.string().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim());
const multiLine = (max: number) =>
  z.string().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim());
const label = () =>
  z.string().max(LIMITS.label).transform((s) => s.replace(/\s+/g, " ").trim().toLowerCase());

/* ---------------- Auth ---------------- */
export const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const CreateUserBody = z.object({
  username: z.string().min(LIMITS.username.min).max(LIMITS.username.max).regex(/^[a-z0-9._-]+$/i, "Латиница, цифры, точки и дефисы"),
  password: z.string().min(8).max(128),
  name: oneLine(80),
  initials: oneLine(4),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  jobRole: oneLine(40),
  accessRole: z.enum(ACCESS_ROLES),
});

export const ChangeRoleBody = z.object({ accessRole: z.enum(ACCESS_ROLES) });

/* ---------------- Issues ---------------- */
export const IssueCreateBody = z.object({
  title: oneLine(LIMITS.title.max).min(LIMITS.title.min, "Название не может быть пустым"),
  description: multiLine(LIMITS.description.max).default(""),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  assigneeId: uuid.nullable(),
  epicId: uuid.nullable(),
  labels: z.array(label()).max(LIMITS.labelsPerIssue).default([]),
  points: z.number().int().min(LIMITS.points.min).max(LIMITS.points.max).nullable(),
  sprintId: uuid.nullable(),
  statusId: uuid.optional(), // по умолчанию — первый статус категории todo
});

export const IssuePatchBody = z
  .object({
    title: oneLine(LIMITS.title.max).min(LIMITS.title.min),
    description: multiLine(LIMITS.description.max),
    priorityId: z.enum(PRIORITIES),
    assigneeId: uuid.nullable(),
    epicId: uuid.nullable(),
    labels: z.array(label()).max(LIMITS.labelsPerIssue),
    points: z.number().int().min(LIMITS.points.min).max(LIMITS.points.max).nullable(),
    sprintId: uuid.nullable(), // требует права manageSprints — проверяется в роуте
    tStart: z.number().int().min(0).max(52).nullable(),
    tSpan: z.number().int().min(1).max(52).nullable(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/** Смена статуса: сервер сверяет переход с workflow_transitions и право transition. */
export const TransitionBody = z.object({
  to: uuid,
  beforeId: uuid.nullable().optional(), // для пересчёта rank внутри колонки
});

export const CommentBody = z.object({
  body: multiLine(LIMITS.comment.max).min(LIMITS.comment.min, "Комментарий не может быть пустым"),
});

/* ---------------- Sprints / Workflow / Users ---------------- */
export const MoveToSprintBody = z.object({ sprintId: uuid.nullable() });

export const TransitionCreateBody = z.object({ from: uuid, to: uuid });

export const IssueQuery = z.object({
  status: uuid.optional(),
  sprint: uuid.optional(),
  assignee: uuid.optional(),
  q: z.string().max(120).optional(),
});

/* ---------------- Ошибки и WebSocket ---------------- */
/** Единый формат ошибки. code: FORBIDDEN | UNAUTHORIZED | VALIDATION | NOT_FOUND | CONFLICT */
export type ApiError = { error: { code: string; reason: string } };

/** Сообщения realtime-канала. actorId нужен клиенту для подавления собственного эха. */
export type WsMessage =
  | { type: "issue:upsert"; actorId: string; issue: unknown; ts: number }
  | { type: "issue:delete"; actorId: string; issueId: string; ts: number }
  | { type: "sprint:changed"; actorId: string; ts: number }
  | { type: "workflow:changed"; actorId: string; ts: number }
  | { type: "presence"; online: string[]; ts: number };

/* ---------------- Карта эндпоинтов (справка, роуты — в Этапе 3) ----------------
POST   /api/auth/login                    LoginBody            → { token, user }
GET    /api/auth/me                                            → User
GET    /api/project                                            → { project, users, workflow, sprints }
GET    /api/issues                          IssueQuery         → Issue[]
POST   /api/issues                          IssueCreateBody    → Issue        [create]
PATCH  /api/issues/:id                      IssuePatchBody     → Issue        [edit; developer — только свои]
DELETE /api/issues/:id                                                            [delete]
POST   /api/issues/:id/transition           TransitionBody     → Issue        [transition + схема workflow]
POST   /api/issues/:id/comments             CommentBody        → Comment      [comment]
PATCH  /api/issues/:id/sprint               MoveToSprintBody   → Issue        [manageSprints]
POST   /api/sprints/start                                        → Sprint      [manageSprints]
POST   /api/sprints/:id/complete                                → Sprint[]    [manageSprints]
GET    /api/workflow                                             → Workflow
POST   /api/workflow/transitions            TransitionCreateBody                [admin]
DELETE /api/workflow/transitions/:id                                             [admin]
POST   /api/workflow/reset                                                         [admin]
GET    /api/users                                                                    [admin]
POST   /api/admin/users                     CreateUserBody                          [admin]
PATCH  /api/users/:id                       ChangeRoleBody                          [admin]
WS     /api/ws?token=…                                          → WsMessage
----------------------------------------------------------------------------- */
