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
import { passwordPolicyError } from "./passwordPolicy.js";

/* ---------------- лимиты (зеркало клиента) ---------------- */
export const LIMITS = {
  title: { min: 1, max: 250 },
  description: { max: 5000 },
  comment: { min: 1, max: 2000 },
  label: { max: 30 },
  labelsPerIssue: 10,
  // Исполнители (миграция 025, issue_assignees) — щедрый потолок, не рабочий
  // предел: не про то, сколько людей РЕАЛЬНО стоит вешать на задачу.
  assigneesPerIssue: 10,
  goal: { max: 200 },
  username: { min: 3, max: 32 },
  department: { name: { min: 1, max: 80 }, ldapGroupDn: { max: 1024 } },
  project: { key: { min: 2, max: 10 }, name: { min: 1, max: 120 }, description: { max: 2000 } },
  // Вложения (FILES_MIGRATION.md D3). Дефолты; сервер переопределяет из ATTACH_* env.
  attachment: { maxBytes: 25 * 1024 * 1024, maxPerIssue: 50, maxFilename: 200 },
  // Аватарка пользователя (миграция 027) — тот же Storage, отдельный потолок;
  // сервер переопределяет из AVATAR_MAX_BYTES env.
  avatar: { maxBytes: 3 * 1024 * 1024 },
  phone: { max: 30 },
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
  // Сохранённые вьюхи (ТЗ 3.2, план v2 Трек 3, миграция 20260922T1100) — личные
  // (user_id), не общие для проекта, поэтому потолок разумно щедрый, как у
  // остальных «личных» коллекций (избранные проекты не лимитированы вовсе, но
  // вьюха тяжелее — имя + условия — лимит здесь не лишний).
  savedView: { name: { min: 1, max: 60 } },
  savedViewsPerUserProject: 30,
  // Массовые операции (ТЗ 3.3, план v2 Трек 3) — потолок на один запрос:
  // защита от случайного/злонамеренного выделения «вообще всего проекта»
  // одним кликом и от запроса, который блокирует БД на непредсказуемое время.
  bulkIssuesMax: 100,
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
  password: z.string().max(128),
  name: oneLine(80),
  initials: oneLine(4),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  jobRole: oneLine(40),
  phone: oneLine(LIMITS.phone.max).optional(),
  globalRole: z.enum(GLOBAL_ROLES).default("member"),
  isActive: z.boolean().optional(),
}).superRefine((body, ctx) => {
  const message = passwordPolicyError(body.password, body.username);
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message });
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
/** :id/:userId в путях состава департамента (ручное добавление, 009_ldap.sql
 *  завёл department_members.source='manual' в схеме, но роут для него
 *  появился только сейчас). */
export const DepartmentMemberParams = z.object({ id: uuid, userId: uuid });

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

/** Исполнители (миграция 025, issue_assignees) — плоский список без иерархии,
 *  без дублей. Пустой массив = не назначен (эквивалент старого assigneeId: null). */
const assigneeIds = () =>
  z
    .array(uuid)
    .max(LIMITS.assigneesPerIssue, `Не больше ${LIMITS.assigneesPerIssue} исполнителей`)
    .refine((arr) => new Set(arr).size === arr.length, "Исполнители не должны повторяться");

/* ---------------- Issues ---------------- */
export const IssueCreateBody = z.object({
  title: oneLine(LIMITS.title.max, LIMITS.title.min, "Название не может быть пустым"),
  description: multiLine(LIMITS.description.max).default(""),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  assigneeIds: assigneeIds().default([]),
  epicId: uuid.nullable(),
  // Подзадача (миграция 021) — необязательно, задаётся кнопкой «+ подзадача»
  // на карточке родителя. Независимо от epicId («направление»).
  parentId: uuid.nullable().optional(),
  labels: z.array(label()).max(LIMITS.labelsPerIssue).default([]),
  complexity: z.enum(COMPLEXITIES).nullable(),
  dueDate: isoDate().nullable().optional(),
  statusId: uuid.optional(),
  /** Начальный чек-лист создаётся атомарно вместе с задачей. */
  checklistItems: z
    .array(oneLine(LIMITS.checklistItem.text.max, LIMITS.checklistItem.text.min, "Текст пункта не может быть пустым"))
    .max(LIMITS.checklistItemsPerIssue)
    .default([]),
});

