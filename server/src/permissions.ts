/**
 * СИСТЕМА ПРАВ ДОСТУПА — СЕРВЕРНАЯ КОПИЯ (источник истины).
 * Клиентский src/permissions.ts используется только для UX.
 * Модель identical: роль-уровень (MATRIX) + задача-уровень (developer → только свои).
 */

export type AccessRole = "admin" | "manager" | "developer" | "viewer";

export type PermId =
  | "browse"
  | "create"
  | "edit"
  | "delete"
  | "transition"
  | "comment"
  | "manageSprints"
  | "editWorkflow"
  | "manageAccess";

/** Минимальный контекст пользователя из JWT */
export interface ServerUser {
  id: string;
  accessRole: AccessRole;
}

/** Минимальный контекст задачи для проверка уровня задачи */
export interface IssueRef {
  id: string;
  assigneeId: string | null;
  reporterId: string;
}

export const ROLE_NAMES: Record<AccessRole, string> = {
  admin: "Администратор",
  manager: "Менеджер проекта",
  developer: "Разработчик",
  viewer: "Наблюдатель",
};

const PERM_NAMES: Record<PermId, string> = {
  browse: "Просмотр проекта",
  create: "Создание задач",
  edit: "Редактирование задач",
  delete: "Удаление задач",
  transition: "Смена статуса",
  comment: "Комментарии",
  manageSprints: "Управление спринтами",
  editWorkflow: "Изменение workflow",
  manageAccess: "Управление доступом",
};

/* -------- матрица: разрешение → роли -------- */
const MATRIX: Record<PermId, AccessRole[]> = {
  browse: ["admin", "manager", "developer", "viewer"],
  create: ["admin", "manager", "developer"],
  edit: ["admin", "manager", "developer"],
  delete: ["admin", "manager"],
  transition: ["admin", "manager", "developer"],
  comment: ["admin", "manager", "developer"],
  manageSprints: ["admin", "manager"],
  editWorkflow: ["admin"],
  manageAccess: ["admin"],
};

export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

export const isOwnIssue = (user: ServerUser, issue: IssueRef): boolean =>
  issue.assigneeId === user.id || issue.reporterId === user.id;

export const canEditIssue = (user: ServerUser, issue: IssueRef): boolean => {
  if (!roleHas(user.accessRole, "edit")) return false;
  if (user.accessRole === "admin" || user.accessRole === "manager") return true;
  return isOwnIssue(user, issue);
};

/** Единая точка проверки прав на сервере */
export function can(user: ServerUser, perm: PermId, issue?: IssueRef): boolean {
  if (!roleHas(user.accessRole, perm)) return false;
  if (perm === "edit" && issue) return canEditIssue(user, issue);
  return true;
}

/** Человекочитаемая причина отказа — уходит клиенту в теле 403 */
export function denialReason(user: ServerUser, perm: PermId, issue?: IssueRef): string {
  const role = ROLE_NAMES[user.accessRole];
  if (perm === "edit" && issue && roleHas(user.accessRole, "edit") && !canEditIssue(user, issue))
    return `Роль «${role}» может редактировать только задачи, где вы исполнитель или автор`;
  return `Недоступно для роли «${role}» — требуется разрешение «${PERM_NAMES[perm]}»`;
}
