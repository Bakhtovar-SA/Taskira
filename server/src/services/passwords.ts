/**
 * SEC-PWD-01/02: проверка нового пароля локальной учётки, временный пароль сброса, счётчик неверных паролей.
 * Маршруты — routes/passwords.ts; решение и его границы — docs/adr/0034-local-password-change-reset.md.
 */
import { randomInt } from "node:crypto";
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { one, q, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { passwordPolicyViolation, type PasswordPolicyViolation } from "../passwordPolicy.js";
import { invalidateUserTokens } from "./apiTokens.js";
import { hashPassword } from "./passwordHash.js";

export interface PasswordResetOutcome {
  temporaryPassword: string;
  expiresAt: string;
  revokedTokens: number;
}

/**
 * Сброс пароля локальной учётки одной транзакцией: временный пароль + `must_change_password` + срок, блокировка
 * снята, `session_version + 1`, и ВСЕ активные API-токены пользователя отозваны (сброс — реакция на возможную
 * компрометацию; токен, выпущенный злоумышленником до сброса, не должен его пережить).
 *
 * allowAdmin=false (маршрут администратора): администратора и break-glass учётку (`ADMIN_USERNAME`) сбросить нельзя —
 * иначе администратор из LDAP-группы через сброс break-glass получал бы постоянного администратора вне каталога,
 * а в local-режиме один администратор захватывал бы учётку другого. Условие стоит в самом UPDATE, а не только в
 * проверке маршрута: повышение до администратора между SELECT и UPDATE не проскочит. allowAdmin=true — только
 * консольное восстановление (src/resetPassword.ts), для которого нужен доступ к серверу и БД.
 *
 * Возвращает null, если строка не подошла (не локальная, администратор при allowAdmin=false, удалена).
 * Сессии в памяти процесса (WS, кэш свежести) вызывающий отзывает сам — revokeUserSessions() живёт в middleware.
 */
export async function resetLocalPassword(
  target: PasswordOwner & { id: string },
  actorId: string | null,
  opts: { allowAdmin: boolean },
): Promise<PasswordResetOutcome | null> {
  const cfg = loadConfig();
  const temporaryPassword = await generateTemporaryPassword(target);
  const hash = await hashPassword(temporaryPassword);
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query<{ password_expires_at: Date }>(
      `UPDATE users
          SET password_hash = $2, must_change_password = true,
              password_expires_at = now() + ($3 * interval '1 hour'),
              session_version = session_version + 1, failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1 AND auth_source = 'local'
          AND ($4::boolean OR (global_role <> 'admin' AND username IS DISTINCT FROM $5))
        RETURNING password_expires_at`,
      [target.id, hash, cfg.passwords.resetTtlHours, opts.allowAdmin, cfg.admin?.username ?? null],
    );
    if (!rows[0]) return null;
    const tokens = await client.query<{ id: string; prefix: string; scope: string }>(
      `UPDATE api_tokens SET revoked_at = now(), revoked_by = $2
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id, prefix, scope`,
      [target.id, actorId],
    );
    return { expiresAt: rows[0].password_expires_at, tokens: tokens.rows };
  });
  if (!result) return null;
  invalidateUserTokens(target.id); // кэш проверенных токенов (≤30 с) — сразу
  for (const t of result.tokens)
    await audit(actorId, "token.revoke", "apiToken", t.id, { tokenId: t.id, prefix: t.prefix, scope: t.scope, ownerId: target.id, reason: "password_reset" });
  return { temporaryPassword, expiresAt: result.expiresAt.toISOString(), revokedTokens: result.tokens.length };
}

/** Кто ставит пароль — для запрета логина и имени в пароле. */
export interface PasswordOwner {
  username: string;
  name?: string | null;
  given_name?: string | null;
}

/**
 * Контекстные слова организации (ASVS V6.1.2/V6.2.11): PASSWORD_CONTEXT_WORDS, название инсталляции и бренд,
 * названия команд (departments). Встроенные слова продукта добавляет сама политика. Читается на каждую смену
 * пароля — это редкая операция, кэш не нужен.
 */
