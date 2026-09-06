/**
 * СИСТЕМА ПРАВ ДОСТУПА — СЕРВЕРНАЯ КОПИЯ (источник истины).
 * Клиентский src/permissions.ts используется только для UX-подсказок.
 *
 * Модель (корпоративная, миграция 002):
 *   1) Роль-уровень: у каждой роли фиксированный набор разрешений (MATRIX).
 *      Роли: admin | manager | employee | viewer.
 *   2) Задача-уровень: разрешение «edit» для роли employee сужается —
 *      редактировать можно только задачи, где сотрудник исполнитель или автор.
 */

export type AccessRole = "admin" | "manager" | "employee" | "viewer";

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

/** Минимальный контекст пользователя (из JWT + свежая роль из БД) */
export interface ServerUser {
  id: string;
  accessRole: AccessRole;
}

/** Минимальный контекст задачи для проверки уровня задачи */
export interface IssueRef {
  id: string;
  assigneeId: string | null;
  reporterId: string;
}

export const ROLE_NAMES: Record<AccessRole, string> = {
  admin: "Администратор",
  manager: "Менеджер проекта",
  employee: "Сотрудник",
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

/* -------- матрица: разрешение → роли, которым оно доступно -------- */
const MATRIX: Record<PermId, AccessRole[]> = {
  browse: ["admin", "manager", "employee", "viewer"],
  create: ["admin", "manager", "employee"],
  edit: ["admin", "manager", "employee"],
  delete: ["admin", "manager"],
  transition: ["admin", "manager", "employee"],
  comment: ["admin", "manager", "employee"],
  manageSprints: ["admin", "manager"],
  editWorkflow: ["admin"],
  manageAccess: ["admin"],
};

export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

/** «Своя» задача для сотрудника: он исполнитель или автор */
export const isOwnIssue = (user: ServerUser, issue: IssueRef): boolean =>
  issue.assigneeId === user.id || issue.reporterId === user.id;

export const canEditIssue = (user: ServerUser, issue: IssueRef): boolean => {
  if (!roleHas(user.accessRole, "edit")) return false;
  if (user.accessRole === "admin" || user.accessRole === "manager") return true;
  return isOwnIssue(user, issue); // employee — только свои
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
