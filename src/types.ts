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
  sprintId: string | null;
  dueDate?: string | null;
  rank?: number;
  color?: string;
  tStart?: number;
  tSpan?: number;
  comments: CommentT[];
  activity: Activity[];
  createdAt: number;
  updatedAt: number;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: "active" | "future" | "completed";
  startDate: string;
  endDate: string;
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
  /** id текущего проекта; "" пока не выбран. */
  currentProjectId: string;
  users: User[];
  /** Состав текущего проекта: userId → проектная роль (manager|employee|viewer). */
  members: Record<string, ProjectRole>;
  currentUserId: string;
  issues: Issue[];
  sprints: Sprint[];
  workflow: Workflow;
  seq: number;
}

export type ViewId = "board" | "backlog" | "timeline" | "workflow" | "access" | "docs";

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
