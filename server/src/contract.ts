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
  // Шаблоны проектов (ТЗ 5.10, миграция 20260927T1000): имя/описание при «Сохранить как шаблон» и размеры спецификации.
  projectTemplate: { name: { min: 1, max: 80 }, description: { max: 300 }, statusName: { min: 1, max: 60 }, statusesMax: 12, transitionsMax: 80, labelsMax: 30 },
  // Роадмап (ТЗ 5.15, миграция 20260928T1400).
  milestone: { name: { min: 1, max: 80 } },
  milestonesPerProject: 30,
  projectDependenciesMax: 20,
  // Брендирование (ТЗ 5.14 п.5).
  brand: { name: { min: 1, max: 60 } },
  // Дашборды (ADR-0022, миграция 20260929T1000).
  dashboard: { name: { min: 1, max: 80 }, widgetTitle: { max: 60 } },
  widgetsPerDashboard: 24,
  dashboardsPerUser: 20,
  webhook: { name: 80, url: 2048, perProject: 10, total: 100 },
  apiToken: { name: 80, perUser: 10, perService: 5, maxDays: 365 },
  serviceAccount: { name: 80 },
  recurring: { name: 80, perProject: 50, assignees: 10 },
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
export type PriorityId = (typeof PRIORITIES)[number];
export type ComplexityId = (typeof COMPLEXITIES)[number];
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
/** Непустая строка в одну линию: `oneLine(max, 1)` проверяет длину до обрезки пробелов, поэтому « » прошла бы
 *  и сохранилась пустой (или упала бы на CHECK в БД 500-й) — здесь пустота проверяется и после обрезки. */
const requiredLine = (max: number, msg: string) => oneLine(max, 1, msg).refine((s) => s.length > 0, msg);

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
  name: oneLine(LIMITS.department.name.max, LIMITS.department.name.min, "Название команды не может быть пустым"),
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

/** Внешний вид проекта (ТЗ 5.10, мастер; миграция 20260927T1400): закрытые списки идентификаторов.
 *  Иконка — из собственного набора (src/icons.tsx, PROJECT_ICON_MAP), цвет — фирменный тон (tk-tone-*),
 *  фон — атмосферный пресет (theme.ts BG_PRESETS). null — как раньше: буква ключа, тон по ключу, личный фон. */
export const PROJECT_ICONS = [
  "rocket", "megaphone", "users", "headset", "document", "briefcase", "code", "chart", "shield", "cart",
  "book", "calendar", "star", "bolt", "globe", "sparkle", "flag", "home", "camera", "diamond",
] as const;
export const PROJECT_COLORS = ["violet", "indigo", "blue", "sky", "teal", "green", "amber", "orange", "red", "pink"] as const;
/** Фоны проекта = встроенная галерея (ТЗ 5.14 п.1, src/theme.ts BG_IDS); первые пять — с 5.10, список только растёт. */
export const PROJECT_BACKGROUNDS = ["default", "dusk", "dawn", "aurora", "sea", "rose", "mint", "graphite", "plain", "grid", "dots", "rings", "prism", "lines"] as const;
const projectAppearance = {
  icon: z.enum(PROJECT_ICONS).nullable(),
  color: z.enum(PROJECT_COLORS).nullable(),
  background: z.enum(PROJECT_BACKGROUNDS).nullable(),
};

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
  /** Шаблон проекта (ТЗ 5.10): `builtin:<id>` или uuid шаблона организации; без него — стандартная схема. */
  templateId: z.string().max(64).optional(),
  /** Участники сразу при создании — в той же транзакции (мастер, шаг «Доступ»). */
  members: z
    .array(z.object({ userId: uuid, role: z.enum(PROJECT_ROLES) }))
    .max(200)
    .default([]),
  /** Без иконки — берётся иконка шаблона (если есть), иначе буква ключа. */
  icon: projectAppearance.icon.optional(),
  color: projectAppearance.color.default(null),
  background: projectAppearance.background.default(null),
});

