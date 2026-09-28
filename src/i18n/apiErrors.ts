/**
 * Текст ошибки сервера на языке интерфейса (A8). Сервер отвечает `{ code, reason }`, где `reason` всегда по-русски
 * (локали у сервера нет, см. CLAUDE.md «Server-originated text»). Поэтому:
 *  - русский интерфейс показывает `reason` как есть — он точнее любого перевода;
 *  - английский берёт текст по машинному `code` из словаря (`apiError.CODE`), а неизвестный код заменяет общим
 *    текстом действия (`fallback`) — русская строка в английский интерфейс не попадает.
 * Общие коды (FORBIDDEN, CONFLICT, VALIDATION…) ничего не говорят о действии, поэтому к ним спереди добавляется
 * `fallback` («Couldn't save the issue. You don't have permission for this action»); у конкретных кодов
 * (ATTACHMENT_TOO_LARGE…) текст самодостаточен.
 */
import ru, { type TKey } from "./ru";
import type { Lang } from "./index";

type TFn = (key: TKey, params?: Record<string, string | number>) => string;

/** Коды, которые описывают причину, но не действие — к ним нужен контекст. */
const GENERIC = new Set(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION", "BAD_REQUEST", "LIMIT"]);

/** Ошибка API по форме, без импорта `../api` (i18n не должен зависеть от HTTP-слоя). */
function apiShape(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof Error)) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? { code, message: e.message } : null;
}

export function apiErrorText(e: unknown, lang: Lang, t: TFn, fallback: string): string {
  const err = apiShape(e);
  if (!err) return fallback;
  if (lang === "ru") return err.message || fallback;
  const key = `apiError.${err.code}`;
  if (!(key in ru)) return fallback;
  const text = t(key as TKey);
  if (!GENERIC.has(err.code) || !fallback) return text;
  return `${fallback.replace(/[.!…]+$/, "")}. ${text}`;
}
