/**
 * Taskira. Единый контракт API (Этап 2, обновлён корпоративной моделью 002
 * и project-scoped ролями — миграция 004 + Фаза 3, см. ROLE_MIGRATION.md).
 *
 * Этот файл — единственный источник правды о форматах запросов/ответов:
 *  - сервер валидирует входящие тела этими zod-схемами;
 *  - клиент (Этап 4) переиспользует типы ответов.
 *
 * Корпоративная модель (миграция 002, breaking — см. server/README.md):
 *  - типы задач: task | bug | request (story и epic слиты в task);
 *  - у задач есть due_date; points/sprint/epic — опциональные модули.
 *
 * Ролевая модель (миграция 004 + Фаза 3, breaking):
 *  - глобальная роль users.global_role: admin | member (GLOBAL_ROLES);
 *  - проектная роль project_members.role: manager | employee | viewer (PROJECT_ROLES);
 *  - эффективная роль (ACCESS_ROLES) = admin для global admin, иначе проектная;
 *  - CreateUserBody / ChangeRoleBody принимают globalRole (не accessRole).
 *
 * Multi-project (миграция 007, breaking — см. DEPT_MIGRATION.md):
 *  - департаменты; ресурсы проекта под /api/projects/:projectId/...;
 *  - состав проекта: PUT/DELETE /api/projects/:projectId/members/:userId (SetMemberBody).
 *
 * Лимиты зеркалят src/validation.ts фронтенда — меняются в двух местах синхронно.
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
/** Эффективная роль для матрицы прав (resolveRole). В ответах API. */
export const ACCESS_ROLES = ["admin", "manager", "employee", "viewer"] as const;
/** Глобальная роль ресурса (users.global_role). */
export const GLOBAL_ROLES = ["admin", "member"] as const;
/** Роль участника проекта (project_members.role). */
export const PROJECT_ROLES = ["manager", "employee", "viewer"] as const;
export const ISSUE_TYPES = ["task", "bug", "request"] as const;
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export const STATUS_CATEGORIES = ["todo", "inprogress", "done"] as const;
export const SPRINT_STATUSES = ["future", "active", "completed"] as const;

const uuid = z.string().uuid("Ожидается UUID");
/** Дата без времени, ГГГГ-ММ-ДД (для due_date и фильтров dueFrom/dueTo) */
const isoDate = (msg = "Ожидается дата в формате ГГГГ-ММ-ДД") => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

/** Строка в одну линию. min/max — ДО transform (иначе ZodEffects без .min). */
const oneLine = (max: number, min = 0, minMsg?: string) =>
  z
    .string()
    .min(min, minMsg)
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim());

const multiLine = (max: number, min = 0, minMsg?: string) =>
  z
    .string()
    .min(min, minMsg)
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim());

const label = () =>
  z.string().max(LIMITS.label.max).transform((s) => s.replace(/\s+/g, " ").trim().toLowerCase());

/* ---------------- Auth ---------------- */
export const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

/** POST /api/admin/users [global admin] — создать пользователя.
 *  globalRole задаёт лишь глобальную роль; членство в проекте назначается
 *  отдельно через PUT /api/project/members/:userId. */
export const CreateUserBody = z.object({
  username: z.string().min(LIMITS.username.min).max(LIMITS.username.max).regex(/^[a-z0-9._-]+$/i, "Латиница, цифры, точки и дефисы"),
  password: z.string().min(8).max(128),
  name: oneLine(80),
  initials: oneLine(4),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  jobRole: oneLine(40),
  globalRole: z.enum(GLOBAL_ROLES).default("member"),
  isActive: z.boolean().optional(),
});

/** PATCH /api/users/:id [global admin] — смена глобальной роли и/или деактивация */
export const ChangeRoleBody = z.object({
  globalRole: z.enum(GLOBAL_ROLES),
  isActive: z.boolean().optional(),
});

/** PUT /api/projects/:projectId/members/:userId [global admin] — добавить участника / сменить роль */
export const SetMemberBody = z.object({
  role: z.enum(PROJECT_ROLES),
});

/** :userId в путях управления составом проекта */
export const MemberParams = z.object({ userId: uuid });

/* ---------------- Departments / Projects (миграция 007) ---------------- */
/** :projectId в путях ресурсов проекта */
export const ProjectParams = z.object({ projectId: uuid });
/** :id в путях департамента */
export const DepartmentParams = z.object({ id: uuid });

/** POST/PATCH /api/departments[/:id] [global admin] */
export const DepartmentBody = z.object({
  name: oneLine(80, 1, "Название отдела не может быть пустым"),
});

/** Ключ проекта: заглавная латиница/цифры, начинается с буквы (CORP, SEC, IT2). */
const projectKey = z
  .string()
  .trim()
  .min(2)
  .max(10)
  .regex(/^[A-Z][A-Z0-9]+$/, "Ключ: заглавные латинские буквы и цифры, начинается с буквы");

/** POST /api/projects [global admin] — создаёт проект + дефолтный workflow. */
export const ProjectCreateBody = z.object({
  key: projectKey,
  name: oneLine(120, 1, "Название проекта не может быть пустым"),
  description: multiLine(2000).default(""),
  departmentId: uuid,
  isShared: z.boolean().default(false),
});

/** PATCH /api/projects/:projectId [global admin] */
export const ProjectPatchBody = z
  .object({
    name: oneLine(120, 1),
    description: multiLine(2000),
    departmentId: uuid,
    isShared: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/* ---------------- Issues ---------------- */
export const IssueCreateBody = z.object({
  title: oneLine(LIMITS.title.max, LIMITS.title.min, "Название не может быть пустым"),
  description: multiLine(LIMITS.description.max).default(""),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  assigneeId: uuid.nullable(),
  epicId: uuid.nullable(),
  labels: z.array(label()).max(LIMITS.labelsPerIssue).default([]),
  points: z.number().int().min(LIMITS.points.min).max(LIMITS.points.max).nullable(),
  sprintId: uuid.nullable(),
  dueDate: isoDate().nullable().optional(),
  statusId: uuid.optional(),
});

export const IssuePatchBody = z
  .object({
    title: oneLine(LIMITS.title.max, LIMITS.title.min),
    description: multiLine(LIMITS.description.max),
    priorityId: z.enum(PRIORITIES),
    assigneeId: uuid.nullable(),
    epicId: uuid.nullable(),
    labels: z.array(label()).max(LIMITS.labelsPerIssue),
    points: z.number().int().min(LIMITS.points.min).max(LIMITS.points.max).nullable(),
    sprintId: uuid.nullable(),
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
  beforeId: uuid.nullable().optional(),
});

export const CommentBody = z.object({
  body: multiLine(LIMITS.comment.max, LIMITS.comment.min, "Комментарий не может быть пустым"),
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
  overdue: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------- Ошибки и WebSocket ---------------- */
export type ApiError = { error: { code: string; reason: string } };

export type WsMessage =
  | { type: "issue:upsert"; actorId: string; issue: unknown; ts: number }
  | { type: "issue:delete"; actorId: string; issueId: string; ts: number }
  | { type: "sprint:changed"; actorId: string; ts: number }
  | { type: "workflow:changed"; actorId: string; ts: number }
  | { type: "presence"; online: string[]; ts: number };
