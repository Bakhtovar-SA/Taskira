/** Управление пользователями (manageAccess = только глобальный admin):
 *  список, создание, смена ГЛОБАЛЬНОЙ роли (global_role) / активности.
 *  Проектная роль (project_members) назначается отдельно — см. routes/project.ts. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import bcrypt from "bcryptjs";
import { one, q } from "../db.js";
import { invalidateUserCache, notFound, requirePerm, zbody, type JwtPayload } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { audit } from "../audit.js";
import { safeUser, type UserRow } from "../auth.js";
import { ChangeRoleBody, CreateUserBody } from "../contract.js";

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Все пользователи, включая деактивированных (админ-панель). */
  app.get("/users", { preHandler: requirePerm("manageAccess") }, async () => {
    const rows = await q<UserRow>(`SELECT * FROM users ORDER BY name`);
    return rows.map(safeUser);
  });

  app.post(
    "/admin/users",
    { preHandler: requirePerm("manageAccess"), preValidation: zbody(CreateUserBody) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const body = req.body as z.infer<typeof CreateUserBody>;

      const hash = await bcrypt.hash(body.password, 10);
      let row: UserRow;
      try {
        row = (
          await q<UserRow>(
            `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [body.username, hash, body.name, body.initials, body.color, body.jobRole, body.globalRole, body.isActive ?? true],
          )
        )[0];
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Имя пользователя уже занято");
        throw e;
      }

      await audit(actor.sub, "user.create", "user", row.id, { username: row.username, globalRole: row.global_role });
      reply.code(201).send(safeUser(row));
    },
  );

  app.patch(
    "/users/:id",
    { preHandler: requirePerm("manageAccess"), preValidation: zbody(ChangeRoleBody) },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof ChangeRoleBody>;

      const user = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
      if (!user) throw notFound("Пользователь не найден");

      // Гард «последний активный админ» встроен в WHERE — проверка и запись в
      // одном стейтменте (без отдельного SELECT count → нет TOCTOU-окна).
      // Апдейт разрешён, если он НЕ снимает статус последнего активного админа:
      //   - строка сейчас не активный админ, ИЛИ
      //   - после апдейта остаётся активным админом
      //     ($1='admin' и isActive не выставлен в false), ИЛИ
      //   - есть другой активный админ.
      const rows = await q<UserRow>(
        `UPDATE users
            SET global_role = $1, is_active = COALESCE($2, is_active)
          WHERE id = $3
            AND (
              global_role <> 'admin' OR NOT is_active
              OR ($1 = 'admin' AND $2 IS DISTINCT FROM false)
              OR EXISTS (
                   SELECT 1 FROM users a
                    WHERE a.global_role = 'admin' AND a.is_active AND a.id <> $3
                 )
            )
          RETURNING *`,
        [body.globalRole, body.isActive ?? null, user.id],
      );
      // Пользователь точно существует (SELECT выше) → 0 строк = сработал гард.
      if (rows.length === 0)
        throw conflict("Нельзя понизить или деактивировать последнего активного администратора");
      const row = rows[0];

      // Смена действует немедленно: кэш роли в requireAuth инвалидируется
      invalidateUserCache(user.id);
      await audit(actor.sub, "user.role.change", "user", user.id, {
        username: user.username,
        from: user.global_role,
        to: row.global_role,
        isActive: row.is_active,
      });
      return safeUser(row);
    },
  );
}
