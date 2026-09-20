export type IssueTypeId = "task" | "bug" | "request";
export type PriorityId = "low" | "medium" | "high" | "critical";
export type ComplexityId = "simple" | "medium" | "hard";
export type StatusCategory = "todo" | "inprogress" | "done";
/** Эффективная роль для матрицы прав (см. permissions.ts). */
export type AccessRole = "admin" | "manager" | "employee" | "viewer";
/** Глобальная роль ресурса (users.global_role). */
export type GlobalRole = "admin" | "member";
/** Роль участника проекта (project_members.role). */
export type ProjectRole = "manager" | "employee" | "viewer";

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  /** Должность / job role — НЕ роль доступа. */
  role: string;
  /** Телефон — из AD у LDAP-пользователей, вручную при создании локального. "" — не заполнен. */
  phone: string;
  /** Глобальная роль ресурса. */
  globalRole: GlobalRole;
  /** Эффективная роль в текущем проекте: 'admin' если globalRole='admin',
   *  иначе проектная роль. Для `me` вычисляется в store из globalRole + members. */
  accessRole: AccessRole;
  username?: string;
  /** мс эпохи последней загрузки аватарки; null — аватарки нет (миграция 027). */
  avatarUpdatedAt: number | null;
}

export interface Status {
  id: string;
  /** Стабильный ключ статуса (todo|inprogress|review|done) — не uuid.
   *  Нужен визуализации в WorkflowView (POS/PATHS по sid). */
  sid: string;
  name: string;
  category: StatusCategory;
}

export interface Transition {
  id: string;
  from: string;
  to: string;
}

export interface Workflow {
  statuses: Status[];
  transitions: Transition[];
}

export interface CommentT {
  id: string;
  authorId: string;
  body: string;
  ts: number;
}

export interface Activity {
  id: string;
  authorId: string | null;
  /** Денормализованный профиль автора: история переживает удаление пользователя. */
  author: { id: string; name: string; initials: string; color: string } | null;
  ts: number;
  text: string;
}

/** Приглашённый к задаче (issue_collaborators, миграция 008): видит эту задачу и
 *  её комментарии, не входит в проект. Приходит в детальном ответе GET /issues/:id. */
export interface Collaborator {
  userId: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
}

/** Вложение к задаче (attachments, миграция 010). Заполняется при открытии
 *  карточки (детальный GET /issues/:id). Файл качается отдельным запросом. */
export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  uploadedById: string | null;
  createdAt: number;
}

/** Тип связи со стороны открытой задачи (issue_links, миграция 014, §3.2).
 *  `blocks` — эта задача блокирует другую; `blocked_by` — наоборот. */
export type IssueLinkDir = "relates" | "blocks" | "blocked_by";

/** Связь с другой задачей. Заполняется при открытии карточки (GET /issues/:id). */
export interface IssueLink {
  id: string;
  dir: IssueLinkDir;
  issue: {
    id: string;
    key: string;
    title: string;
    typeId: IssueTypeId;
    statusId: string;
    statusCategory: "todo" | "inprogress" | "done";
  };
  createdAt: number;
}

/** Пункт чек-листа (checklist_items, миграция 019). Заполняется при открытии
 *  карточки (детальный GET /issues/:id), как attachments/links/collaborators. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
  createdAt: number;
}

/** Шаблон задачи проекта (issue_templates, миграция 022) — уровень проекта,
 *  как workflow/custom-fields. Применение — чистый client-side prefill формы
 *  CreateIssueModal, не связано с созданной задачей. */
export interface IssueTemplate {
  id: string;
  name: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  title: string;
  description: string;
  /** Необязательная подсказка стартового статуса; null — «как обычно». */
  statusId: string | null;
  position: number;
}

/** Пользовательское поле проекта (custom_fields, миграция 020) — определение,
 *  на уровне проекта, приходит в bootstrap (data.customFields), не в задаче. */
export type CustomFieldType = "text" | "number" | "select" | "checkbox" | "date";

export interface CustomFieldDef {
  id: string;
  name: string;
  fieldType: CustomFieldType;
  /** Только для fieldType='select'. */
  options: string[];
  position: number;
}

