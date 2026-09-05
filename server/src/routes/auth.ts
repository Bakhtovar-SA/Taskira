/** POST /api/auth/login · GET /api/auth/me */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { LoginBody } from "../contract.js";
import { audit } from "../audit.js";
import { one } from "../db.js";
import { requireAuth, unauthorized, zbody } from "../middleware.js";
import { safeUser, signToken, type UserRow } from "../auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/login",
    { preValidation: zbody(LoginBody) },
    async (req, reply) => {
      const { username, password } = req.body as ReturnType<typeof LoginBody.parse>;
      const row = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [username]);

      // Сообщение намеренно не раскрывает, что именно неверно — логин или пароль
      const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
      if (!row || !ok) {
        await audit(row?.id ?? null, "auth.login.denied", "user", row?.id ?? null, { username });
        throw unauthorized("Неверный логин или пароль");
      }

      await audit(row.id, "auth.login", "user", row.id, {});
      reply.send({ token: signToken(app, row), user: safeUser(row) });
    },
  );

  app.get(
    "/me",
    { preHandler: requireAuth },
    async (req, reply) => {
      const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.user.sub]);
      if (!row) throw unauthorized("Пользователь больше не существует");
      reply.send(safeUser(row));
    },
  );
}