export const IssuePatchBody = z
  .object({
    title: oneLine(LIMITS.title.max, LIMITS.title.min),
    description: multiLine(LIMITS.description.max),
    priorityId: z.enum(PRIORITIES),
    assigneeIds: assigneeIds(),
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

/** ТЗ 3.3 (план v2 Трек 3): массовые операции — панель действий применяет РОВНО
 *  одно изменение ко всей выборке за раз (не произвольный многополый patch), тем
 *  же четырём кнопкам, что в самом ТЗ P0-5: статус, исполнитель, приоритет,
 *  удаление. Спринт сознательно не входит (план v2: «спринты в парковке»).
 *  Права проверяются НА КАЖДУЮ задачу индивидуально при выполнении (routes/
 *  issuesBulk.ts), а не одной проверкой на весь батч — сотрудник с task-level
 *  ограничением получает частичный успех, а не общий отказ по первой чужой задаче. */
const bulkIssueIds = z.array(uuid).min(1).max(LIMITS.bulkIssuesMax);
export const BulkIssueAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), issueIds: bulkIssueIds, statusId: uuid }),
  // "none" — снять всех исполнителей; иначе список заменяется РОВНО одним
  // указанным (простое, предсказуемое действие кнопки, а не слияние со
  // старым списком — при multiple assignees (миграция 025) "добавить всем"
  // не одно и то же, что "поставить всем", и кнопка называет второе).
  z.object({ action: z.literal("assignee"), issueIds: bulkIssueIds, assigneeId: z.union([uuid, z.literal("none")]) }),
  z.object({ action: z.literal("priority"), issueIds: bulkIssueIds, priorityId: z.enum(PRIORITIES) }),
  z.object({ action: z.literal("delete"), issueIds: bulkIssueIds }),
]);
export type BulkIssueAction = z.infer<typeof BulkIssueAction>;

/** Частичный успех — «Изменено 8 из 10, 2 пропущено» (ТЗ 3.3). `reason` —
 *  человекочитаемая причина отказа по КОНКРЕТНОЙ задаче (нет прав, не найдена,
 *  недопустимый переход по workflow) — тот же принцип, что denialReason()
 *  (permissions.ts), не общий "forbidden". */
export const BulkIssueResultDto = z.object({
  succeeded: z.array(z.string()),
  failed: z.array(z.object({ issueId: z.string(), reason: z.string() })),
});
export type BulkIssueResultDto = z.infer<typeof BulkIssueResultDto>;

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
 *  (email 'instant' если у юзера есть email, иначе 'off'; selfWatch true).
 *  'off' остаётся допустимым значением ЭТОГО типа (чтение) — это внутренний
 *  сентинел "у пользователя нет email" (notify.ts/notifier.ts), а не то, что
 *  пользователь теперь может выбрать сам — см. NotifyPrefsBody ниже (миграция
 *  028: почтовые уведомления больше нельзя выключить вручную). */
