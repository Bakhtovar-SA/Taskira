/** POST /api/auth/login · GET /api/auth/me
 *  Режим входа: config.authMode (LDAP_MIGRATION.md D2).
 *   - local: только локальный пароль (как раньше);
 *   - ldap:  LDAP/AD; при недоступности LDAP или для локальной учётки —
 *            break-glass вход по паролю ТОЛЬКО для config.admin.username. */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { LoginBody } from "../contract.js";
import { audit } from "../audit.js";
import { one } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError, requireAuth, unauthorized, forbidden, zbody } from "../middleware.js";
import { safeUser, signToken, type UserRow } from "../auth.js";
import { ldapAuthenticate, LdapUnavailableError } from "../services/ldap.js";
import { provisionFromLdap } from "../services/userProvisioning.js";
import { syncDepartmentMembership } from "../services/departmentSync.js";

/* -------- простой in-memory rate limit: 10 попыток входа с IP за 5 минут (fix 3a).
   Счётчик сбрасывается перезапуском процесса — для внутренней сети достаточно. -------- */
const RL_WINDOW_MS = 5 * 60_000;
const RL_MAX_ATTEMPTS = 10;
const attemptsByIp = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  // В тестах логинов много (по фикстуре на каждый it) и все с одного ip —
  // общий бюджет в 10 попыток исчерпался бы к середине прогона.
  if (process.env.NODE_ENV === "test") return false;
  const now = Date.now();
  const recent = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (recent.length >= RL_MAX_ATTEMPTS) {
    attemptsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  attemptsByIp.set(ip, recent);
  return false;
}

/** Локальная проверка пароля. onlyBreakGlass: в ldap-режиме пускаем локально
 *  только config.admin.username (D2/D4) — остальные локальные строки не входят. */
async function localPasswordCheck(username: string, password: string, onlyBreakGlass: boolean): Promise<UserRow | null> {
  if (onlyBreakGlass && username !== loadConfig().admin?.username) return null;
  const row = await one<UserRow>(`SELECT * FROM users WHERE username = $1 AND auth_source = 'local'`, [username]);
  if (!row || !row.password_hash) return null;
  return (await bcrypt.compare(password, row.password_hash)) ? row : null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/login",
    { preValidation: zbody(LoginBody) },
    async (req, reply) => {
      const ip = req.ip;
      if (rateLimited(ip)) {
        await audit(null, "auth.login.rate_limited", "auth", null, { ip });
        throw new ApiHttpError(429, "RATE_LIMITED", "Слишком много попыток входа — подождите 5 минут");
      }

      const { username, password } = req.body as ReturnType<typeof LoginBody.parse>;
      const cfg = loadConfig();
      let row: UserRow | null = null;

      if (cfg.authMode === "ldap") {
        try {
          const principal = await ldapAuthenticate(username, password);
          if (principal) {
            row = await provisionFromLdap(principal);
            await syncDepartmentMembership(row.id, principal.groupDns).catch((e) =>
              req.log.error({ err: e, userId: row!.id }, "ldap: синхронизация департаментов не удалась"),
            );
          } else {
            // неверные LDAP-креды — но, возможно, это break-glass локальный админ
            row = await localPasswordCheck(username, password, true);
          }
        } catch (e) {
          if (e instanceof LdapUnavailableError) {
            req.log.warn({ err: e }, "LDAP недоступен — пробуем break-glass локальный вход");
            await audit(null, "auth.ldap.unavailable", "auth", null, { username });
            row = await localPasswordCheck(username, password, true);
          } else if (e instanceof ApiHttpError && e.statusCode === 409) {
            // login совпал с именем break-glass админа: не раскрываем это
            // отдельным 409 — уходим в обычную локальную проверку (даст 401,
            // либо вход, если это правда break-glass с его паролем).
            row = await localPasswordCheck(username, password, true);
          } else {
            throw e;
          }
        }
      } else {
        row = await localPasswordCheck(username, password, false);
      }

      // Сообщение намеренно не раскрывает, что именно неверно — логин или пароль
      if (!row) {
        // actorId для аудита восстанавливаем по username (если такой юзер есть) —
        // чтобы неудачные попытки можно было джойнить к users.id для мониторинга.
        const known = await one<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username]);
        await audit(known?.id ?? null, "auth.login.denied", "user", known?.id ?? null, { username });
        throw unauthorized("Неверный логин или пароль");
      }

      // Деактивированные аккаунты не входят (миграция 002)
      if (!row.is_active) {
        await audit(row.id, "auth.login.inactive", "user", row.id, {});
        throw forbidden("Аккаунт деактивирован — обратитесь к администратору");
      }

      await audit(row.id, "auth.login", "user", row.id, { via: row.auth_source });
      reply.send({ token: signToken(app, row), user: safeUser(row) });
    },
  );

  app.get(
    "/me",
    { preHandler: requireAuth }, // requireAuth сам подтягивает is_active/роль из БД
    async (req, reply) => {
      const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.user.sub]);
      if (!row) throw unauthorized("Пользователь больше не существует");
      reply.send(safeUser(row));
    },
  );

  /** Режим аутентификации ресурса — клиент по нему показывает/прячет LDAP-поля
   *  и правку глобальной роли в AdminView (LDAP_MIGRATION.md Фаза 4). */
  app.get("/config", { preHandler: requireAuth }, async () => ({ authMode: loadConfig().authMode }));
}