/** Спринт проекта (sprints, миграция 023) — опциональный модуль, включается
 *  per-project флагом project.sprintsEnabled (SPRINTS_MIGRATION.md). Приходит
 *  в bootstrap (data.sprints), как issueTemplates/customFields. */
export type SprintStatus = "future" | "active" | "completed";

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
}

/** Значение поля на конкретной задаче (custom_field_values). Заполняется при
 *  открытии карточки (детальный GET /issues/:id), как attachments/links/checklist.
 *  Отсутствие записи для fieldId в массиве = значение не задано. */
export interface CustomFieldValue {
  fieldId: string;
  value: string | null;
}

export interface Issue {
  id: string;
  key: string;
  title: string;
  description: string;
  typeId: IssueTypeId;
  statusId: string;
  priorityId: PriorityId;
  /** Исполнители (issue_assignees, миграция 025) — плоский список, без
   *  иерархии; [] = не назначен (раньше был единственный assigneeId). */
  assigneeIds: string[];
  reporterId: string;
  epicId: string | null;
  /** Родитель-подзадачи (миграция 021) — независимо от epicId («направление»);
   *  ровно два уровня, сервер не даёт сделать подзадачу подзадачей. */
  parentId: string | null;
  /** Спринт (миграция 023, опциональный модуль); null — бэклог или проект
   *  не использует спринты. Приходит в списке задач, не только в детальном
   *  ответе — как parentId/epicId. */
  sprintId: string | null;
  labels: string[];
  complexity: ComplexityId | null;
  dueDate?: string | null;
  rank?: number;
  color?: string;
  tStart?: number;
  tSpan?: number;
  /** Момент закрытия задачи, мс; null — не закрыта (миграция 016).
   *  На нём стоят фильтр «Готово», архив и вся отчётность. */
  doneAt: number | null;
  /** Момент ухода в архив, мс; null — задача в активном наборе. */
  archivedAt: number | null;
  comments: CommentT[];
  activity: Activity[];
  /** Приглашённые участники — заполняется при открытии карточки (GET /issues/:id). */
  collaborators: Collaborator[];
  /** Вложения — заполняется при открытии карточки (GET /issues/:id). */
  attachments: Attachment[];
  /** Связанные задачи — заполняется при открытии карточки (GET /issues/:id). */
  links: IssueLink[];
  /** Чек-лист — заполняется при открытии карточки (GET /issues/:id). */
  checklist: ChecklistItem[];
  /** Значения пользовательских полей — заполняется при открытии карточки (GET /issues/:id). */
  customFieldValues: CustomFieldValue[];
  /** total/done по ВСЕМ подзадачам, включая заархивированные (миграция 021) —
   *  заполняется при открытии карточки (GET /issues/:id); null, пока не
   *  загружено (список задач его не знает — см. subtasksSummary в api/index.ts). */
  subtasksSummary: { total: number; done: number } | null;
  /** Число активных задач с epic_id = эта (детальный GET /issues/:id); null, пока карточка не открыта.
   *  > 0 — задача уже «направление»: ей нельзя выбрать своё направление. */
  epicChildrenCount: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id?: string;
  key: string;
  name: string;
  description: string;
  departmentId?: string;
  isShared?: boolean;
  /** Модуль спринтов (миграция 023) — опциональный, по умолчанию выключен.
   *  Управляет видимостью вкладки «Спринты»; см. SPRINTS_MIGRATION.md. */
  sprintsEnabled?: boolean;
}

/** Краткая карточка проекта для списка/переключателя. */
export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  departmentId: string;
  isShared: boolean;
  sprintsEnabled: boolean;
}