export const NotifyPrefs = z.object({
  email: z.enum(["instant", "daily", "off"]).optional(),
  selfWatch: z.boolean().optional(),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefs>;

/** PATCH /api/notifications/prefs — частичное обновление (мержится в jsonb).
 *  'off' сознательно исключён из ЭТОЙ схемы (миграция 028) — пользователь
 *  выбирает только режим доставки, выключить почту целиком больше нельзя. */
export const NotifyPrefsBody = z
  .object({
    email: z.enum(["instant", "daily"]),
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

/** Фильтры списка задач. Общие для страницы (`GET …/issues`) и счётчиков
 *  (`GET …/issues/counts`): счётчик обязан считать ровно тот же набор, что
 *  листает страница, иначе заголовок колонки расходится с её содержимым. */
export const ISSUE_SORTS = ["rank", "priority", "due", "updated", "key"] as const;
export const IssueFilterQuery = z.object({
  status: uuid.optional(),
  /** uuid — исполнитель; "none" — задачи без исполнителей. */
  assignee: z.union([uuid, z.literal("none")]).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  /** ТЗ 3.2 (план v2 Трек 3): условия визуального конструктора сохранённых
   *  вьюх — тот же набор фильтров, что и остальные здесь (одно значение на
   *  условие, как status/assignee/type, а не массив — конструктор в этом
   *  релизе не строит OR внутри одного измерения; расширить до массива —
   *  обратно совместимое дополнение поля, не новая миграция). `label` — точное
   *  совпадение одной метки (issues.labels — text[]); `sprintId` игнорируется
   *  молча, если у проекта выключен модуль спринтов (project.sprintsEnabled) —
   *  список задач не должен 404-ить из-за фильтра, который просто ни на что
   *  не влияет на этом проекте. Фильтр по кастомному полю НЕ входит в этот
   *  релиз (см. docs/tickets/ROUTE-02-custom-field-filter-deferred.md). */
  priority: z.enum(PRIORITIES).optional(),
  label: z.string().max(60).optional(),
  sprintId: uuid.optional(),
  /** Дети одной задачи: подзадачи (`parentId`, миграция 021) и задачи
   *  «направления» (`epicId`). Те же пагинация, сортировка и права, что у списка,
   *  поэтому для карточки не нужен отдельный путь. Подзадачи лежат в проекте
   *  родителя; архивные скрыты, как и везде, — `archived=all` вернёт их. */
  parentId: uuid.optional(),
  epicId: uuid.optional(),
  q: z.string().max(120).optional(),
  dueFrom: isoDate().optional(),
  dueTo: isoDate().optional(),
  overdue: z.enum(["1", "true"]).optional(),
  /** Закрытые задачи (категория статуса `done`): "hide" — скрыть все,
   *  "recent" — только закрытые за последние `closedDays` дней (задачи без
   *  done_at, закрытые до миграции 016, считаются свежими), "older" — только
   *  более давние. Окно «Готово» доски (DONE_WINDOW_DAYS) живёт здесь, а не в
   *  клиентском фильтре по уже загруженному набору. */
  closed: z.enum(["hide", "recent", "older"]).optional(),
  closedDays: z.coerce.number().int().min(1).max(3650).default(14),
  /** Архив (миграция 016): по умолчанию архивные скрыты; "1" — только архивные,
   *  "all" — вместе с активными (сквозной поиск и отчёты). */
  archived: z.enum(["1", "all"]).optional(),
});

/** ТЗ 3.2 (план v2 Трек 3): условия визуального конструктора сохранённых вьюх —
 *  подмножество `IssueFilterQuery` (без пагинации/сортировки/архива/диапазона
 *  дат — конструктор не выставляет их как условие «вьюхи», это параметры
 *  просмотра, не сохраняемого набора условий). Хранится как есть в
 *  `saved_views.filter_json`; при применении разворачивается в query-параметры
 *  GET …/issues теми же именами полей — конвертации нет. */
export const SavedViewFilter = z
  .object({
    status: uuid.optional(),
    assignee: z.union([uuid, z.literal("none")]).optional(),
    type: z.enum(ISSUE_TYPES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    label: z.string().max(60).optional(),
    sprintId: uuid.optional(),
    q: z.string().max(120).optional(),
  })
  // .strict(), не молчаливая обрезка неизвестных полей — иначе сохранение вьюхи
  // с опечаткой в имени условия или полем, которое конструктор ещё не поддерживает
  // (например, будущий customField), тихо теряло бы это условие вместо явной 400.
  .strict();
export type SavedViewFilter = z.infer<typeof SavedViewFilter>;

export const SavedViewBody = z.object({
  name: z.string().min(LIMITS.savedView.name.min).max(LIMITS.savedView.name.max),
  filter: SavedViewFilter,
  isDefault: z.boolean().optional().default(false),
});

export const SavedViewParams = z.object({ viewId: uuid });

export const SavedViewDto = z.object({
  id: z.string(),
  name: z.string(),
  filter: SavedViewFilter,
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedViewDto = z.infer<typeof SavedViewDto>;

/** GET /api/issues — query-параметры приходят строками; числа приводятся z.coerce. */
export const IssueQuery = IssueFilterQuery.extend({
  /** Точный total дорог: по умолчанию страница возвращает только hasMore,
   *  `includeTotal=1|true` — явный opt-in для редких потребителей. */
  includeTotal: z.enum(["1", "true"]).optional(),
  /** Порядок выдачи. `rank` — порядок доски; остальные — сортировки «Списка
   *  задач». Тай-брейк — номер задачи в том же направлении, что и `dir`. */
  sort: z.enum(ISSUE_SORTS).default("rank"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  /** Непрозрачный keyset-курсор. При наличии имеет приоритет над offset;
   *  offset остаётся на expand-релиз для совместимости старых клиентов.
   *  Курсор привязан к sort/dir, с которыми выдан. */
  cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET …/issues/counts — тот же набор фильтров, без пагинации и сортировки. */
export const IssueCountsQuery = IssueFilterQuery;

/** GET …/issues/epics — направления проекта («эпик» — задача, на которую
 *  ссылаются другие через epicId) с агрегатом по активным детям. Timeline и
 *  справочник направлений доски/списка читают его вместо обхода всех задач. */
export const IssueEpicsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** GET …/issues/assignees — исполнители активных задач проекта по убыванию
 *  нагрузки. Доска строит по нему полоску аватаров-фильтров: раньше она
 *  выводила её из всех загруженных задач, а при ленивой загрузке их не видно. */
export const IssueAssigneesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

/** Метаданные страницы списка задач. И серверный payload, и его TS-тип
 * выводятся из этой схемы; `total` отсутствует без явного includeTotal. */
export const IssueListPageMeta = z.object({
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});
export type IssueListPageMeta = z.infer<typeof IssueListPageMeta>;

/** GET /api/issues/search — кросс-проектный поиск (миграция 024), project-less,
 *  по всем видимым пользователю проектам (см. routes/home.ts для того же
 *  предиката видимости). В отличие от IssueQuery.q (фильтр внутри уже
 *  выбранного проекта) здесь запрос обязателен — без него нечего искать. */
export const SearchQuery = z.object({
  q: z.string().min(1).max(120),
});

/** GET /api/issues/resolve — ключ задачи (CORP-123, человекочитаемый, из URL ТЗ 3.1)
 *  → id/projectId/projectKey. Project-less, по тому же предикату видимости, что
 *  /api/issues/search — ключ глобально уникален (issues.key UNIQUE, миграция 001),
 *  поэтому проект для поиска указывать не нужно. */
export const IssueResolveQuery = z.object({
  key: z.string().min(1).max(40),
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

/* ---------------- Ответы API: типы выводятся из схем (ТЗ 2.1) ----------------
 * Это ЕДИНСТВЕННОЕ описание формы ответов: сервер аннотирует ими возвращаемые значения мапперов
 * (mapIssue и др.), клиент импортирует те же типы (import type, в бандл ничего не попадает).
 *
 * ВАЖНО: схема здесь — только источник ТИПОВ. Ответы сервера через неё в рантайме НЕ проверяются (нет .parse()),
 * поэтому наличие схемы не гарантирует, что маппер вернёт то, что объявлено: SQL-строки приводятся к типу
 * `q<Row>` без проверки. Строже, чем «объявлено», выйти можно только явным .parse() на границе — осознанно не
 * добавлен. Поля с CHECK в БД (typeId, priorityId, complexity, статус-категория, dir) описаны как z.enum: JSON на
 * проводе тот же, но опечатку "hgih" ловит typecheck.
 */
const ActorMini = z.object({ id: z.string(), name: z.string(), initials: z.string(), color: z.string() });

/** Мини-профиль участника задачи — чтобы карточку можно было отрисовать без bootstrap проекта
 *  (одиночный просмотр приглашённого, COLLAB_MIGRATION.md Фаза 6). */
export const ParticipantDto = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
});
export type ParticipantDto = z.infer<typeof ParticipantDto>;

export const CollaboratorDto = z.object({
  userId: z.string(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
  addedAt: z.string(),
});
export type CollaboratorDto = z.infer<typeof CollaboratorDto>;

export const AttachmentDto = z.object({
  id: z.string(),
  issueId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number(),
  sha256: z.string(),
  uploadedById: z.string().nullable(),
  createdAt: z.string(),
});
export type AttachmentDto = z.infer<typeof AttachmentDto>;

export const ChecklistItemDto = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  position: z.number(),
  createdAt: z.string(),
});
export type ChecklistItemDto = z.infer<typeof ChecklistItemDto>;

export const IssueLinkDto = z.object({
  id: z.string(),
  /** тип связи со стороны запрошенной задачи */
  dir: z.enum(ISSUE_LINK_DIRS),
  /** задача на другом конце связи */
  issue: z.object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    typeId: z.enum(ISSUE_TYPES),
    statusId: z.string(),
    statusCategory: z.enum(STATUS_CATEGORIES),
  }),
  createdAt: z.string(),
});
export type IssueLinkDto = z.infer<typeof IssueLinkDto>;

export const CustomFieldValueDto = z.object({ fieldId: z.string(), value: z.string().nullable() });
export type CustomFieldValueDto = z.infer<typeof CustomFieldValueDto>;

/** total/done по ВСЕМ детям, включая заархивированных. */
export const SubtasksSummaryDto = z.object({ total: z.number(), done: z.number() });
export type SubtasksSummaryDto = z.infer<typeof SubtasksSummaryDto>;

export const CommentDto = z.object({
  id: z.string(),
  issueId: z.string(),
  authorId: z.string(),
  author: ActorMini,
  body: z.string(),
  createdAt: z.string(),
});
export type CommentDto = z.infer<typeof CommentDto>;

export const ActivityDto = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actor: ActorMini.nullable(),
  text: z.string(),
  createdAt: z.string(),
});
export type ActivityDto = z.infer<typeof ActivityDto>;

export const IssueDto = z.object({
  id: z.string(),
  projectId: z.string(),
  num: z.number(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  typeId: z.enum(ISSUE_TYPES),
  statusId: z.string(),
  priorityId: z.enum(PRIORITIES),
  /** Исполнители (issue_assignees, миграция 025) — плоский список. */
  assigneeIds: z.array(z.string()),
  reporterId: z.string(),
  epicId: z.string().nullable(),
  /** Родитель-подзадачи (миграция 021); независимо от epicId. */
  parentId: z.string().nullable(),
  /** Спринт (миграция 023, опциональный модуль). */
  sprintId: z.string().nullable(),
  color: z.string().nullable(),
  tStart: z.number().nullable(),
  tSpan: z.number().nullable(),
  complexity: z.enum(COMPLEXITIES).nullable(),
  labels: z.array(z.string()),
  dueDate: z.string().nullable(),
  rank: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Момент закрытия (миграция 016); null — задача не закрыта. */
  doneAt: z.string().nullable(),
  /** Момент ухода в архив; null — задача в активном наборе проекта. */
  archivedAt: z.string().nullable(),
});
export type IssueDto = z.infer<typeof IssueDto>;

/** Карточка задачи: DTO + участники/вложения/связи/чеклист — только в детальном ответе GET /:id, не в списке. */
export const IssueDetailDto = IssueDto.extend({
  collaborators: z.array(CollaboratorDto),
  participants: z.array(ParticipantDto),
  attachments: z.array(AttachmentDto),
  links: z.array(IssueLinkDto),
  checklist: z.array(ChecklistItemDto),
  customFieldValues: z.array(CustomFieldValueDto),
  subtasksSummary: SubtasksSummaryDto,
  /** Число активных задач с epic_id = эта задача (0 — она не «направление»). */
  epicChildrenCount: z.number(),
});
export type IssueDetailDto = z.infer<typeof IssueDetailDto>;

/* ---- проекты, пользователи, workflow, bootstrap (ТЗ 2.1, PR 2) ---- */

export const SafeUser = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
  /** Телефон (миграция 026) — из AD у LDAP-пользователей, вручную при создании локального. "" — не заполнен. */
  phone: z.string(),
  /** Глобальная роль ресурса (users.global_role) — источник прав. Проектная роль — в bootstrap `members`. */
  globalRole: z.enum(GLOBAL_ROLES),
  isActive: z.boolean(),
  /** local | ldap (миграция 009) — у ldap-юзеров роль/профиль из директории. */
  authSource: z.enum(["local", "ldap"]),
  /** мс эпохи последней загрузки аватарки (миграция 027) — null, если её нет; cache-buster для /users/:id/avatar. */
  avatarUpdatedAt: z.number().nullable(),
});
export type SafeUser = z.infer<typeof SafeUser>;

/** GET /api/auth/me: профиль + то, что видно только себе (настройки уведомлений, избранные проекты). */
export const MeDto = SafeUser.extend({ notifyPrefs: NotifyPrefs, favoriteProjectIds: z.array(z.string()) });
export type MeDto = z.infer<typeof MeDto>;

export const ProjectDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  departmentId: z.string(),
  isShared: z.boolean(),
  sprintsEnabled: z.boolean(),
});
export type ProjectDto = z.infer<typeof ProjectDto>;

/** ldapGroupDn — DN корпоративной AD-группы: только глобальному admin (для остальных — null). */
export const DepartmentDto = z.object({
  id: z.string(),
  name: z.string(),
  ldapGroupDn: z.string().nullable(),
  projectCount: z.number(),
});
export type DepartmentDto = z.infer<typeof DepartmentDto>;

/** source: 'ldap' пересобирается синхронизацией (departmentSync.ts), 'manual' — добавлено вручную. */
export const DepartmentMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
  source: z.enum(["ldap", "manual"]),
});
export type DepartmentMemberDto = z.infer<typeof DepartmentMemberDto>;

