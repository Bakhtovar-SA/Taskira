import { COMMON_PASSWORDS_SOURCE } from "./data/commonPasswords.js";

/**
 * Политика паролей локальных и break-glass учёток (SEC-PWD-02, ASVS 5.0 V6.2). LDAP-пароли — забота AD.
 *
 * Чего здесь НЕТ намеренно: требований к составу (строчные/заглавные/цифры/спецсимволы) — ASVS 5.0 V6.2.5 прямо
 * запрещает составные правила, они толкают к `Password1!` и не мешают фразам-паролям. Вместо них — длина, список
 * частых паролей (V6.2.4), контекстные слова (V6.1.2/V6.2.11) и запрет тривиальных повторов.
 *
 * Пароль сравнивается как есть: не обрезается и не меняет регистр (V6.2.8); усечение bcrypt до 72 байт снято
 * предхэшированием (services/passwordHash.ts), так что 128 символов значимы целиком (V6.2.9).
 */
export const PASSWORD_MIN_LENGTH = 14;
export const PASSWORD_MAX_LENGTH = 128;

/** Встроенные контекстные слова (V6.1.2): название продукта и типичные «пароли по умолчанию». Слова организации
 *  (бренд, команды, PASSWORD_CONTEXT_WORDS) добавляет services/passwords.ts — их знает только БД/окружение. */
export const BUILTIN_CONTEXT_WORDS = ["taskira", "таскира"] as const;

const KNOWN_DEFAULTS = new Set([
  "admin",
  "admin123",
  "changeme",
  "changeit",
  "password",
  "password123",
  "taskira",
  "taskira123",
]);

let common: Set<string> | null = null;
/** Ленивая загрузка: 5000 строк разбираются один раз, при первой проверке. */
function commonPasswords(): Set<string> {
  common ??= new Set(COMMON_PASSWORDS_SOURCE.split("\n"));
  return common;
}

export type PasswordPolicyCode =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_COMMON"
  | "PASSWORD_CONTAINS_USERNAME"
  | "PASSWORD_CONTEXT_WORD";

export interface PasswordPolicyViolation {
  code: PasswordPolicyCode;
  reason: string;
}

export interface PasswordPolicyOptions {
  username?: string;
  /** Дополнительные контекстные слова (уже нормализованные или нет — приводятся здесь). */
  contextWords?: readonly string[];
  /** false — только базовые правила (длина, известные дефолты, логин): проверка ADMIN_PASSWORD при старте.
   *  Список частых паролей и контекстные слова там не применяются, чтобы обновление не уронило уже работающую
   *  установку из-за пароля, который больше не используется (хэш давно в БД). */
  lists?: boolean;
}

/** Контекстное слово короче 4 символов не проверяется: «IT» или «ОП» запрещали бы половину фраз. */
export const CONTEXT_WORD_MIN = 4;

export function normalizeContextWords(words: readonly string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    for (const part of w.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (part.length >= CONTEXT_WORD_MIN) out.add(part);
  }
  return [...out];
}

/** Тривиальный повтор: меньше 4 разных символов на 14+ (например `Aaaaaaaaaaaaaaaa1`, `abababababababab`). Это не
 *  требование к составу (какие символы нужны), а запрет заведомо угадываемого — как запись в чёрном списке. */
function trivial(lower: string): boolean {
  return new Set(lower).size < 4;
}

export function passwordPolicyViolation(password: string, opts: PasswordPolicyOptions = {}): PasswordPolicyViolation | null {
  const length = [...password].length; // символы, а не UTF-16 code units: «я»×14 — это 14 символов
  if (length < PASSWORD_MIN_LENGTH)
    return { code: "PASSWORD_TOO_SHORT", reason: `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов` };
  if (length > PASSWORD_MAX_LENGTH)
    return { code: "PASSWORD_TOO_LONG", reason: `Пароль должен содержать не более ${PASSWORD_MAX_LENGTH} символов` };

  const lower = password.toLowerCase();
  const normalized = lower.trim();
  if (KNOWN_DEFAULTS.has(normalized))
    return { code: "PASSWORD_COMMON", reason: "Нельзя использовать известный пароль по умолчанию" };
  const username = opts.username?.trim().toLowerCase();
  if (username && lower.includes(username))
    return { code: "PASSWORD_CONTAINS_USERNAME", reason: "Пароль не должен содержать имя пользователя" };
  if (opts.lists === false) return null;

  if (trivial(lower) || commonPasswords().has(normalized))
    return { code: "PASSWORD_COMMON", reason: "Этот пароль слишком распространён или предсказуем — выберите другой" };
  const words = normalizeContextWords([...BUILTIN_CONTEXT_WORDS, ...(opts.contextWords ?? [])]);
  if (words.some((w) => lower.includes(w)))
    return { code: "PASSWORD_CONTEXT_WORD", reason: "Пароль не должен содержать название продукта, организации или команды" };
  return null;
}

/** Строковая форма для zod-схем и проверки конфигурации. */
export function passwordPolicyError(password: string, username?: string, opts: Omit<PasswordPolicyOptions, "username"> = {}): string | null {
  return passwordPolicyViolation(password, { ...opts, username })?.reason ?? null;
}
