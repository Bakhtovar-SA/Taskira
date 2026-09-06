/**
 * Taskira. Единый контракт API (Этап 2, обновлён корпоративной моделью 002).
 *
 * Этот файл — единственный источник правды о форматах запросов/ответов:
 *  - сервер валидирует входящие тела этими zod-схемами;
 *  - клиент (Этап 4) переиспользует типы ответов.
 *
 * Корпоративная модель (миграция 002, breaking — см. server/README.md):
 *  - роли: admin | manager | employee | viewer (developer упразднена);
 *  - типы задач: task | bug | request (story и epic слиты в task);
 *  - у задач есть due_date; points/sprint/epic — опциональные модули.
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
export const ACCESS_ROLES = ["admin", "manager", "employee", "viewer"] as const;
export const ISSUE_TYPES = ["task", "bug", "request"] as const;
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export const STATUS_CATEGORIES = ["todo", "inprogress", "done"] as const;
export const SPRINT_STATUSES = ["future", "active", "completed"] as const;

const uuid = z.string().uuid("Ожидается UUID");
/** Дата без времени, ГГГГ-ММ-ДД (для due_date и фильтров dueFrom/dueTo) */
const isoDate = (msg = "Ожидается дата в формате ГГГГ-ММ-ДД") => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
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
  isActive: z.boolean().optional(), // по умолчанию true
});

/** PATCH /api/users/:id [admin] — смена роли и/или деактивация аккаунта */
export const ChangeRoleBody = z.object({
  accessRole: z.enum(ACCESS_ROLES),
  isActive: z.boolean().optional(),
});

/* ---------------- Issues ---------------- */
export const IssueCreateBody = z.object({
  title: oneLine(LIMITS.title.max).min(LIMITS.title.min, "Название не может быть пустым"),
  description: multiLine(LIMITS.description.max).default(""),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  assigneeId: uuid.nullable(),
  epicId: uuid.nullable(), // опциональная группировка, не развивается
  labels: z.array(label()).max(LIMITS.labelsPerIssue).default([]),
  points: z.number().int().min(LIMITS.points.min).max(LIMITS.points.max).nullable(),
  sprintId: uuid.nullable(),
  dueDate: isoDate().nullable().optional(),
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
    dueDate: isoDate().nullable(),
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

/** GET /api/issues — query-параметры приходят строками; числа приводятся z.coerce. */
export const IssueQuery = z.object({
  status: uuid.optional(),
  sprint: uuid.optional(),
  assignee: uuid.optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  q: z.string().max(120).optional(),
  dueFrom: isoDate().optional(),
  dueTo: isoDate().optional(),
  overdue: z.enum(["1", "true"]).optional(), // due_date < сегодня и статус не done
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------- Ошибки и WebSocket ---------------- */
/** Единый формат ошибки.
    code: UNAUTHORIZED | FORBIDDEN | VALIDATION | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL */
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
GET    /api/issues                          IssueQuery         → { items, total }  (фильтры: status, sprint,
                                                                assignee, type, q, dueFrom, dueTo, overdue, limit, offset)
POST   /api/issues                          IssueCreateBody    → Issue        [create]
PATCH  /api/issues/:id                      IssuePatchBody     → Issue        [edit; employee — только свои]
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
