/** Три дома настроек (ADR-0013 §2, IA §3, ТЗ 5.9): у каждой настройки ровно один дом.
 *  Чистые данные — их читают роутер (адреса), боковая панель, палитра и сам экран настроек. */
import type { ViewId } from "../types";

export type SettingsHome = "settings" | "projectSettings" | "orgSettings";

export const SETTINGS_SECTIONS = {
  /** Личные — `/settings/…`, любой пользователь. */
  settings: ["profile", "notifications", "appearance", "language", "tokens"],
  /** Проект — `/p/:key/settings/…`, по правам проекта. */
  projectSettings: ["general", "appearance", "roadmap", "workflow", "fields", "templates", "recurring", "access", "modules", "integrations", "archive"],
  /** Организация — `/admin/…`, глобальный администратор. */
  orgSettings: ["users", "service-accounts", "departments", "project-templates", "brand", "ldap", "license", "export", "audit", "maintenance", "health", "setup"],
} as const satisfies Record<SettingsHome, readonly string[]>;

export type SettingsSection<H extends SettingsHome = SettingsHome> = (typeof SETTINGS_SECTIONS)[H][number];

export const isSettingsHome = (v: ViewId): v is SettingsHome => v === "settings" || v === "projectSettings" || v === "orgSettings";

/** Раздел по умолчанию, если в адресе его нет. */
export const DEFAULT_SECTION: Record<SettingsHome, string> = {
  settings: "profile",
  projectSettings: "general",
  orgSettings: "departments",
};

export const isSection = (home: SettingsHome, s: string): boolean => (SETTINGS_SECTIONS[home] as readonly string[]).includes(s);