/** PATCH /api/projects/:projectId [global admin] */
export const ProjectPatchBody = z
  .object({
    name: oneLine(LIMITS.project.name.max, LIMITS.project.name.min),
    description: multiLine(LIMITS.project.description.max),
    departmentId: uuid,
    isShared: z.boolean(),
    sprintsEnabled: z.boolean(),
    ...projectAppearance,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/** PATCH /api/projects/:projectId/appearance [perm editAppearance] — иконка, цвет, фон (ТЗ 5.14 п.7). */
export const ProjectAppearanceBody = z
  .object(projectAppearance)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/* ---------------- Роадмап проектов (ТЗ 5.15) ---------------- */

/** PATCH /api/projects/:projectId/roadmap [perm editRoadmap] — даты начала и цели; null — снять. */
export const ProjectRoadmapBody = z
  .object({ startDate: isoDate().nullable(), targetDate: isoDate().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/** POST/PATCH /api/projects/:projectId/milestones[/:milestoneId] [perm editRoadmap]. */
export const MilestoneCreateBody = z.object({
  name: requiredLine(LIMITS.milestone.name.max, "Название вехи не может быть пустым"),
  date: isoDate(),
});
export const MilestonePatchBody = MilestoneCreateBody.partial().refine((v) => Object.keys(v).length > 0, "Пустой патч");
export const MilestoneParams = z.object({ projectId: uuid, milestoneId: uuid });

/** POST /api/projects/:projectId/dependencies [perm editRoadmap] — проект :projectId ждёт sourceProjectId. */
export const DependencyCreateBody = z.object({ sourceProjectId: uuid });
export const DependencyParams = z.object({ projectId: uuid, sourceProjectId: uuid });

export const MilestoneDto = z.object({ id: z.string(), name: z.string(), date: z.string() });
export type MilestoneDto = z.infer<typeof MilestoneDto>;

/** Строка роадмапа: видимый пользователю проект. Даты — ГГГГ-ММ-ДД; прогресс — все задачи проекта, включая архив
 *  (архив — закрытые, они и есть сделанная работа). */
export const RoadmapProjectDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  departmentId: z.string(),
  icon: z.enum(PROJECT_ICONS).nullable(),
  color: z.enum(PROJECT_COLORS).nullable(),
  createdAt: z.string(),
  startDate: z.string().nullable(),
  targetDate: z.string().nullable(),
  done: z.number(),
  total: z.number(),
  milestones: z.array(MilestoneDto),
  /** Право editRoadmap в этом проекте у текущего пользователя. */
  canEdit: z.boolean(),
});
export type RoadmapProjectDto = z.infer<typeof RoadmapProjectDto>;

/** GET /api/roadmap — проекты, видимые пользователю, и зависимости между ними (обе стороны видимы). */
export const RoadmapDto = z.object({
  projects: z.array(RoadmapProjectDto),
  dependencies: z.array(z.object({ sourceId: z.string(), dependentId: z.string() })),
});
export type RoadmapDto = z.infer<typeof RoadmapDto>;

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

/* ---------------- Повторяющиеся задачи ---------------- */
export const RecurrenceSchedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), every: z.number().int().min(1).max(30) }),
  z.object({
    kind: z.literal("weekly"), every: z.number().int().min(1).max(12),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
      .refine(days => new Set(days).size === days.length, "Дни недели должны быть уникальны"),
  }),
  z.object({
    kind: z.literal("monthly"), every: z.number().int().min(1).max(12),
    day: z.union([z.number().int().min(1).max(31), z.literal("last")]),
  }),
]);
export type RecurrenceSchedule = z.infer<typeof RecurrenceSchedule>;

const recurringTiming = {
  schedule: RecurrenceSchedule,
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: oneLine(100, 1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
const recurringFields = {
  ...recurringTiming,
  name: oneLine(LIMITS.recurring.name, 1),
  templateId: uuid,
  title: oneLine(LIMITS.title.max).nullable(),
  assigneeIds: z.array(uuid).max(LIMITS.recurring.assignees)
    .refine(ids => new Set(ids).size === ids.length, "Исполнители не должны повторяться"),
  dueInDays: z.number().int().min(0).max(365).nullable(),
  skipIfOpen: z.boolean(),
};
export const RecurringPreviewBody = z.object(recurringTiming);
export type RecurringPreviewBody = z.infer<typeof RecurringPreviewBody>;
export const RecurringRuleBody = z.object({
  ...recurringFields,
  title: recurringFields.title.default(null),
  assigneeIds: recurringFields.assigneeIds.default([]),
  dueInDays: recurringFields.dueInDays.default(null),
  skipIfOpen: recurringFields.skipIfOpen.default(false),
});
export type RecurringRuleBody = z.infer<typeof RecurringRuleBody>;
export const RecurringRulePatchBody = z.object(recurringFields).partial()
  .refine(body => Object.keys(body).length > 0, "Пустой патч");
export type RecurringRulePatchBody = z.infer<typeof RecurringRulePatchBody>;
export const RecurringRuleParams = z.object({ id: uuid });
export const RecurringRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const recurringResult = z.enum(["created", "skipped_open", "failed"]);
export const RecurringRuleDto = RecurringRuleBody.extend({
  id: uuid, projectId: uuid, ownerId: uuid.nullable(),
  state: z.enum(["active", "paused"]), pausedReason: z.enum(["manual", "owner_lost_access", "invalid_timing"]).nullable(),
  nextRunAt: z.string().nullable(), lastRunAt: z.string().nullable(), lastResult: recurringResult.nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
export type RecurringRuleDto = z.infer<typeof RecurringRuleDto>;
export const RecurringRunDto = z.object({
  id: uuid, scheduledFor: z.string(), ranAt: z.string(), result: recurringResult, manual: z.boolean(),
  missedCount: z.number().int().min(0), issueId: uuid.nullable(), issueKey: z.string().nullable(), errorCode: z.string().nullable(),
  details: z.object({ droppedAssignees: z.array(uuid) }),
});
export type RecurringRunDto = z.infer<typeof RecurringRunDto>;
export const RecurringConfigDto = z.object({ enabled: z.boolean(), defaultTimeZone: z.string() });
export type RecurringConfigDto = z.infer<typeof RecurringConfigDto>;

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
  "issue.dueSoon",
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
  dueReminderDays: z.array(z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)])).max(4).optional(),
  email: z.enum(["instant", "daily", "off"]).optional(),
  selfWatch: z.boolean().optional(),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefs>;

/** PATCH /api/notifications/prefs — частичное обновление (мержится в jsonb).
 *  'off' сознательно исключён из ЭТОЙ схемы (миграция 028) — пользователь
 *  выбирает только режим доставки, выключить почту целиком больше нельзя. */
export const NotifyPrefsBody = z
  .object({
    dueReminderDays: z.array(z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)])).max(4).refine(v => new Set(v).size === v.length, "Повторяющиеся интервалы").optional(),
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
/** Условие по своему полю проекта (ROUTE-02, custom_fields). Одно поле на набор, как и остальные условия. Смысл
 *  значений зависит от типа поля, поэтому проверка формата — в buildIssueFilter, где тип известен:
 *  - text — `cfValue` содержится в значении (без учёта регистра);
 *  - select — `cfValue` — точное совпадение с вариантом;
 *  - checkbox — `cfValue` "true" / "false" (не заданный чекбокс считается снятым);
 *  - number / date — диапазон `cfFrom`…`cfTo` включительно, любая граница может отсутствовать;
 *  - `cfEmpty=1` — значение не задано (для любого типа, кроме чекбокса).
 *  Поле, которого в проекте нет (удалили, а сохранённый фильтр остался), и условие не по типу поля (тип сменили,
 *  граница не того формата) ничего не находят — пустой набор, как удалённый статус, а не 400. Граница числа
 *  допускает экспоненту («1e3») — так её отдаёт `<input type="number">`. */
