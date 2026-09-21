/** POST /api/auth/login · GET /api/auth/me
 *  Режим входа: config.authMode (LDAP_MIGRATION.md D2).
 *   - local: только локальный пароль (как раньше);
 *   - ldap:  LDAP/AD; при недоступности LDAP или для локальной учётки —
 *            break-glass вход по паролю ТОЛЬКО для config.admin.username. */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { LoginBody } from "../contract.js";
import { audit } from "../audit.js";
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError, requireAuth, revokeUserSessions, unauthorized, forbidden, zbody } from "../middleware.js";
import { safeUser, signToken, type UserRow } from "../auth.js";
import { loginRateLimited } from "../services/loginRateLimit.js";
import { ldapAuthenticate, LdapUnavailableError } from "../services/ldap.js";
import { provisionFromLdap } from "../services/userProvisioning.js";
import { syncDepartmentMembership } from "../services/departmentSync.js";
import { listFavoriteProjectIds } from "../services/favorites.js";
import { clearSessionCookie, sessionCookie } from "../sessionCookie.js";

/* -------- лимит попыток входа по IP (10 за 5 минут по умолчанию): состояние в БД, services/loginRateLimit.ts.
   Раньше — Map в памяти процесса; при втором экземпляре лимит умножался на число процессов. Блокировка по
   аккаунту (failed_login_attempts / locked_until) — ниже, тоже в БД. -------- */
async function rateLimited(ip: string): Promise<boolean> {
  // Флаг берётся из конфига, а не из NODE_ENV: раньше боевой код сам проверял
  // окружение, и кривой NODE_ENV отключал защиту в проде (аудит DEBT-03).
  const rl = loadConfig().rateLimit;
  if (!rl.enabled) return false;
  return loginRateLimited(ip, rl.loginMax, rl.loginWindowMs);
}

type LoginAccount = { id: string; auth_source: "local" | "ldap"; locked_until: Date | null };

async function loginAccount(username: string): Promise<LoginAccount | null> {
  return one<LoginAccount>(`SELECT id, auth_source, locked_until FROM users WHERE username = $1`, [username]);
}

async function recordLoginFailure(username: string): Promise<LoginAccount | null> {
  const rl = loadConfig().rateLimit;
  return one<LoginAccount>(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2
                THEN now() + ($3 * interval '1 second')
              ELSE locked_until
            END
      WHERE username = $1 AND auth_source = 'local'
      RETURNING id, auth_source, locked_until`,
    [username, rl.accountMaxFailures, rl.accountLockSeconds],
  );
}

async function clearLoginFailures(userId: string): Promise<void> {
  await q(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [userId]);
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
      if (await rateLimited(ip)) {
        await audit(null, "auth.login.rate_limited", "auth", null, { ip }, "denied");
        throw new ApiHttpError(429, "RATE_LIMITED", "Слишком много попыток входа — подождите несколько минут");
      }

      const { username, password } = req.body as ReturnType<typeof LoginBody.parse>;
      const cfg = loadConfig();
      let row: UserRow | null = null;
      const account = await loginAccount(username);
      if (account?.auth_source === "local" && account.locked_until && account.locked_until.getTime() > Date.now()) {
        await audit(account.id, "auth.login.locked", "user", account.id, { ip }, "denied");
        throw unauthorized("Неверный логин или пароль");
      }
      // После естественного истечения блокировки начинается новое окно ошибок.
      // Иначе один опечатанный пароль немедленно блокировал бы аккаунт снова.
      if (account?.auth_source === "local" && account.locked_until) {
        await clearLoginFailures(account.id);
      }

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
            await audit(null, "auth.ldap.unavailable", "auth", null, { username }, "error");
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
        const known = await recordLoginFailure(username);
        await audit(known?.id ?? null, "auth.login.denied", "user", known?.id ?? null, { username, ip }, "denied");
        throw unauthorized("Неверный логин или пароль");
      }

      // Деактивированные аккаунты не входят (миграция 002)
      if (!row.is_active) {
        await audit(row.id, "auth.login.inactive", "user", row.id, { ip }, "denied");
        throw forbidden("Аккаунт деактивирован — обратитесь к администратору");
      }

      await clearLoginFailures(row.id);
      await audit(row.id, "auth.login", "user", row.id, { via: row.auth_source });
      const token = signToken(app, row);
      reply.header("Set-Cookie", sessionCookie(token));
      // token остаётся в JSON для CLI/старых клиентов; браузер Taskira его не
      // сохраняет и работает только с недоступной JavaScript HttpOnly-cookie.
      reply.send({ token, user: safeUser(row) });
    },
  );

  app.get(
    "/me",
    { preHandler: requireAuth }, // requireAuth сам подтягивает is_active/роль из БД
    async (req, reply) => {
      const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.user.sub]);
      if (!row) throw unauthorized("Пользователь больше не существует");
      // notifyPrefs/favoriteProjectIds — только для себя, не в общем safeUser
      // (не светим чужие настройки). Список избранного — project-less, как и
      // сам /me, поэтому переключатель проектов может показать звёзды сразу
      // при входе, ещё до захода в конкретный проект (главный экран/home).
      const favoriteProjectIds = await listFavoriteProjectIds(row.id);
      reply.send({ ...safeUser(row), notifyPrefs: row.notify_prefs ?? {}, favoriteProjectIds });
    },
  );

  /** Выход: помечаем все ранее выданные токены недействительными.
   *  Без этого «Выйти» стирало токен только в браузере, а сам JWT оставался
   *  рабочим ещё до 12 часов (аудит SEC-01). */
  app.post("/logout", { preHandler: requireAuth }, async (req, reply) => {
    await q(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [req.user.sub]);
    revokeUserSessions(req.user.sub, "logout"); // иначе отзыв ждал бы до 30 секунд, а WS — до закрытия вкладки
    await audit(req.user.sub, "auth.logout", "user", req.user.sub, {});
    reply.header("Set-Cookie", clearSessionCookie());
    reply.code(204).send();
  });

  /** Режим аутентификации ресурса — клиент по нему показывает/прячет LDAP-поля
   *  и правку глобальной роли в AdminView (LDAP_MIGRATION.md Фаза 4). */
  app.get("/config", { preHandler: requireAuth }, async () => ({ authMode: loadConfig().authMode }));
}
