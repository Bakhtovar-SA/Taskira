/**
 * СИСТЕМА ПРАВ ДОСТУПА — СЕРВЕРНАЯ КОПИЯ (источник истины).
 * Клиентский src/permissions.ts используется только для UX-подсказок.
 *
 * Модель (project-scoped: миграция 004 + Фаза 2, см. ROLE_MIGRATION.md):
 *   1) Глобальная роль `users.global_role`: admin | member.
 *      admin — единственный на весь ресурс; неявно имеет полные права
 *      в любом проекте (создаёт отделы, проекты, пользователей).
 *   2) Проектная роль `project_members.role`: manager | employee | viewer.
 *   3) Эффективная роль для матрицы = resolveRole(user, membership):
 *        global_role = 'admin'  -> 'admin';
 *        иначе                  -> project_members.role, либо null (нет доступа).
 *   4) MATRIX (роль -> набор разрешений) от проекта НЕ зависит и не менялась
 *      при переходе на project-scoped модель. Права editWorkflow / manageAccess
 *      остаются только у 'admin' (решение ROLE_MIGRATION.md §3.2).
 *   5) Задача-уровень: разрешение 'edit' для роли 'employee' сужается —
 *      редактировать можно только задачи, где он исполнитель или автор.
 */

export type AccessRole = "admin" | "manager" | "employee" | "viewer";
export type GlobalRole = "admin" | "member";
export type ProjectRole = "manager" | "employee" | "viewer";

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

/** Пользователь: id + глобальная роль (из JWT, освежается из БД в requireAuth). */
export interface ServerUser {
  id: string;
  globalRole: GlobalRole;
}

/** Членство пользователя в проекте, либо null — не участник проекта. */
export type Membership = { projectId: string; role: ProjectRole } | null;

/** Минимальный контекст задачи для проверки уровня задачи. */
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

/* -------- матрица: разрешение → роли, которым оно доступно (без изменений) -------- */
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

/* ============================================================
   Резолв эффективной роли и проверки
   ============================================================ */

/** Эффективная роль пользователя в контексте проекта (вход для MATRIX). */
export function resolveRole(user: ServerUser, membership: Membership): AccessRole | null {
  if (user.globalRole === "admin") return "admin";
  return membership?.role ?? null;
}

/** «Своя» задача: пользователь исполнитель или автор. */
export const isOwnIssue = (userId: string, issue: IssueRef): boolean =>
  issue.assigneeId === userId || issue.reporterId === userId;

/** Проверка права по УЖЕ вычисленной эффективной роли (null — нет доступа к проекту). */
export function roleCan(
  role: AccessRole | null,
  perm: PermId,
  ctx?: { userId: string; issue: IssueRef },
): boolean {
  if (!role) return false;
  if (!roleHas(role, perm)) return false;
  if (perm === "edit" && ctx) {
    if (role === "admin" || role === "manager") return true;
    return isOwnIssue(ctx.userId, ctx.issue); // employee — только свои
  }
  return true;
}

/** Единая точка проверки прав на сервере: роль резолвится по членству. */
export function can(user: ServerUser, membership: Membership, perm: PermId, issue?: IssueRef): boolean {
  return roleCan(resolveRole(user, membership), perm, issue ? { userId: user.id, issue } : undefined);
}

/** Человекочитаемая причина отказа по эффективной роли — уходит клиенту в теле 403. */
export function roleDenialReason(role: AccessRole | null, perm: PermId, ownIssueViolation = false): string {
  if (!role) return "Нет доступа к проекту — обратитесь к администратору";
  if (perm === "edit" && ownIssueViolation)
    return `Роль «${ROLE_NAMES[role]}» может редактировать только задачи, где вы исполнитель или автор`;
  return `Недоступно для роли «${ROLE_NAMES[role]}» — требуется разрешение «${PERM_NAMES[perm]}»`;
}

export function denialReason(user: ServerUser, membership: Membership, perm: PermId, issue?: IssueRef): string {
  const role = resolveRole(user, membership);
  const ownIssueViolation =
    perm === "edit" &&
    !!issue &&
    !!role &&
    roleHas(role, "edit") &&
    !roleCan(role, "edit", { userId: user.id, issue });
  return roleDenialReason(role, perm, ownIssueViolation);
}
