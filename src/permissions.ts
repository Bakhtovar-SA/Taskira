import type { AccessRole, Issue, User } from "./types";

/* ============================================================
   СИСТЕМА ПРАВ ДОСТУПА
   Двухуровневая модель, как в Jira Permission Schemes:
   1) Роль-уровень: у каждой роли есть набор разрешений (матрица MATRIX).
   2) Задача-уровень: разрешение «edit» для разработчика сужается —
      редактировать можно только задачи, где он исполнитель или автор.
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
    desc: "Полный контроль проекта: схема рабочего процесса, права доступа, удаление задач, спринты и любые поля.",
  },
  {
    id: "manager",
    name: "Менеджер проекта",
    short: "pm",
    color: "#0B5FD9",
    desc: "Управляет спринтами и содержанием: создание, редактирование и удаление любых задач. Не меняет схему workflow и роли.",
  },
  {
    id: "developer",
    name: "Разработчик",
    short: "dev",
    color: "#1C8A5C",
    desc: "Создаёт задачи, двигает их по workflow и комментирует. Редактирует поля только своих задач (исполнитель или автор).",
  },
  {
    id: "viewer",
    name: "Наблюдатель",
    short: "read",
    color: "#64748B",
    desc: "Режим «только чтение»: видит доску, бэклог, таймлайн и карточки, но не может ничего изменять.",
  },
];

export const ROLE_ORDER: AccessRole[] = ["admin", "manager", "developer", "viewer"];

export const roleMeta = (id: AccessRole): RoleMeta => ACCESS_ROLES.find((r) => r.id === id) ?? ACCESS_ROLES[3];

/* -------- матрица: разрешение → роли, которым оно доступно -------- */
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

export interface PermMeta {
  id: PermId;
  name: string;
  desc: string;
  scope: "Проект" | "Задача" | "Спринт" | "Схема" | "Пользователи";
}

export const PERMISSIONS: PermMeta[] = [
  { id: "browse", name: "Просмотр проекта", desc: "Доска, бэклог, таймлайн, карточки задач, история и комментарии.", scope: "Проект" },
  { id: "create", name: "Создание задач", desc: "Кнопка «Создать», быстрое создание в колонках доски, создание эпиков.", scope: "Задача" },
  { id: "edit", name: "Редактирование задач", desc: "Название, описание, приоритет, исполнитель, эпик, метки, оценка. Для разработчика — только свои задачи.", scope: "Задача" },
  { id: "transition", name: "Смена статуса", desc: "Перетаскивание карточек по доске и смена статуса в карточке — в пределах схемы workflow.", scope: "Задача" },
  { id: "delete", name: "Удаление задач", desc: "Удаление задач и эпиков с отвязкой дочерних задач.", scope: "Задача" },
  { id: "comment", name: "Комментарии", desc: "Добавление комментариев в карточку задачи.", scope: "Задача" },
  { id: "manageSprints", name: "Управление спринтами", desc: "Старт и завершение спринта, перенос задач между спринтами и бэклогом.", scope: "Спринт" },
  { id: "editWorkflow", name: "Изменение workflow", desc: "Добавление и удаление переходов между статусами, сброс схемы.", scope: "Схема" },
  { id: "manageAccess", name: "Управление доступом", desc: "Просмотр матрицы разрешений и смена текущего пользователя (демо-переключение ролей).", scope: "Пользователи" },
];

export const permMeta = (id: PermId): PermMeta => PERMISSIONS.find((p) => p.id === id)!;

export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

/* -------- задача-уровень: «своя» задача для разработчика -------- */
export const isOwnIssue = (user: User, issue: Issue): boolean =>
  issue.assigneeId === user.id || issue.reporterId === user.id;

export const canEditIssue = (user: User, issue: Issue): boolean => {
  if (!roleHas(user.accessRole, "edit")) return false;
  if (user.accessRole === "admin" || user.accessRole === "manager") return true;
  return isOwnIssue(user, issue);
};

/* -------- единая точка проверки -------- */
export function can(user: User, perm: PermId, issue?: Issue): boolean {
  if (!roleHas(user.accessRole, perm)) return false;
  if (perm === "edit" && issue) return canEditIssue(user, issue);
  return true;
}

/* -------- человекочитаемая причина отказа (для тостов и подсказок) -------- */
export function denialReason(user: User, perm: PermId, issue?: Issue): string {
  const role = roleMeta(user.accessRole).name;
  if (perm === "edit" && issue && roleHas(user.accessRole, "edit") && !canEditIssue(user, issue))
    return `Роль «${role}» может редактировать только задачи, где вы исполнитель или автор`;
  return `Недоступно для роли «${role}» — требуется разрешение «${permMeta(perm).name}»`;
}

/* Итоговая сводка возможностей пользователя — используется в UI и в документации */
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
