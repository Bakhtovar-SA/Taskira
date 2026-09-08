export type IssueTypeId = "task" | "bug" | "request";
export type PriorityId = "highest" | "high" | "medium" | "low" | "lowest";
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
  /** Глобальная роль ресурса. */
  globalRole: GlobalRole;
  /** Эффективная роль в текущем проекте: 'admin' если globalRole='admin',
   *  иначе проектная роль. Для `me` вычисляется в store из globalRole + members. */
  accessRole: AccessRole;
  username?: string;
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
  authorId: string;
  issueId: string;
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

export interface Issue {
  id: string;
  key: string;
  title: string;
  description: string;
  typeId: IssueTypeId;
  statusId: string;
  priorityId: PriorityId;
  assigneeId: string | null;
  reporterId: string;
  epicId: string | null;
  labels: string[];
  points: number | null;
  dueDate?: string | null;
  rank?: number;
  color?: string;
  tStart?: number;
  tSpan?: number;
  comments: CommentT[];
  activity: Activity[];
  /** Приглашённые участники — заполняется при открытии карточки (GET /issues/:id). */
  collaborators: Collaborator[];
  /** Вложения — заполняется при открытии карточки (GET /issues/:id). */
  attachments: Attachment[];
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
}

/** Краткая карточка проекта для списка/переключателя. */
export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  departmentId: string;
  isShared: boolean;
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
  /** id текущего проекта; "" пока не выбран. */
  currentProjectId: string;
  users: User[];
  /** Состав текущего проекта: userId → проектная роль (manager|employee|viewer). */
  members: Record<string, ProjectRole>;
  currentUserId: string;
  issues: Issue[];
  workflow: Workflow;
  /** Открытые задачи, назначенные мне по всем видимым проектам (главный экран). */
  assignedToMe: AssignedIssue[];
  /** Приглашения текущего пользователя к задачам в проектах, которые ему не открыты. */
  collaborations: Collaboration[];
  /** Лента уведомлений текущего пользователя (первая страница) + счётчик непрочитанных. */
  notifications: NotificationT[];
  unreadCount: number;
  /** Настройки уведомлений текущего пользователя (из /api/auth/me). */
  notifyPrefs: NotifyPrefsT;
  seq: number;
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

export type ViewId = "board" | "backlog" | "timeline" | "workflow" | "access" | "admin" | "docs" | "collaborating";

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
  priorityId: PriorityId;
  statusId: string;
  statusName: string;
  statusCategory: string;
  projectKey: string;
  projectName: string;
}

export const ISSUE_TYPES: Record<IssueTypeId, { name: string }> = {
  task: { name: "Задача" },
  bug: { name: "Баг" },
  request: { name: "Запрос" },
};

export const PRIORITIES: Record<PriorityId, { name: string }> = {
  highest: { name: "Высший" },
  high: { name: "Высокий" },
  medium: { name: "Средний" },
  low: { name: "Низкий" },
  lowest: { name: "Низший" },
};

export const PRIORITY_ORDER: PriorityId[] = ["highest", "high", "medium", "low", "lowest"];
export const TYPE_ORDER: IssueTypeId[] = ["task", "bug", "request"];
