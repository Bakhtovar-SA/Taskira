import type { AccessRole, Issue, User } from "./types";

/* ============================================================
   СИСТЕМА ПРАВ ДОСТУПА (клиент — только UX; сервер — источник истины)
   Роли: admin | manager | employee | viewer
   ============================================================ */

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

export interface RoleMeta {
  id: AccessRole;
  name: string;
  color: string;
  short: string;
  desc: string;
}

export const ACCESS_ROLES: RoleMeta[] = [
  {
    id: "admin",
    name: "Администратор",
    short: "admin",
    color: "#B42318",
    desc: "Полный контроль проекта: схема workflow, права доступа, удаление задач, спринты.",
  },
  {
    id: "manager",
    name: "Менеджер проекта",
    short: "pm",
    color: "#0B5FD9",
    desc: "Управляет спринтами и задачами: создание, редактирование и удаление. Не меняет workflow и роли.",
  },
  {
    id: "employee",
    name: "Сотрудник",
    short: "emp",
    color: "#1C8A5C",
    desc: "Создаёт задачи, двигает по workflow, комментирует. Редактирует только свои (исполнитель или автор).",
  },
  {
    id: "viewer",
    name: "Наблюдатель",
    short: "read",
    color: "#64748B",
    desc: "Только просмотр: доска, бэклог, карточки — без изменений.",
  },
];

export const ROLE_ORDER: AccessRole[] = ["admin", "manager", "employee", "viewer"];

export const roleMeta = (id: AccessRole): RoleMeta => ACCESS_ROLES.find((r) => r.id === id) ?? ACCESS_ROLES[3];

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

export interface PermMeta {
  id: PermId;
  name: string;
  desc: string;
  scope: "Проект" | "Задача" | "Спринт" | "Схема" | "Пользователи";
}

export const PERMISSIONS: PermMeta[] = [
  { id: "browse", name: "Просмотр проекта", desc: "Доска, бэклог, карточки, история и комментарии.", scope: "Проект" },
  { id: "create", name: "Создание задач", desc: "Кнопка «Создать», создание задач.", scope: "Задача" },
  { id: "edit", name: "Редактирование задач", desc: "Поля задачи. Для сотрудника — только свои.", scope: "Задача" },
  { id: "transition", name: "Смена статуса", desc: "Перетаскивание и смена статуса в пределах workflow.", scope: "Задача" },
  { id: "delete", name: "Удаление задач", desc: "Удаление задач.", scope: "Задача" },
  { id: "comment", name: "Комментарии", desc: "Добавление комментариев.", scope: "Задача" },
  { id: "manageSprints", name: "Управление спринтами", desc: "Старт/завершение спринта, перенос задач.", scope: "Спринт" },
  { id: "editWorkflow", name: "Изменение workflow", desc: "Переходы и сброс схемы.", scope: "Схема" },
  { id: "manageAccess", name: "Управление доступом", desc: "Пользователи и роли (на сервере).", scope: "Пользователи" },
];

export const permMeta = (id: PermId): PermMeta => PERMISSIONS.find((p) => p.id === id)!;

export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

export const isOwnIssue = (user: User, issue: Issue): boolean =>
  issue.assigneeId === user.id || issue.reporterId === user.id;

export const canEditIssue = (user: User, issue: Issue): boolean => {
  if (!roleHas(user.accessRole, "edit")) return false;
  if (user.accessRole === "admin" || user.accessRole === "manager") return true;
  return isOwnIssue(user, issue);
};

export function can(user: User, perm: PermId, issue?: Issue): boolean {
  if (!roleHas(user.accessRole, perm)) return false;
  if (perm === "edit" && issue) return canEditIssue(user, issue);
  return true;
}

export function denialReason(user: User, perm: PermId, issue?: Issue): string {
  const role = roleMeta(user.accessRole).name;
  if (perm === "edit" && issue && roleHas(user.accessRole, "edit") && !canEditIssue(user, issue))
    return `Роль «${role}» может редактировать только задачи, где вы исполнитель или автор`;
  return `Недоступно для роли «${role}» — требуется разрешение «${permMeta(perm).name}»`;
}

export interface CapabilitySummary {
  role: AccessRole;
  can: (perm: PermId, issue?: Issue) => boolean;
  readOnly: boolean;
}

export const summarize = (user: User): CapabilitySummary => ({
  role: user.accessRole,
  can: (perm, issue) => can(user, perm, issue),
  readOnly: user.accessRole === "viewer",
});