export async function organizationContextWords(): Promise<string[]> {
  const words = [...loadConfig().passwords.contextWords];
  const inst = await one<{ name: string | null; brand_name: string | null }>(`SELECT name, brand_name FROM instance WHERE id = 1`);
  if (inst?.name) words.push(inst.name);
  if (inst?.brand_name) words.push(inst.brand_name);
  for (const d of await q<{ name: string }>(`SELECT name FROM departments`)) words.push(d.name);
  return words;
}

/** Отказ политики — конкретным кодом, чтобы клиент на английском показал, что именно не так (apiError.<CODE>). */
export function policyError(v: PasswordPolicyViolation): ApiHttpError {
  switch (v.code) {
    case "PASSWORD_TOO_SHORT": return new ApiHttpError(400, "PASSWORD_TOO_SHORT", v.reason);
    case "PASSWORD_TOO_LONG": return new ApiHttpError(400, "PASSWORD_TOO_LONG", v.reason);
    case "PASSWORD_COMMON": return new ApiHttpError(400, "PASSWORD_COMMON", v.reason);
    case "PASSWORD_CONTAINS_USERNAME": return new ApiHttpError(400, "PASSWORD_CONTAINS_USERNAME", v.reason);
    case "PASSWORD_CONTEXT_WORD": return new ApiHttpError(400, "PASSWORD_CONTEXT_WORD", v.reason);
  }
}

/** Полная политика к новому паролю: длина, список частых, логин, контекстные слова (продукт, организация, команды,
 *  собственное имя). Бросает 400 с кодом нарушения. */
export async function assertPasswordAllowed(password: string, owner: PasswordOwner): Promise<void> {
  const contextWords = [...(await organizationContextWords()), owner.name ?? "", owner.given_name ?? ""];
  const v = passwordPolicyViolation(password, { username: owner.username, contextWords });
  if (v) throw policyError(v);
}

/** Алфавит временного пароля без похожих символов (0/O, 1/l/I): его диктуют и перепечатывают. 57 символов. */
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_GROUPS = 4;
const TEMP_GROUP_LEN = 5;

/**
 * Временный пароль сброса (ASVS V6.4.1): CSPRNG (`crypto.randomInt`), 20 символов из 57 — ≈116 бит, группы по пять
 * через дефис (24 символа, удобно продиктовать). Проходит ту же политику, что пароль человека: генерация повторяется,
 * пока политика не примет (на практике — с первой попытки).
 */
export async function generateTemporaryPassword(owner: PasswordOwner): Promise<string> {
  const contextWords = [...(await organizationContextWords()), owner.name ?? "", owner.given_name ?? ""];
  for (;;) {
    const groups: string[] = [];
    for (let g = 0; g < TEMP_GROUPS; g++) {
      let s = "";
      for (let i = 0; i < TEMP_GROUP_LEN; i++) s += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
      groups.push(s);
    }
    const candidate = groups.join("-");
    if (!passwordPolicyViolation(candidate, { username: owner.username, contextWords })) return candidate;
  }
}

/**
 * Неверный текущий пароль при смене считается так же, как неверный пароль при входе (routes/auth.ts
 * recordLoginFailure): тот же счётчик failed_login_attempts и та же блокировка locked_until. Иначе украденная сессия
 * давала бы безлимитный перебор пароля в обход блокировки входа. Возвращает true, если учётка теперь заблокирована.
 */
export async function recordPasswordFailure(userId: string): Promise<boolean> {
  const rl = loadConfig().rateLimit;
  const row = await one<{ locked_until: Date | null }>(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2
                THEN now() + ($3 * interval '1 second')
              ELSE locked_until
            END
      WHERE id = $1 AND auth_source = 'local'
      RETURNING locked_until`,
    [userId, rl.accountMaxFailures, rl.accountLockSeconds],
  );
  return !!row?.locked_until && row.locked_until.getTime() > Date.now();
}

/** Лимит запросов на маршруты пароля — тот же @fastify/rate-limit, что глобальный в app.ts (ключ — пользователь),
 *  со своей корзиной на маршрут и порогами лимита входа (RATE_LIMIT_LOGIN_MAX за RATE_LIMIT_LOGIN_WINDOW_MS).
 *  После SEC-RATE-01 заменить на `routeLimit("sensitive")` из routeLimits.ts. */
export const passwordRouteLimit = {
  config: {
    rateLimit: {
      max: () => loadConfig().rateLimit.loginMax,
      timeWindow: () => loadConfig().rateLimit.loginWindowMs,
    },
  },
};
