/** Кто какой раздел настроек видит (ТЗ 5.9: «права на разделы совпадают с матрицей прав»).
 *  Чистая функция — её читают экран настроек, боковая панель и палитра.
 *
 *  - Личные — всем.
 *  - Проект: «Общее», «Модули», «Архив и удаление» — глобальный администратор (сервер: PATCH/DELETE
 *    /projects/:id — requireGlobalAdmin); «Процесс», «Поля», «Шаблоны», «Доступ» — любому участнику
 *    проекта, как и раньше экраны «Рабочий процесс» и «Права доступа»: без `editWorkflow` /
 *    `manageAccess` они только для чтения, правка по-прежнему закрыта. «Внешний вид» — любому участнику, менять —
 *    с `editAppearance` (ТЗ 5.14 п.7). «Сроки и вехи» — любому участнику, менять — с `editRoadmap` (ТЗ 5.15).
 *  - Организация — глобальный администратор. */
import { SETTINGS_SECTIONS, type SettingsHome } from "./sections";

export type SettingsCtx = { isAdmin: boolean; hasProject: boolean; isService?: boolean };

const ADMIN_ONLY_PROJECT = new Set(["general", "modules", "integrations", "archive"]);

/** Разделы, чьи страницы уже готовы (ТЗ 5.9 идёт по шагам); остальные появятся в навигации вместе со страницей. */
const READY: Record<SettingsHome, Set<string>> = {
  settings: new Set(["profile", "notifications", "appearance", "language", "tokens"]),
  projectSettings: new Set(["general", "appearance", "roadmap", "workflow", "fields", "templates", "recurring", "access", "modules", "integrations", "archive"]),
  orgSettings: new Set(["setup", "users", "service-accounts", "departments", "project-templates", "brand", "ldap", "license", "export", "audit", "maintenance", "health"]),
};

export function allowedSections(home: SettingsHome, ctx: SettingsCtx): string[] {
  const all = (SETTINGS_SECTIONS[home] as readonly string[]).filter((s) => READY[home].has(s));
  if (home === "settings") return ctx.isService ? all.filter(s => s !== "tokens") : all;
  if (home === "orgSettings") return ctx.isAdmin ? all : [];
  if (!ctx.hasProject) return [];
  return all.filter((s) => ctx.isAdmin || !ADMIN_ONLY_PROJECT.has(s));
}

/** Первый доступный раздел дома — куда вести ссылку «Настройки проекта» и т.п. */
export const firstSection = (home: SettingsHome, ctx: SettingsCtx): string | null => allowedSections(home, ctx)[0] ?? null;