export const StatusDto = z.object({
  id: z.string(),
  sid: z.string(),
  name: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  position: z.number(),
});
export type StatusDto = z.infer<typeof StatusDto>;

/** Ребро схемы переходов в camelCase: `{ id, from, to }` (SQL-строка — snake_case). */
export const TransitionDto = z.object({ id: z.string(), from: z.string(), to: z.string() });
export type TransitionDto = z.infer<typeof TransitionDto>;

export const WorkflowDto = z.object({ statuses: z.array(StatusDto), transitions: z.array(TransitionDto) });
export type WorkflowDto = z.infer<typeof WorkflowDto>;

export const SprintDto = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  status: z.enum(["future", "active", "completed"]),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});
export type SprintDto = z.infer<typeof SprintDto>;

export const IssueTemplateDto = z.object({
  id: z.string(),
  name: z.string(),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  title: z.string(),
  description: z.string(),
  statusId: z.string().nullable(),
  position: z.number(),
});
export type IssueTemplateDto = z.infer<typeof IssueTemplateDto>;

export const CustomFieldDto = z.object({
  id: z.string(),
  name: z.string(),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string()),
  position: z.number(),
});
export type CustomFieldDto = z.infer<typeof CustomFieldDto>;

/** Состав проекта: userId → проектная роль. Права me считаются из globalRole + этого. */
export const ProjectMemberDto = z.object({ userId: z.string(), role: z.enum(PROJECT_ROLES) });
export type ProjectMemberDto = z.infer<typeof ProjectMemberDto>;

