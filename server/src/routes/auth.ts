/** POST /api/auth/login · GET /api/auth/me */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { LoginBody } from "../contract.js";
import { audit } from "../audit.js";
import { one } from "../db.js";
import { ApiHttpError, requireAuth, unauthorized, forbidden, zbody } from "../middleware.js";
import { safeUser, signToken, type UserRow } from "../auth.js";

/* -------- простой in-memory rate limit: 10 попыток входа с IP за 5 минут (fix 3a).
   Счётчик сбрасывается перезапуском процесса — для внутренней сети достаточно. -------- */
const RL_WINDOW_MS = 5 * 60_000;
const RL_MAX_ATTEMPTS = 10;
const attemptsByIp = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
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
      const row = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [username]);

      // Сообщение намеренно не раскрывает, что именно неверно — логин или пароль
      const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
      if (!row || !ok) {
        await audit(row?.id ?? null, "auth.login.denied", "user", row?.id ?? null, { username });
        throw unauthorized("Неверный логин или пароль");
      }

      // Деактивированные аккаунты не входят (миграция 002)
      if (!row.is_active) {
        await audit(row.id, "auth.login.inactive", "user", row.id, {});
        throw forbidden("Аккаунт деактивирован — обратитесь к администратору");
      }

      await audit(row.id, "auth.login", "user", row.id, {});
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
}
