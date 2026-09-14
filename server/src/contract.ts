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
 *  - у задач есть due_date; complexity/epic — опциональные модули.
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
  goal: { max: 200 },
  username: { min: 3, max: 32 },
  department: { name: { min: 1, max: 80 }, ldapGroupDn: { max: 1024 } },
  project: { key: { min: 2, max: 10 }, name: { min: 1, max: 120 }, description: { max: 2000 } },
  // Вложения (FILES_MIGRATION.md D3). Дефолты; сервер переопределяет из ATTACH_* env.
  attachment: { maxBytes: 25 * 1024 * 1024, maxPerIssue: 50, maxFilename: 200 },
  // Чек-лист (миграция 019).
  checklistItem: { text: { min: 1, max: 200 } },
  checklistItemsPerIssue: 50,
  // Шаблоны задач (миграция 022).
  issueTemplate: { name: { min: 1, max: 60 } },
  issueTemplatesPerProject: 30,
  // Пользовательские поля (миграция 020).
  customField: { name: { min: 1, max: 60 }, optionMax: 60, optionsMax: 30 },
  customFieldsPerProject: 30,
  // Спринты (миграция 023, опциональный модуль — SPRINTS_MIGRATION.md).
  sprint: { name: { min: 1, max: 120 }, goal: { max: 500 } },
  sprintsPerProject: 200,
} as const;