const CUSTOM_FIELD_FILTER = {
  cf: uuid.optional(),
  cfValue: z.string().min(1).max(500).optional(),
  cfFrom: z.string().max(40).optional(),
  cfTo: z.string().max(40).optional(),
  cfEmpty: z.literal("1").optional(),
};
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
   *  не влияет на этом проекте. Условие по своему полю проекта — `cf*`
   *  (ROUTE-02, см. CUSTOM_FIELD_FILTER). */
  priority: z.enum(PRIORITIES).optional(),
  label: z.string().max(60).optional(),
  sprintId: uuid.optional(),
  ...CUSTOM_FIELD_FILTER,
  /** Дети одной задачи: подзадачи (`parentId`, миграция 021) и задачи
   *  «направления» (`epicId`). Те же пагинация, сортировка и права, что у списка,
   *  поэтому для карточки не нужен отдельный путь. Подзадачи лежат в проекте
   *  родителя; архивные скрыты, как и везде, — `archived=all` вернёт их. */
  parentId: uuid.optional(),
  epicId: uuid.optional(),
  q: z.string().max(120).optional(),
  dueFrom: isoDate().optional(),
  dueTo: isoDate().optional(),
  dueEmpty: z.literal("1").optional(),
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
    /** Срок «с … по …» (фильтр списка): даты фиксируются при сохранении, не «эта неделя». */
    dueFrom: isoDate().optional(),
    dueTo: isoDate().optional(),
    ...CUSTOM_FIELD_FILTER,
  })
  // .strict(), не молчаливая обрезка неизвестных полей — иначе сохранение вьюхи
  // с опечаткой в имени условия или полем, которое конструктор ещё не поддерживает,
  // тихо теряло бы это условие вместо явной 400.
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
  /** Wire / z.input: до 150 UUID через запятую; z.infer: string[] после transform.
   *  Пересекается с видимыми проектами. Период дополнительно ограничен в routes/reports.ts. */
  projectIds: z.string().max(5550).transform(v => v.split(",")).pipe(z.array(uuid).min(1).max(150)).optional(),
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
const ActorMini = z.object({ id: z.string(), name: z.string(), initials: z.string(), color: z.string(), authSource: z.enum(["local", "ldap", "service"]).optional() });

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

/** Событие истории задачи — данные, а не готовая фраза (трек E): клиент рисует его на языке интерфейса через словарь.
 *  Хранится в `activity.kind` + `activity.payload` (миграция 20260929T1500_activity_kind.sql); `activity.text` по-прежнему
 *  пишется — русская фраза для старых клиентов, экспорта и записей до миграции (у них события нет, показывается текст).
 *  Имена людей и статусов — снимок на момент события: переименование позже историю не переписывает.
 *  Идентификаторы людей и статусов необязательны для совместимости со старыми строками истории (INT-01).
 *  Список закрытый: запись с неизвестным `kind` (от более новой версии сервера) читается как `event: null`. */