/** GET /api/projects/:projectId — всё, что нужно клиенту при входе в проект (кроме самих задач). */
export const ProjectBootstrapDto = z.object({
  project: ProjectDto,
  users: z.array(SafeUser),
  members: z.array(ProjectMemberDto),
  workflow: WorkflowDto,
  issueTemplates: z.array(IssueTemplateDto),
  customFields: z.array(CustomFieldDto),
  sprints: z.array(SprintDto),
});
export type ProjectBootstrapDto = z.infer<typeof ProjectBootstrapDto>;

/* ---- уведомления, главный экран, поиск, счётчики, отчёты (ТЗ 2.1, PR 3) ---- */

export const NotificationDto = z.object({
  id: z.string(),
  type: z.enum(NOTIFY_TYPES),
  actorId: z.string().nullable(),
  actor: ActorMini.nullable(),
  projectId: z.string().nullable(),
  issueId: z.string().nullable(),
  payload: z.record(z.union([z.string(), z.boolean()]).optional()),
  createdAt: z.string(),
  read: z.boolean(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationPageDto = z.object({ items: z.array(NotificationDto), nextCursor: z.string().nullable() });
export type NotificationPageDto = z.infer<typeof NotificationPageDto>;

export const UnreadCountDto = z.object({ count: z.number() });
export type UnreadCountDto = z.infer<typeof UnreadCountDto>;

export const NotifyPrefsResponse = z.object({ notifyPrefs: NotifyPrefs });
export type NotifyPrefsResponse = z.infer<typeof NotifyPrefsResponse>;

/** Мини-пользователь для пикеров (GET /api/users/pickable). */
export const PickableUserDto = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
});
export type PickableUserDto = z.infer<typeof PickableUserDto>;

/** Элемент «Моих подключений» (GET /api/issues/collaborating). */
export const CollaboratingItemDto = z.object({
  issueId: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  statusId: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
  projectKey: z.string(),
  projectName: z.string(),
});
export type CollaboratingItemDto = z.infer<typeof CollaboratingItemDto>;

/** Задача, назначенная мне (GET /api/issues/assigned-to-me) — главный экран. */
export const AssignedIssueDto = z.object({
  issueId: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  statusId: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
  dueDate: z.string().nullable(),
  projectKey: z.string(),
  projectName: z.string(),
});
export type AssignedIssueDto = z.infer<typeof AssignedIssueDto>;

/** Список урезан до `limit`: `truncated` — честный признак, что показана не вся выдача. */
export const AssignedToMeDto = z.object({ items: z.array(AssignedIssueDto), truncated: z.boolean(), limit: z.number() });
export type AssignedToMeDto = z.infer<typeof AssignedToMeDto>;

/** Результат кросс-проектного поиска (GET /api/issues/search, миграция 024). */
export const SearchResultItemDto = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  typeId: z.enum(ISSUE_TYPES),
  priorityId: z.enum(PRIORITIES),
  statusId: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
  projectKey: z.string(),
  projectName: z.string(),
});
export type SearchResultItemDto = z.infer<typeof SearchResultItemDto>;