export interface Department {
  id: string;
  name: string;
  ldapGroupDn: string | null;
  projectCount: number;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export interface Data {
  /** Данные текущего проекта (по currentProjectId). */
  project: Project;
  /** Все видимые пользователю проекты (для переключателя/списка). */
  projects: ProjectSummary[];
  /** Департаменты организации (для админ-вида). */
  departments: Department[];
  /** Избранные проекты текущего пользователя (миграция 024) — id из projects,
   *  наверх списка в переключателе. Не сбрасывается при переключении проекта
   *  (в отличие от notifyPrefs) — передаётся через buildProjectData(), как
   *  projects/departments. */
  favoriteProjectIds: string[];
  /** id текущего проекта; "" пока не выбран. */
  currentProjectId: string;
  users: User[];
  /** Состав текущего проекта: userId → проектная роль (manager|employee|viewer). */
  members: Record<string, ProjectRole>;
  currentUserId: string;
  issues: Issue[];
  workflow: Workflow;
  /** Шаблоны задач проекта (миграция 022). */
  issueTemplates: IssueTemplate[];
  /** Определения пользовательских полей проекта (миграция 020). */
  customFields: CustomFieldDef[];
  /** Спринты проекта (миграция 023) — пусто, если модуль выключен
   *  (project.sprintsEnabled=false). */
  sprints: Sprint[];
  /** Открытые задачи, назначенные мне по всем видимым проектам (главный экран). */
  assignedToMe: AssignedIssue[];
  /** true — сервер урезал список «Моих задач» своим потолком; надо сказать человеку. */
  assignedTruncated: boolean;
  /** true — стор содержит ВСЕ активные задачи проекта (eager-режим bootstrap либо после
   *  `ensureAllIssues`). false — стор частичный: задачи есть лишь те, что открывали/видели. */
  issuesComplete: boolean;
  /** Приглашения текущего пользователя к задачам в проектах, которые ему не открыты. */
  collaborations: Collaboration[];
  /** Лента уведомлений текущего пользователя (первая страница) + счётчик непрочитанных. */
  notifications: NotificationT[];
  unreadCount: number;
  /** Настройки уведомлений текущего пользователя (из /api/auth/me). */
  notifyPrefs: NotifyPrefsT;
}

/** Уведомление в ленте (миграция 011, NOTIFICATIONS_MIGRATION.md). */
export interface NotificationT {
  id: string;
  type:
    | "issue.assigned"
    | "issue.comment"
    | "issue.mention"
    | "issue.status"
    | "issue.collaborator"
    | "project.member";
  actor: { id: string; name: string; initials: string; color: string } | null;
  projectId: string | null;
  issueId: string | null;
  /** Денормализованные поля для показа (ключ/заголовок задачи, статусы…). */
  payload: {
    key?: string;
    title?: string;
    from?: string;
    to?: string;
    in?: string;
    projectName?: string;
    role?: string;
  };
  createdAt: number;
  read: boolean;
}

export type NotifyPrefsT = { email?: "instant" | "daily" | "off"; selfWatch?: boolean };

export type ViewId =
  | "board"
  | "backlog"
  | "sprints"
  | "timeline"
  | "reports"
  | "workflow"
  | "access"
  | "admin"
  | "docs"
  | "collaborating";

/** Задача, к которой пользователя пригласили как collaborator'а (в чужом проекте).
 *  GET /api/issues/collaborating. Показывается в разделе «Мои подключения». */
export interface Collaboration {
  issueId: string;
  projectId: string;
  key: string;
  title: string;
  statusId: string;
  statusName: string;
  statusCategory: string;
  projectKey: string;
  projectName: string;
}

/** Задача, назначенная мне (GET /api/issues/assigned-to-me). Показывается на
 *  главном экране в блоке «Мои задачи» (UI_RESTRUCTURE.md D4). */
export interface AssignedIssue {
  issueId: string;
  projectId: string;
  key: string;
  title: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  statusId: string;
  statusName: string;
  statusCategory: string;
  dueDate: string | null;
  projectKey: string;
  projectName: string;
}

/** Результат кросс-проектного поиска (GET /api/issues/search, миграция 024) —
 *  по всем видимым проектам, не только текущему. Открытие идёт обычным
 *  openIssue() после switchProject() на найденный projectId. */
export interface SearchResultItem {
  id: string;
  projectId: string;
  key: string;
  title: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  statusId: string;
  statusName: string;
  statusCategory: string;
  projectKey: string;
  projectName: string;
}

// Display names for these three id sets live in src/i18n/ (issueType.*,
// priority.*, complexity.* keys) — call sites do t(`priority.${id}`) etc.
// instead of reading a .name field here, so the label follows the current
// language. These arrays are only the id sets/ordering.
export const PRIORITY_ORDER: PriorityId[] = ["critical", "high", "medium", "low"];
export const TYPE_ORDER: IssueTypeId[] = ["task", "bug", "request"];
export const COMPLEXITY_ORDER: ComplexityId[] = ["simple", "medium", "hard"];