export const ActivityEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), ruleId: uuid.optional(), ruleName: z.string().optional() }),
  z.object({ kind: z.literal("renamed") }),
  z.object({ kind: z.literal("description") }),
  z.object({ kind: z.literal("priority"), from: z.enum(PRIORITIES), to: z.enum(PRIORITIES), bulk: z.boolean().optional() }),
  z.object({ kind: z.literal("complexity"), from: z.enum(COMPLEXITIES).nullable(), to: z.enum(COMPLEXITIES).nullable() }),
  z.object({ kind: z.literal("due"), from: z.string().nullable(), to: z.string().nullable() }),
  z.object({ kind: z.literal("assigneeAdded"), name: z.string(), userId: z.string().uuid().optional() }),
  z.object({ kind: z.literal("assigneeRemoved"), name: z.string(), userId: z.string().uuid().optional() }),
  /** Массовая операция: назначен один человек на всю выборку или исполнители сняты. */
  z.object({ kind: z.literal("assigneeBulk"), cleared: z.boolean(), userId: z.string().uuid().nullable().optional() }),
  z.object({ kind: z.literal("direction") }),
  z.object({ kind: z.literal("parent"), set: z.boolean() }),
  z.object({ kind: z.literal("labels") }),
  z.object({ kind: z.literal("status"), from: z.string(), to: z.string(), fromId: z.string().uuid().optional(), toId: z.string().uuid().optional(), fromSid: z.string().optional(), toSid: z.string().optional(), bulk: z.boolean().optional() }),
  z.object({ kind: z.literal("checklistAdded"), text: z.string() }),
  z.object({ kind: z.literal("checklistRemoved") }),
  z.object({ kind: z.literal("link"), type: z.enum(["blocks", "blocked_by", "relates"]), key: z.string() }),
]);
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ActivityDto = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actor: ActorMini.nullable(),
  /** Русская фраза — для записей без события (до трека E) и как запасной вариант. */
  text: z.string(),
  event: ActivityEvent.nullable(),
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
  /** Подзадачи total/done (включая архив). В списке `GET …/issues` — у каждой строки (карточка доски показывает
   *  «2/5»); в ответах на правку может отсутствовать — клиент тогда держит прежнее значение. */
  subtasksSummary: SubtasksSummaryDto.optional(),
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
  /** Подписка текущего пользователя (issue_watchers): следит ли он и сколько всего следят. */
  watch: z.object({ watching: z.boolean(), watchers: z.number() }),
});
export type IssueDetailDto = z.infer<typeof IssueDetailDto>;

/* ---- проекты, пользователи, workflow, bootstrap (ТЗ 2.1, PR 2) ---- */

export const SafeUser = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  givenName: z.string().nullable().optional(),
  initials: z.string(),
  color: z.string(),
  jobRole: z.string(),
  /** Телефон (миграция 026) — из AD у LDAP-пользователей, вручную при создании локального. "" — не заполнен. */
  phone: z.string(),
  /** Глобальная роль ресурса (users.global_role) — источник прав. Проектная роль — в bootstrap `members`. */
  globalRole: z.enum(GLOBAL_ROLES),
  isActive: z.boolean(),
  /** local | ldap | service: профиль LDAP из директории, сервисная запись без входа. */
  authSource: z.enum(["local", "ldap", "service"]),
  /** мс эпохи последней загрузки аватарки (миграция 027) — null, если её нет; cache-buster для /users/:id/avatar. */
  avatarUpdatedAt: z.number().nullable(),
});
export type SafeUser = z.infer<typeof SafeUser>;

/** Языки интерфейса (трек E): клиентский словарь и письма сервера. */
export const LANGS = ["ru", "en"] as const;
export type Lang = (typeof LANGS)[number];
/** PUT /api/me/lang — язык, на котором человеку уходят письма и сводки. */
export const MeLangBody = z.object({ lang: z.enum(LANGS) });
/** GET /api/auth/me: профиль + то, что видно только себе (настройки уведомлений, избранные проекты, язык писем). */
export const MeDto = SafeUser.extend({ notifyPrefs: NotifyPrefs, favoriteProjectIds: z.array(z.string()), lang: z.enum(LANGS) });
export type MeDto = z.infer<typeof MeDto>;

