/**
 * СИСТЕМА ПРАВ ДОСТУПА — серверная сторона (источник истины для проверок).
 * Матрица — общая с клиентом (shared/permissions.matrix.json → permissions.matrix.ts); клиентский src/permissions.ts
 * использует её только для UX-подсказок. Правило «своей» задачи и резолв роли продублированы в коде и сверяются
 * тестом эквивалентности поведения (test/permissions-sync.test.ts).
 *
 * Модель (project-scoped: миграция 004 + Фаза 2, см. ROLE_MIGRATION.md):
 *   1) Глобальная роль `users.global_role`: admin | member.
 *      admin — уровень ресурса: неявно имеет полные права в любом проекте
 *      (создаёт отделы, проекты, пользователей). Обычно один, но система
 *      допускает несколько admin (напр. резервный); принудительно
 *      гарантируется лишь ≥ 1 активный admin (гард в routes/users.ts).
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

import { MATRIX, PERM_META, ROLE_NAMES, type AccessRole, type PermId } from "./permissions.matrix.js";

// Матрица, PermId, AccessRole, имена ролей и разрешений — из ЕДИНОГО источника shared/permissions.matrix.json
// (ТЗ 2.2, генерация: scripts/generate-permissions.mjs). Здесь только модель поверх неё.
export { MATRIX, ROLE_NAMES };
export type { AccessRole, PermId };
export type GlobalRole = "admin" | "member";
export type ProjectRole = "manager" | "employee" | "viewer";

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
  assigneeIds: string[];
  reporterId: string;
}

/** Есть ли у роли разрешение по матрице (без сужения «своей» задачи — оно в roleCan). */
export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

/* ============================================================
   Резолв эффективной роли и проверки
   ============================================================ */

/** Эффективная роль пользователя в контексте проекта (вход для MATRIX). */
export function resolveRole(user: ServerUser, membership: Membership): AccessRole | null {
  if (user.globalRole === "admin") return "admin";
  return membership?.role ?? null;
}

/** «Своя» задача: пользователь один из исполнителей (миграция 025 — раньше
 *  был единственный assigneeId) или автор. */
export const isOwnIssue = (userId: string, issue: IssueRef): boolean =>
  issue.assigneeIds.includes(userId) || issue.reporterId === userId;

/** Проверка права по УЖЕ вычисленной эффективной роли (null — нет доступа к проекту). */
export function roleCan(
  role: AccessRole | null,
  perm: PermId,
  ctx?: { userId: string; issue: IssueRef },
): boolean {
  if (!role) return false;
  if (!roleHas(role, perm)) return false;
  if ((perm === "edit" || perm === "transition") && ctx) {
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
  if ((perm === "edit" || perm === "transition") && ownIssueViolation)
    return `Роль «${ROLE_NAMES[role]}» может изменять и перемещать только задачи, где вы исполнитель или автор`;
  return `Недоступно для роли «${ROLE_NAMES[role]}» — требуется разрешение «${PERM_META[perm].name}»`;
}

export function denialReason(user: ServerUser, membership: Membership, perm: PermId, issue?: IssueRef): string {
  const role = resolveRole(user, membership);
  const ownIssueViolation =
    (perm === "edit" || perm === "transition") &&
    !!issue &&
    !!role &&
    roleHas(role, perm) &&
    !roleCan(role, perm, { userId: user.id, issue });
  return roleDenialReason(role, perm, ownIssueViolation);
}