export const SearchResultDto = z.object({ items: z.array(SearchResultItemDto), truncated: z.boolean() });
export type SearchResultDto = z.infer<typeof SearchResultDto>;

/** Результат GET /api/issues/resolve — ровно то, что нужно роутеру, чтобы перейти
 *  с /p/:projectKey/issue/:issueKey на реальный проект/задачу (id — UUID, для
 *  остальных запросов; ключи — только для сверки/отображения в URL). */
export const IssueResolveDto = z.object({
  id: z.string(),
  projectId: z.string(),
  projectKey: z.string(),
});
export type IssueResolveDto = z.infer<typeof IssueResolveDto>;

/** GET …/issues/counts: число активных задач набора и разбивка по статусам. */
export const IssueCountsDto = z.object({ total: z.number(), byStatus: z.record(z.number()) });
export type IssueCountsDto = z.infer<typeof IssueCountsDto>;

/** GET …/issues/assignees: исполнители проекта (для фильтра доски), по убыванию числа задач. */
export const IssueAssigneesDto = z.object({ items: z.array(z.object({ userId: z.string(), count: z.number() })) });
export type IssueAssigneesDto = z.infer<typeof IssueAssigneesDto>;

/** Направление (эпик) с агрегатом по активным детям: сколько их и сколько закрыто (категория done). */
export const IssueEpicDto = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  color: z.string().nullable(),
  tStart: z.number().nullable(),
  tSpan: z.number().nullable(),
  childTotal: z.number(),
  childDone: z.number(),
});
export type IssueEpicDto = z.infer<typeof IssueEpicDto>;