/* ---------------- справочники ---------------- */
/** Эффективная роль для матрицы прав (resolveRole). В ответах API. */
export const ACCESS_ROLES = ["admin", "manager", "employee", "viewer"] as const;
/** Глобальная роль ресурса (users.global_role). */
export const GLOBAL_ROLES = ["admin", "member"] as const;
/** Роль участника проекта (project_members.role). */
export const PROJECT_ROLES = ["manager", "employee", "viewer"] as const;
export const ISSUE_TYPES = ["task", "bug", "request"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const COMPLEXITIES = ["simple", "medium", "hard"] as const;
export const STATUS_CATEGORIES = ["todo", "inprogress", "done"] as const;

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
  z
    .string()
    .min(1, "Метка не может быть пустой")
    .max(LIMITS.label.max)
    .transform((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .refine((s) => s.length > 0, "Метка не может быть пустой"); // пробельная строка → пусто после trim

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

/** :userId в путях приглашённых участников задачи (issue_collaborators, миграция 008).
 *  :id (задача) валидирует requireIssuePerm. Тела у PUT нет. */
export const CollaboratorParams = z.object({ userId: uuid });

// Вложения (миграция 010): у загрузки тело multipart (не JSON), а `:attId`
// роут проверяет инлайн-`UUID_RE` → 404 (паритет с `:id` в requireIssuePerm),
// а не zod → 400. Отдельной *Params-схемы здесь намеренно нет.

/* ---------------- Departments / Projects (миграция 007) ---------------- */
/** :projectId в путях ресурсов проекта */
export const ProjectParams = z.object({ projectId: uuid });
/** :id в путях департамента */
export const DepartmentParams = z.object({ id: uuid });

/** DN группы LDAP/AD (LDAP_MIGRATION.md D5). null — очистить привязку. */
const ldapGroupDn = z.string().trim().min(1).max(LIMITS.department.ldapGroupDn.max).nullable();

/** POST /api/departments [global admin] */
export const DepartmentBody = z.object({
  name: oneLine(LIMITS.department.name.max, LIMITS.department.name.min, "Название отдела не может быть пустым"),
  ldapGroupDn: ldapGroupDn.optional(),
});

/** PATCH /api/departments/:id [global admin] */
export const DepartmentPatchBody = z
  .object({
    name: oneLine(LIMITS.department.name.max, LIMITS.department.name.min),
    ldapGroupDn,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/** Ключ проекта: заглавная латиница/цифры, начинается с буквы (CORP, SEC, IT2). */
const projectKey = z
  .string()
  .trim()
  .min(LIMITS.project.key.min)
  .max(LIMITS.project.key.max)
  .regex(/^[A-Z][A-Z0-9]+$/, "Ключ: заглавные латинские буквы и цифры, начинается с буквы");

/** POST /api/projects [global admin] — создаёт проект + дефолтный workflow.
 *  sprintsEnabled по умолчанию false — включение модуля спринтов задумано
 *  как отдельно предоставляемая возможность (см. SPRINTS_MIGRATION.md), а
 *  не настройка, которую заводят по умолчанию каждому новому проекту. */
export const ProjectCreateBody = z.object({
  key: projectKey,
  name: oneLine(LIMITS.project.name.max, LIMITS.project.name.min, "Название проекта не может быть пустым"),
  description: multiLine(LIMITS.project.description.max).default(""),
  departmentId: uuid,
  isShared: z.boolean().default(false),
  sprintsEnabled: z.boolean().default(false),
});

/** PATCH /api/projects/:projectId [global admin] */
export const ProjectPatchBody = z
  .object({
    name: oneLine(LIMITS.project.name.max, LIMITS.project.name.min),
    description: multiLine(LIMITS.project.description.max),
    departmentId: uuid,
    isShared: z.boolean(),
    sprintsEnabled: z.boolean(),
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
  // Подзадача (миграция 021) — необязательно, задаётся кнопкой «+ подзадача»
  // на карточке родителя. Независимо от epicId («направление»).
  parentId: uuid.nullable().optional(),
  labels: z.array(label()).max(LIMITS.labelsPerIssue).default([]),
  complexity: z.enum(COMPLEXITIES).nullable(),
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
    parentId: uuid.nullable(),
    labels: z.array(label()).max(LIMITS.labelsPerIssue),
    complexity: z.enum(COMPLEXITIES).nullable(),
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

/* ---------------- Issue links (миграция 014) ---------------- */
/** Хранимый тип связи. 'relates' симметрична, 'blocks' направлена
 *  (issue_id блокирует linked_issue_id). См. ticket §3.2. */
export const ISSUE_LINK_TYPES = ["relates", "blocks"] as const;
export type IssueLinkType = (typeof ISSUE_LINK_TYPES)[number];

/** Эффективный тип связи «со стороны запрошенной задачи» — в ответе API.
 *  'blocked_by' — та же строка 'blocks', видимая с обратной стороны. */
export const ISSUE_LINK_DIRS = ["relates", "blocks", "blocked_by"] as const;
export type IssueLinkDir = (typeof ISSUE_LINK_DIRS)[number];

/** POST /api/projects/:projectId/issues/:id/links
 *  `type` — направление СО СТОРОНЫ :id (открытой задачи). 'blocked_by' сервер
 *  разворачивает в строку 'blocks' от блокирующей задачи к :id, поэтому запрос
 *  всегда идёт на /issues/:id/links и право проверяется на :id (ticket §3.2). */
export const IssueLinkCreateBody = z.object({
  linkedIssueId: uuid,
  type: z.enum(ISSUE_LINK_DIRS),
});

export const IssueLinkParams = z.object({ linkId: uuid });

/* ---------------- Checklist (миграция 019) ---------------- */
export const ChecklistItemCreateBody = z.object({
  text: oneLine(LIMITS.checklistItem.text.max, LIMITS.checklistItem.text.min, "Текст пункта не может быть пустым"),
});

export const ChecklistItemPatchBody = z
  .object({
    text: oneLine(LIMITS.checklistItem.text.max, LIMITS.checklistItem.text.min),
    done: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

export const ChecklistItemParams = z.object({ itemId: uuid });

/* ---------------- Issue templates (миграция 022) ---------------- */
/** statusId — необязательная подсказка стартового статуса; отсутствует/null —
 *  «как обычно» (сервер сам выбирает первый статус категории todo). */
export const IssueTemplateBody = z.object({
  name: oneLine(LIMITS.issueTemplate.name.max, LIMITS.issueTemplate.name.min, "Название шаблона не может быть пустым"),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  title: oneLine(LIMITS.title.max),
  description: multiLine(LIMITS.description.max).default(""),
  statusId: uuid.nullable().optional(),
});

export const IssueTemplateParams = z.object({ templateId: uuid });

/* ---------------- Спринты (миграция 023, опциональный модуль) ----------------
 * См. SPRINTS_MIGRATION.md — осознанное точечное исключение из
 * UI_RESTRUCTURE.md §D1, доступно только проектам с sprints_enabled=true.
 * Статус не приходит в теле ни одного запроса напрямую (переходы — отдельные
 * роуты /start, /complete) — здесь только тип, без zod-enum'а под него. */
export type SprintStatus = "future" | "active" | "completed";

export const SprintCreateBody = z.object({
  name: oneLine(LIMITS.sprint.name.max, LIMITS.sprint.name.min, "Название спринта не может быть пустым"),
  goal: multiLine(LIMITS.sprint.goal.max).default(""),
  startDate: isoDate().nullable().optional(),
  endDate: isoDate().nullable().optional(),
});

export const SprintParams = z.object({ sprintId: uuid });

/** PATCH /api/projects/:projectId/issues/:id/sprint — sprintId=null снимает
 *  задачу со спринта обратно в бэклог. */
export const MoveToSprintBody = z.object({ sprintId: uuid.nullable() });

/* ---------------- Custom fields (миграция 020) ---------------- */
/** Значения всех типов хранятся как text (custom_field_values.value) —
 *  разбор/проверка конкретного значения зависит от field_type и живёт в
 *  services/customFields.ts (validateValueForField), не здесь: статичная
 *  zod-схема не может знать, какое именно поле пришло в запросе. */
export const CUSTOM_FIELD_TYPES = ["text", "number", "select", "checkbox", "date"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CustomFieldCreateBody = z.object({
  name: oneLine(LIMITS.customField.name.max, LIMITS.customField.name.min, "Название поля не может быть пустым"),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  // Только для fieldType='select'; сервер игнорирует для остальных типов.
  options: z.array(oneLine(LIMITS.customField.optionMax, 1)).max(LIMITS.customField.optionsMax).default([]),
});

export const CustomFieldPatchBody = z.object({
  name: oneLine(LIMITS.customField.name.max, LIMITS.customField.name.min, "Название поля не может быть пустым"),
});

export const CustomFieldParams = z.object({ fieldId: uuid });

/** PUT .../issues/:id/custom-fields/:fieldId — value=null очищает поле. */
export const CustomFieldValueBody = z.object({
  value: z.string().max(500).nullable(),
});

/* ---------------- Notifications (миграция 011) ---------------- */
export const NOTIFY_TYPES = [
  "issue.assigned",
  "issue.comment",
  "issue.mention",
  "issue.status",
  "issue.collaborator",
  "project.member",
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

/** users.notify_prefs (D6). Хранится как jsonb; поля опциональны, дефолты — в коде
 *  (email 'instant' если у юзера есть email, иначе 'off'; selfWatch true). */
export type NotifyPrefs = { email?: "instant" | "daily" | "off"; selfWatch?: boolean };

/** PATCH /api/notifications/prefs — частичное обновление (мержится в jsonb). */
export const NotifyPrefsBody = z
  .object({
    email: z.enum(["instant", "daily", "off"]),
    selfWatch: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/** GET /api/notifications — query. */
export const NotificationsQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** POST /api/notifications/read — тело опционально; пусто = отметить все. */
export const MarkReadBody = z.object({ ids: z.array(uuid).max(500).optional() });

/** POST /api/notifications/dismiss — тело опционально; пусто = скрыть все свои. */
export const DismissNotificationsBody = MarkReadBody;

/* ---------------- Workflow / Users ---------------- */
export const TransitionCreateBody = z.object({ from: uuid, to: uuid });

/** GET /api/issues — query-параметры приходят строками; числа приводятся z.coerce. */
export const IssueQuery = z.object({
  status: uuid.optional(),
  assignee: uuid.optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  q: z.string().max(120).optional(),
  dueFrom: isoDate().optional(),
  dueTo: isoDate().optional(),
  overdue: z.enum(["1", "true"]).optional(),
  /** Архив (миграция 016): по умолчанию архивные скрыты; "1" — только архивные,
   *  "all" — вместе с активными (сквозной поиск и отчёты). */
  archived: z.enum(["1", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------- Отчёты (аудит: отчётность по отделам) ---------------- */
/** Группировка сводки: по проектам, по исполнителям или по типам задач. */
export const REPORT_GROUPS = ["project", "assignee", "type", "priority"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

/** GET /api/reports/summary — агрегаты «что закрыто за период».
 *  Без projectId — свод по всем видимым пользователю проектам. */
export const ReportQuery = z.object({
  from: isoDate("Ожидается дата начала периода в формате ГГГГ-ММ-ДД"),
  to: isoDate("Ожидается дата конца периода в формате ГГГГ-ММ-ДД"),
  projectId: uuid.optional(),
  departmentId: uuid.optional(),
  groupBy: z.enum(REPORT_GROUPS).default("project"),
});

/** GET /api/reports/issues.csv — выгрузка построчного среза за период.
 *  `scope`: closed — закрытые за период (по done_at); created — созданные;
 *  open — активные на текущий момент (period игнорируется для фильтра). */
export const ReportExportQuery = ReportQuery.omit({ groupBy: true }).extend({
  scope: z.enum(["closed", "created", "open"]).default("closed"),
  limit: z.coerce.number().int().min(1).max(10000).default(5000),
});

/* ---------------- Ошибки и WebSocket ---------------- */
export type ApiError = { error: { code: string; reason: string } };

export type WsMessage =
  | { type: "issue:upsert"; actorId: string; issue: unknown; ts: number }
  | { type: "issue:delete"; actorId: string; issueId: string; ts: number }
  | { type: "workflow:changed"; actorId: string; ts: number }
  | { type: "presence"; online: string[]; ts: number }
  /** Что-то в ленте уведомлений получателя изменилось — сигнал «сходи
   *  перечитай», без самого уведомления в payload (эндпоинт REST уже есть
   *  и уже проверяет права; дублировать сериализацию здесь незачем). */
  | { type: "notify"; ts: number }
  /** Ответ на успешный auth-хендшейк (routes/ws.ts) — клиент ждёт именно его,
   *  а не сам факт открытия соединения, чтобы сбросить экспоненциальный
   *  бэкофф переподключения (src/store.tsx): открытие TCP/WS ничего не
   *  говорит о том, принял ли сервер токен. */
  | { type: "auth_ok"; ts: number };

/** Клиент → сервер, единственное ожидаемое сообщение (routes/ws.ts): токен
 *  первым сообщением после открытия — браузерный WebSocket не умеет слать
 *  свои заголовки, поэтому Authorization для хендшейка не годится. */
export type WsAuthMessage = { type: "auth"; token: string };
