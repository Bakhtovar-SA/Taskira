import type { AccessRole, GlobalRole, Issue, ProjectRole, User } from "./types";
import { MATRIX, PERM_IDS, PERM_META, ROLE_DESCRIPTIONS, ROLE_IDS, ROLE_NAMES, type PermId, type PermScope } from "./permissions.matrix";

export type { PermId };

/* ============================================================
   СИСТЕМА ПРАВ ДОСТУПА (клиент — только UX; сервер — источник истины)
   Роли: admin | manager | employee | viewer

   Модель project-scoped (миграция 004): эффективная роль пользователя =
   resolveRole(globalRole, projectRole). Ниже `user.accessRole` — это уже
   ВЫЧИСЛЕННАЯ эффективная роль (store подставляет её в `me`).
   Матрица, PermId и названия — из ЕДИНОГО источника shared/permissions.matrix.json (ТЗ 2.2, permissions.matrix.ts
   генерируется); can()/denialReason() зеркалят server/src/permissions.ts и сверяются с ним тестом поведения.

   Вложения к задачам (миграция 010, FILES_MIGRATION.md D2) отдельного права
   не имеют: загрузка/удаление своего = `comment`; удаление чужого = `delete`.
   Новых ключей в MATRIX нет.
   ============================================================ */

/** Эффективная роль в проекте — зеркалит server/src/permissions.ts `resolveRole()`.
 *  globalRole='admin' → 'admin'; иначе проектная роль; иначе null (не участник). */
export const resolveRole = (
  globalRole: GlobalRole,
  projectRole: ProjectRole | undefined,
): AccessRole | null => (globalRole === "admin" ? "admin" : projectRole ?? null);

export interface RoleMeta {
  id: AccessRole;
  name: string;
  color: string;
  short: string;
  desc: string;
}

/** Только клиентское оформление роли (цвет, короткая метка); имя и описание — из общей матрицы. */
const ROLE_STYLE: Record<AccessRole, { short: string; color: string }> = {
  admin: { short: "admin", color: "var(--status-danger-fg)" },
  manager: { short: "pm", color: "var(--accent-text)" },
  employee: { short: "emp", color: "var(--status-done-fg)" },
  viewer: { short: "read", color: "var(--text-3)" },
};

export const ACCESS_ROLES: RoleMeta[] = ROLE_IDS.map((id) => ({
  id,
  name: ROLE_NAMES[id],
  desc: ROLE_DESCRIPTIONS[id],
  ...ROLE_STYLE[id],
}));

export const ROLE_ORDER: AccessRole[] = [...ROLE_IDS];

export const roleMeta = (id: AccessRole): RoleMeta => ACCESS_ROLES.find((r) => r.id === id) ?? ACCESS_ROLES[3];

export interface PermMeta {
  id: PermId;
  name: string;
  desc: string;
  scope: PermScope;
}

export const PERMISSIONS: PermMeta[] = PERM_IDS.map((id) => ({ id, ...PERM_META[id] }));

export const permMeta = (id: PermId): PermMeta => PERMISSIONS.find((p) => p.id === id)!;

export const roleHas = (role: AccessRole, perm: PermId): boolean => MATRIX[perm].includes(role);

export const isOwnIssue = (user: User, issue: Issue): boolean =>
  issue.assigneeIds.includes(user.id) || issue.reporterId === user.id;

export const canEditIssue = (user: User, issue: Issue): boolean => {
  if (!roleHas(user.accessRole, "edit")) return false;
  if (user.accessRole === "admin" || user.accessRole === "manager") return true;
  return isOwnIssue(user, issue);
};

export function can(user: User, perm: PermId, issue?: Issue): boolean {
  if (!roleHas(user.accessRole, perm)) return false;
  if ((perm === "edit" || perm === "transition") && issue) return canEditIssue(user, issue);
  return true;
}

export function denialReason(user: User, perm: PermId, issue?: Issue, lang: "ru" | "en" = "ru"): string {
  const role = lang === "ru" ? roleMeta(user.accessRole).name : ({ admin: "Administrator", manager: "Project manager", employee: "Employee", viewer: "Viewer" } as const)[user.accessRole];
  if ((perm === "edit" || perm === "transition") && issue && roleHas(user.accessRole, perm) && !canEditIssue(user, issue))
    return lang === "ru"
      ? `Роль «${role}» может изменять и перемещать только задачи, где вы исполнитель или автор`
      : `The “${role}” role can edit and move only issues where you are the assignee or reporter`;
  const permission = lang === "ru" ? permMeta(perm).name : perm;
  return lang === "ru"
    ? `Недоступно для роли «${role}» — требуется разрешение «${permission}»`
    : `Unavailable to the “${role}” role — the “${permission}” permission is required`;
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