export const IssueEpicsDto = z.object({ items: z.array(IssueEpicDto), truncated: z.boolean() });
export type IssueEpicsDto = z.infer<typeof IssueEpicsDto>;

export const ReportTotals = z.object({
  /** Закрыто за период (по done_at). */
  closed: z.number(),
  /** Создано за период (по created_at). */
  created: z.number(),
  /** Открыто сейчас — не в категории done, независимо от периода. */
  open: z.number(),
  /** Просрочено сейчас — срок в прошлом и задача не закрыта. */
  overdue: z.number(),
  /** Среднее время от создания до закрытия, дней (по закрытым за период). */
  avgLeadDays: z.number().nullable(),
  /** Медиана того же — устойчивее среднего к одному забытому «хвосту». */
  medianLeadDays: z.number().nullable(),
});
export type ReportTotals = z.infer<typeof ReportTotals>;

export const ReportRow = z.object({
  key: z.string(),
  label: z.string(),
  closed: z.number(),
  created: z.number(),
  open: z.number(),
  avgLeadDays: z.number().nullable(),
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportPoint = z.object({
  /** Неделя закрытия, понедельник, ГГГГ-ММ-ДД. */
  week: z.string(),
  closed: z.number(),
});
export type ReportPoint = z.infer<typeof ReportPoint>;

/** Результат построения отчёта (services/reports.ts buildReport). */
export const ReportResult = z.object({
  from: z.string(),
  to: z.string(),
  groupBy: z.enum(REPORT_GROUPS),
  totals: ReportTotals,
  rows: z.array(ReportRow),
  trend: z.array(ReportPoint),
});
export type ReportResult = z.infer<typeof ReportResult>;

/** GET /api/reports/summary: результат + число проектов в выборке. */
export const ReportSummaryDto = ReportResult.extend({ projectCount: z.number() });
export type ReportSummaryDto = z.infer<typeof ReportSummaryDto>;
