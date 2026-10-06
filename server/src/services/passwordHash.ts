/**
 * Хэширование паролей (SEC-PWD-02, ASVS 5.0 V6.2.8/V6.2.9).
 *
 * bcrypt учитывает только первые 72 БАЙТА пароля: `я`×40 (80 байт) совпадал с `я`×36+`x`, а кириллическая фраза
 * из 64 символов (128 байт) тихо усекалась. Новый формат — bcrypt от base64(SHA-256(пароль)): 44 ASCII-символа,
 * значим каждый байт исходного пароля, NUL-байтов внутри нет (base64). Префикс делает формат самоописываемым:
 *
 *   sha256b64$<обычная bcrypt-строка $2a$…>   — новый формат;
 *   $2a$… / $2b$…                             — прежний bcrypt от сырого пароля (все учётки до этой версии).
 *
 * Старые хэши продолжают работать; при успешном входе пароль перехэшируется в новый формат (needsRehash) — без
 * миграции данных и без принудительной смены пароля. Пока учётка не входила, для неё остаётся прежнее усечение.
 */
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 10;
const PREFIX = "sha256b64$";

function prehash(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("base64");
}

export async function hashPassword(password: string): Promise<string> {
  return PREFIX + (await bcrypt.hash(prehash(password), BCRYPT_COST));
}

export interface PasswordCheck {
  ok: boolean;
  /** Пароль верен, но хэш в старом формате — перезаписать hashPassword(password). */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<PasswordCheck> {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith(PREFIX)) return { ok: await bcrypt.compare(prehash(password), stored.slice(PREFIX.length)), needsRehash: false };
  const ok = await bcrypt.compare(password, stored);
  return { ok, needsRehash: ok };
}