export const ProjectDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  departmentId: z.string(),
  isShared: z.boolean(),
  sprintsEnabled: z.boolean(),
  /** Шаблон проекта (ТЗ 5.10): с какого представления открывать (null — Доска) и предложенные метки. */
  defaultView: z.enum(["board", "backlog", "timeline"]).nullable(),
  suggestedLabels: z.array(z.string()),
  icon: z.enum(PROJECT_ICONS).nullable(),
  color: z.enum(PROJECT_COLORS).nullable(),
  background: z.enum(PROJECT_BACKGROUNDS).nullable(),
  /** Своё фото фона (ТЗ 5.14 п.2): версия (ms) для ссылки и средняя светлота 0…1; перекрывает background. */
  backgroundPhoto: z.object({ updatedAt: z.number(), luma: z.number() }).nullable(),
  /** Демо-проект из первичной настройки (ТЗ 5.11) — помечен в интерфейсе, удаляется одной кнопкой. */
  isDemo: z.boolean(),
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
  authSource: z.enum(["local", "ldap", "service"]).optional(),
});
export type PickableUserDto = z.infer<typeof PickableUserDto>;
export const PickableUsersQuery = z.object({ q: z.string().optional(), includeService: z.literal("1").optional() });

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
  statusSid: z.string().optional(),
  projectRole: z.enum(PROJECT_ROLES).nullable().optional(),
  returnedForRework: z.boolean().optional(),
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
  overdue: z.number().optional(),
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportPoint = z.object({
  /** Неделя создания/закрытия, понедельник, ГГГГ-ММ-ДД. */
  week: z.string(),
  closed: z.number(),
  created: z.number().optional(),
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

/* ============================================================================
   Шаблоны проектов (ТЗ 5.10). Шаблон — не код, а набор уже существующих настроек проекта:
   статусы и переходы, пользовательские поля, шаблоны задач, представление по умолчанию,
   предложенные метки, модуль спринтов. Встроенные — server/src/templates/builtin.json,
   шаблоны организации — таблица project_templates (миграция 20260927T1000).
   ============================================================================ */
export const PROJECT_DEFAULT_VIEWS = ["board", "backlog", "timeline"] as const;
const statusSid = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, "sid: латиница в нижнем регистре, цифры и _");

export const ProjectTemplateSpec = z
  .object({
    statuses: z
      .array(z.object({ sid: statusSid, name: oneLine(LIMITS.projectTemplate.statusName.max, LIMITS.projectTemplate.statusName.min), category: z.enum(STATUS_CATEGORIES) }))
      .min(2)
      .max(LIMITS.projectTemplate.statusesMax),
    transitions: z.array(z.tuple([statusSid, statusSid])).max(LIMITS.projectTemplate.transitionsMax),
    customFields: z.array(CustomFieldCreateBody).max(LIMITS.customFieldsPerProject).default([]),
    issueTemplates: z
      .array(IssueTemplateBody.omit({ statusId: true }).extend({ statusSid: statusSid.nullable().default(null) }))
      .max(LIMITS.issueTemplatesPerProject)
      .default([]),
    defaultView: z.enum(PROJECT_DEFAULT_VIEWS).default("board"),
    labels: z.array(oneLine(LIMITS.label.max, 1)).max(LIMITS.projectTemplate.labelsMax).default([]),
    sprintsEnabled: z.boolean().default(false),
    /** Иконка, которую мастер предлагает для проекта из этого шаблона. */
    icon: z.enum(PROJECT_ICONS).optional(),
  })
  .superRefine((v, ctx) => {
    const sids = v.statuses.map((s) => s.sid);
    if (new Set(sids).size !== sids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses"], message: "sid статусов повторяются" });
    if (!v.statuses.some((s) => s.category === "todo")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses"], message: "Нужен хотя бы один статус категории todo" });
    if (!v.statuses.some((s) => s.category === "done")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses"], message: "Нужен хотя бы один статус категории done" });
    const known = new Set(sids);
    const seen = new Set<string>();
    v.transitions.forEach(([a, b], i) => {
      if (!known.has(a) || !known.has(b) || a === b) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["transitions", i], message: `Переход ${a} → ${b} ссылается на неизвестный статус или ведёт в себя` });
      if (seen.has(`${a}>${b}`)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["transitions", i], message: `Переход ${a} → ${b} повторяется` });
      seen.add(`${a}>${b}`);
    });
    v.issueTemplates.forEach((t, i) => {
      if (t.statusSid && !known.has(t.statusSid)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["issueTemplates", i, "statusSid"], message: `Неизвестный статус ${t.statusSid}` });
    });
    const fieldNames = v.customFields.map((f) => f.name.toLowerCase());
    if (new Set(fieldNames).size !== fieldNames.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customFields"], message: "Названия полей повторяются" });
  });
export type ProjectTemplateSpec = z.infer<typeof ProjectTemplateSpec>;

export const ProjectTemplateDto = z.object({
  /** `builtin:<id>` у встроенных, uuid у шаблонов организации. */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  builtin: z.boolean(),
  spec: ProjectTemplateSpec,
});
export type ProjectTemplateDto = z.infer<typeof ProjectTemplateDto>;

/** POST /api/projects/:projectId/save-as-template [saveProjectTemplate] */
export const SaveProjectTemplateBody = z.object({
  name: requiredLine(LIMITS.projectTemplate.name.max, "Название шаблона не может быть пустым"),
  description: multiLine(LIMITS.projectTemplate.description.max).default(""),
});
export const ProjectTemplateParams = z.object({ templateId: uuid });


/* ============================================================================
   Онбординг (ТЗ 5.11, миграция 20260927T1800). «Начало работы» — шаги, которые сервер
   отмечает сам по реальным действиям; тема живёт только в браузере, поэтому шаг «theme»
   — единственный, о котором сообщает клиент. Подсказки — id закрытых, чтобы не повторялись.
   ============================================================================ */
export const ONBOARDING_STEPS = ["open_issue", "change_status", "comment", "notifications", "theme"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
/** Шаги, которые сервер не видит сам (тема — localStorage). */
export const CLIENT_ONBOARDING_STEPS = ["theme"] as const;
export const OnboardingDto = z.object({
  done: z.array(z.enum(ONBOARDING_STEPS)),
  hidden: z.boolean(),
  hints: z.array(z.string()),
});
export type OnboardingDto = z.infer<typeof OnboardingDto>;
export const OnboardingStepBody = z.object({ step: z.enum(CLIENT_ONBOARDING_STEPS) });
export const HintParams = z.object({ hintId: z.string().regex(/^[a-z][a-z0-9.-]{0,39}$/, "Некорректный id подсказки") });
export const LIMIT_DISMISSED_HINTS = 100;

/** Первичная настройка инсталляции (глобальный администратор, первый вход после установки). */
export const SetupStatusDto = z.object({
  completed: z.boolean(),
  instanceName: z.string(),
  authMode: z.enum(["local", "ldap"]),
  /** Активные пользователи, кроме системного администратора. */
  users: z.number(),
  /** Проекты без демо. */
  projects: z.number(),
  demoProjectId: z.string().nullable(),
});
export type SetupStatusDto = z.infer<typeof SetupStatusDto>;
export const SetupPatchBody = z.object({ instanceName: oneLine(80, 1, "Название не может быть пустым") });

/* ---------------- Брендирование инсталляции (ТЗ 5.14 п.5) ---------------- */
/** Допустимый оттенок акцента (OKLCH hue): старый диапазон и пять дополнительных образцов. Для каждого значения
 *  scripts/check-contrast.mjs проверяет все пары акцента во всех темах — это и есть «контраст проверяется
 *  автоматически при сохранении»: сервер принимает только проверенные значения. 288 — фирменный. */
export const BRAND_HUE = { min: 255, max: 320, default: 288 } as const;
export const BRAND_EXTRA_HUES = [55, 145, 185, 235, 345] as const;
export const TRANSPARENCY_DEFAULTS = ["auto", "on"] as const;
/** GET /api/instance/brand — публично (нужно экрану входа): null — не задано. */
export const BrandDto = z.object({
  transparencyDefault: z.enum(TRANSPARENCY_DEFAULTS),
  name: z.string().nullable(),
  hue: z.number().nullable(),
  logoUpdatedAt: z.number().nullable(),
});
export type BrandDto = z.infer<typeof BrandDto>;
/** PATCH /api/admin/brand [global admin]. null — вернуть как было (Taskira / 288). */
export const BrandPatchBody = z
  .object({
    transparencyDefault: z.enum(TRANSPARENCY_DEFAULTS),
    name: requiredLine(LIMITS.brand.name.max, "Название не может быть пустым").nullable(),
    hue: z.number().int().refine(h => (h >= BRAND_HUE.min && h <= BRAND_HUE.max) || BRAND_EXTRA_HUES.some(value => value === h), "Выберите поддерживаемый оттенок бренда").nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");

/* ---------------- Дашборды (ADR-0022) ---------------- */
/** Сетка — 12 колонок; высота виджета — в строках сетки. */
export const DASHBOARD_GRID = { cols: 12, maxRows: 200, minH: 1, maxH: 8 } as const;
export const WIDGET_TYPES = ["count", "breakdown", "trend", "issues", "workload", "progress", "activity", "projects", "projectHealth", "milestones"] as const;
export const PROJECT_WIDGET_LIMITS = { min: 5, max: 50 } as const;
export const MILESTONE_PERIOD_LIMITS = { min: 7, max: 180 } as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
/** Число: открытые, просроченные, со сроком в ближайшие 7 дней, без исполнителя, закрытые и созданные за период. */
export const COUNT_METRICS = ["open", "overdue", "dueSoon", "unassigned", "closed", "created"] as const;
/** Разбивка открытых задач. */
export const BREAKDOWN_GROUPS = ["status", "assignee", "priority", "type", "project"] as const;
/** Готовые списки задач. mine — мои открытые. */
export const ISSUE_PRESETS = ["mine", "overdue", "dueSoon", "unassigned", "recentlyCreated", "recentlyClosed"] as const;
export const WIDGET_PERIODS = [7, 14, 30, 90, 180, 365] as const;

const widgetBase = {
  /** Задаётся клиентом, уникален в пределах дашборда. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Некорректный id виджета"),
  x: z.number().int().min(0).max(DASHBOARD_GRID.cols - 1),
  y: z.number().int().min(0).max(DASHBOARD_GRID.maxRows),
  w: z.number().int().min(1).max(DASHBOARD_GRID.cols),
  h: z.number().int().min(DASHBOARD_GRID.minH).max(DASHBOARD_GRID.maxH),
  /** Свой заголовок; пусто — заголовок по типу и настройкам. */
  title: z.string().trim().max(LIMITS.dashboard.widgetTitle.max).optional(),
  /** Область: проект или отдел; пусто — все видимые проекты. На обзоре проекта сервер подставляет проект сам. */
  projectId: uuid.optional(),
  departmentId: uuid.optional(),
};
const period = z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]);

export const DashboardWidget = z.discriminatedUnion("type", [
  z.object({ ...widgetBase, type: z.literal("count"), metric: z.enum(COUNT_METRICS), periodDays: period.default(30) }),
  z.object({ ...widgetBase, type: z.literal("breakdown"), groupBy: z.enum(BREAKDOWN_GROUPS), chart: z.enum(["donut", "bars"]).default("donut") }),
  z.object({ ...widgetBase, type: z.literal("trend"), periodDays: period.default(90) }),
  z.object({ ...widgetBase, type: z.literal("issues"), preset: z.enum(ISSUE_PRESETS), limit: z.number().int().min(3).max(20).default(8) }),
  z.object({ ...widgetBase, type: z.literal("workload"), limit: z.number().int().min(3).max(20).default(8) }),
  z.object({ ...widgetBase, type: z.literal("progress"), limit: z.number().int().min(3).max(30).default(10) }),
  z.object({ ...widgetBase, type: z.literal("activity"), limit: z.number().int().min(5).max(30).default(10) }),
  z.object({ ...widgetBase, type: z.literal("projects"), limit: z.number().int().min(PROJECT_WIDGET_LIMITS.min).max(PROJECT_WIDGET_LIMITS.max).default(10) }),
  z.object({ ...widgetBase, type: z.literal("projectHealth") }),
  z.object({ ...widgetBase, type: z.literal("milestones"), periodDays: z.number().int().min(MILESTONE_PERIOD_LIMITS.min).max(MILESTONE_PERIOD_LIMITS.max).default(30) }),
]);
export type DashboardWidget = z.infer<typeof DashboardWidget>;
export const DashboardWidgets = z.array(DashboardWidget).max(LIMITS.widgetsPerDashboard, `Не больше ${LIMITS.widgetsPerDashboard} виджетов на дашборде`);

export const DashboardParams = z.object({ dashboardId: uuid });
/** POST /api/dashboards — новый дашборд уровня организации; shared=true — только глобальный администратор. */
export const DashboardCreateBody = z.object({
  name: requiredLine(LIMITS.dashboard.name.max, "Название не может быть пустым"),
  shared: z.boolean().default(false),
  widgets: DashboardWidgets.default([]),
});
/** PATCH /api/dashboards/:dashboardId — владелец личного или глобальный администратор для общего. */
export const DashboardPatchBody = z
  .object({
    name: requiredLine(LIMITS.dashboard.name.max, "Название не может быть пустым"),
    shared: z.boolean(),
    widgets: DashboardWidgets,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Пустой патч");
/** PUT /api/projects/:projectId/overview [manageDashboards] — сохранить обзор проекта. */
export const ProjectOverviewBody = z.object({ widgets: DashboardWidgets });
/** POST /api/dashboards/data — данные для набора виджетов (сохранённых или ещё нет). projectId — обзор проекта. */
export const DashboardDataBody = z.object({ widgets: DashboardWidgets, projectId: uuid.optional() });

export const DashboardDto = z.object({
  id: z.string(),
  name: z.string(),
  /** personal — личный, org — общий организации, project — обзор проекта. */
  kind: z.enum(["personal", "org", "project"]),
  projectId: z.string().nullable(),
  ownerId: z.string().nullable(),
  /** Может ли смотрящий править этот дашборд. */
  canEdit: z.boolean(),
  widgets: z.array(DashboardWidget),
  updatedAt: z.string(),
});
export type DashboardDto = z.infer<typeof DashboardDto>;
/** GET /api/projects/:projectId/overview: dashboard=null — обзор не сохранён, показывается встроенный. */
export const ProjectOverviewDto = z.object({ dashboard: DashboardDto.nullable(), canEdit: z.boolean() });
export type ProjectOverviewDto = z.infer<typeof ProjectOverviewDto>;

const WidgetIssue = AssignedIssueDto;
export const WidgetDataDto = z.discriminatedUnion("type", [
  z.object({ type: z.literal("projects"), items: z.array(z.object({ projectId: z.string(), key: z.string(), name: z.string(), team: z.string(), total: z.number(), open: z.number(), overdue: z.number(), targetDate: z.string().nullable(), health: z.enum(["completed", "overdue", "atRisk", "onTrack", "noDate"]) })) }),
  z.object({ type: z.literal("projectHealth"), items: z.array(z.object({ health: z.enum(["completed", "overdue", "atRisk", "onTrack", "noDate"]), count: z.number() })) }),
  z.object({ type: z.literal("milestones"), items: z.array(z.object({ id: z.string(), projectId: z.string(), projectKey: z.string(), projectName: z.string(), name: z.string(), date: z.string(), overdue: z.boolean() })) }),
  z.object({ type: z.literal("count"), value: z.number() }),
  z.object({
    type: z.literal("breakdown"),
    total: z.number(),
    items: z.array(z.object({ key: z.string(), label: z.string(), count: z.number(), category: z.enum(STATUS_CATEGORIES).nullable() })),
  }),
  z.object({ type: z.literal("trend"), weeks: z.array(z.object({ week: z.string(), created: z.number(), closed: z.number() })) }),
  z.object({ type: z.literal("issues"), items: z.array(WidgetIssue), truncated: z.boolean() }),
  z.object({
    type: z.literal("workload"),
    items: z.array(z.object({ userId: z.string(), name: z.string(), initials: z.string(), color: z.string(), overdue: z.number(), dueSoon: z.number(), other: z.number() })),
  }),
  z.object({
    type: z.literal("progress"),
    items: z.array(z.object({ projectId: z.string(), key: z.string(), name: z.string(), done: z.number(), total: z.number(), overdue: z.number() })),
  }),
  z.object({
    type: z.literal("activity"),
    items: z.array(
      z.object({
        id: z.string(),
        issueId: z.string(),
        issueKey: z.string(),
        issueTitle: z.string(),
        projectId: z.string(),
        actorName: z.string(),
        text: z.string(),
        event: ActivityEvent.nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  /** Виджет не посчитался — остальные при этом не страдают. */
  z.object({ type: z.literal("error") }),
]);
export type WidgetDataDto = z.infer<typeof WidgetDataDto>;
export const DashboardDataDto = z.object({ results: z.record(z.string(), WidgetDataDto) });
export type DashboardDataDto = z.infer<typeof DashboardDataDto>;
/* ---------------- Вебхуки (INT-05, ADR-0028) ---------------- */
export const WebhookEventType = z.enum(["issue.created", "issue.updated", "issue.statusChanged", "issue.assigned", "issue.commented", "issue.due"]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;
const webhookEvents = z.array(WebhookEventType).min(1).max(6).refine(values => new Set(values).size === values.length, "Типы событий не должны повторяться");
export const WebhookCreateBody = z.object({ name: requiredLine(LIMITS.webhook.name, "Название не может быть пустым"),
  url: z.string().min(1).max(LIMITS.webhook.url), events: webhookEvents }).strict();
export const WebhookPatchBody = WebhookCreateBody.partial().extend({ state: z.enum(["active", "paused"]).optional() })
  .refine(value => Object.keys(value).length > 0, "Пустой патч");
export const WebhookParams = ProjectParams.extend({ id: uuid });
export const WebhookDeliveryParams = WebhookParams.extend({ deliveryId: uuid });
export const WebhookDeliveryState = z.enum(["pending", "sending", "succeeded", "failed", "cancelled"]);
export const WebhookDeliveryQuery = z.object({ state: WebhookDeliveryState.optional(), cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50) });
export const WebhookRedeliverFailedBody = z.object({ since: z.string().max(64).datetime({ offset: true }).optional() }).strict();
export const WebhookDto = z.object({ id: uuid, projectId: uuid, name: z.string(), urlDisplay: z.string(), events: z.array(WebhookEventType),
  state: z.enum(["active", "paused", "disabled"]), disabledReason: z.enum(["failing", "gone", "secret_unavailable"]).nullable(),
  failureStreak: z.number().int(), lastSuccessAt: z.string().nullable(), lastFailureAt: z.string().nullable(),
  secretRotatedUntil: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() });
export type WebhookDto = z.infer<typeof WebhookDto>;
export const WebhookDeliveryDto = z.object({ id: uuid, eventId: uuid, eventType: z.string(), issueKey: z.string().nullable(),
  state: WebhookDeliveryState, attempts: z.number().int(), nextAttemptAt: z.string(), lastStatus: z.number().nullable(),
  lastError: z.string().nullable(), lastDurationMs: z.number().nullable(), manual: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
export type WebhookDeliveryDto = z.infer<typeof WebhookDeliveryDto>;
export const WebhookDeliveryDetailDto = WebhookDeliveryDto.extend({ payload: z.record(z.string(), z.unknown()).nullable(),
  headers: z.record(z.string(), z.string()), responseExcerpt: z.string().nullable() });
export type WebhookDeliveryDetailDto = z.infer<typeof WebhookDeliveryDetailDto>;
export const WebhookCreatedDto = z.object({ webhook: WebhookDto, secret: z.string() });
export type WebhookCreatedDto = z.infer<typeof WebhookCreatedDto>;
export const WebhookSecretRotatedDto = z.object({ secret: z.string(), previousValidUntil: z.string() });
export type WebhookSecretRotatedDto = z.infer<typeof WebhookSecretRotatedDto>;
export const WebhookDeliveryPageDto = z.object({ items: z.array(WebhookDeliveryDto), nextCursor: z.string().nullable() });
export type WebhookDeliveryPageDto = z.infer<typeof WebhookDeliveryPageDto>;
export const WebhookQueuedDto = z.object({ deliveryId: z.string() });
export type WebhookQueuedDto = z.infer<typeof WebhookQueuedDto>;
export const WebhookRedeliveredDto = z.object({ count: z.number() });
export type WebhookRedeliveredDto = z.infer<typeof WebhookRedeliveredDto>;

/* ---------------- API-токены и сервисные записи (INT-07, ADR-0029) ---------------- */
export const ApiTokenCreateBody = z.object({
  name: requiredLine(LIMITS.apiToken.name, "Название не может быть пустым"),
  scope: z.enum(["read", "write"]),
  expiresInDays: z.number().int().min(1).max(LIMITS.apiToken.maxDays).default(90),
}).strict();
export const ApiTokenParams = z.object({ id: uuid });
export const ServiceAccountParams = z.object({ id: uuid });
export const ServiceAccountTokenParams = ServiceAccountParams.extend({ tokenId: uuid });
export const ApiTokenAdminQuery = z.object({ userId: uuid.optional(), active: z.literal("1").optional() }).strict();
export const ApiTokenDto = z.object({
  id: z.string(), name: z.string(), prefix: z.string(), scope: z.enum(["read", "write"]),
  createdAt: z.string(), expiresAt: z.string(), lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type ApiTokenDto = z.infer<typeof ApiTokenDto>;
export const ApiTokenCreatedDto = z.object({ token: ApiTokenDto, secret: z.string() });
export type ApiTokenCreatedDto = z.infer<typeof ApiTokenCreatedDto>;
export const ApiTokenAdminDto = ApiTokenDto.extend({ owner: z.object({
  id: z.string(), username: z.string(), name: z.string(), authSource: z.enum(["local", "ldap", "service"]),
}) });
export type ApiTokenAdminDto = z.infer<typeof ApiTokenAdminDto>;
export const ServiceAccountCreateBody = z.object({
  username: z.string().min(LIMITS.username.min).max(LIMITS.username.max)
    .regex(/^[a-z0-9._-]+$/i, "Латиница, цифры, точки и дефисы"),
  name: requiredLine(LIMITS.serviceAccount.name, "Имя не может быть пустым"),
}).strict();
export const ServiceAccountPatchBody = z.object({
  name: requiredLine(LIMITS.serviceAccount.name, "Имя не может быть пустым").optional(), isActive: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Пустой патч");
export const ServiceAccountDto = z.object({
  id: z.string(), username: z.string(), name: z.string(), isActive: z.boolean(), createdAt: z.string(),
  projects: z.array(z.object({ projectId: z.string(), role: z.enum(PROJECT_ROLES) })), activeTokens: z.number(),
});
export type ServiceAccountDto = z.infer<typeof ServiceAccountDto>;
export const IntegrationsConfigDto = z.object({ webhooksEnabled: z.boolean(), allowHttp: z.boolean(), allowedTargets: z.array(z.string()) });
export type IntegrationsConfigDto = z.infer<typeof IntegrationsConfigDto>;
