/** Управление пользователями (manageAccess = только глобальный admin):
 *  список, создание, смена ГЛОБАЛЬНОЙ роли (global_role) / активности.
 *  Проектная роль (project_members) назначается отдельно — см. routes/project.ts. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { q, withTransaction } from "../db.js";
import { hashPassword } from "../services/passwordHash.js";
import { assertPasswordAllowed } from "../services/passwords.js";
import { loadConfig } from "../config.js";
import { forbidden, invalidateUserCache, notFound, requireAuth, requireGlobalAdmin, revokeUserSessions, zbody, zquery, type JwtPayload } from "../middleware.js";
import { invalidateUserTokens } from "../services/apiTokens.js";
import { conflict } from "../services/workflow.js";
import { auditFromRequest } from "../audit.js";
import { safeUser, type UserRow } from "../auth.js";
import type { PickableUserDto } from "../contract.js";
import { ChangeRoleBody, CreateUserBody, PickableUsersQuery } from "../contract.js";

/** Пикер сотрудников: минимум символов для поиска и потолок выдачи. */
const PICKABLE_MIN_QUERY = 2;
const PICKABLE_LIMIT = 20;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Все пользователи, включая деактивированных (админ-панель). */
  app.get("/users", { preHandler: requireGlobalAdmin }, async () => {
    const rows = await q<UserRow>(`SELECT * FROM users ORDER BY name`);
    return rows.map(safeUser);
  });

  /** Тонкий справочник для пикеров (подключение к задаче и т.п.) — любой
   *  аутентифицированный, только активные, без globalRole/username
   *  (COLLAB_MIGRATION.md D7). */
  app.get("/users/pickable", { preHandler: requireAuth, preValidation: zquery(PickableUsersQuery) }, async (req): Promise<PickableUserDto[]> => {
    // Поиск, а не выгрузка всего справочника (аудит SEC-04): раньше любой
    // залогиненный одним запросом получал всю оргструктуру — на 1000 сотрудников
    // это и утечка данных, и мегабайт трафика на каждое открытие пикера.
    const { q: search, includeService } = req.query as z.infer<typeof PickableUsersQuery>;
    if (includeService && req.user.globalRole !== "admin") throw forbidden("Сервисные записи доступны только администратору");
    const term = typeof search === "string" ? search.trim() : "";
    if (term.length < PICKABLE_MIN_QUERY) return [];
    const esc = term.replace(/[%_\\]/g, "\\$&");
    const rows = await q<{ id: string; name: string; initials: string; color: string; job_role: string; auth_source: PickableUserDto["authSource"] }>(
      `SELECT id, name, initials, color, job_role, auth_source
         FROM users
        WHERE is_active AND ($3::boolean OR auth_source <> 'service') AND (name ILIKE $1 OR job_role ILIKE $1)
        ORDER BY name
        LIMIT $2`,
      [`%${esc}%`, PICKABLE_LIMIT, includeService === "1"],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, initials: r.initials, color: r.color, jobRole: r.job_role, authSource: r.auth_source }));
  });

  app.post(
    "/admin/users",
    { preHandler: requireGlobalAdmin, preValidation: zbody(CreateUserBody) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const body = req.body as z.infer<typeof CreateUserBody>;

      if (loadConfig().authMode === "ldap")
        throw conflict("В режиме LDAP пользователи заводятся автоматически при первом входе");

      // Статические правила политики проверил zod (CreateUserBody); здесь — контекстные слова организации из БД.
      await assertPasswordAllowed(body.password, { username: body.username, name: body.name });
      const hash = await hashPassword(body.password);
      let row: UserRow;
      try {
        row = (
          await q<UserRow>(
            `INSERT INTO users (username, password_hash, name, initials, color, job_role, phone, global_role, is_active, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [body.username, hash, body.name, body.initials, body.color, body.jobRole, body.phone ?? "", body.globalRole, body.isActive ?? true, body.mustChangePassword ?? false],
          )
        )[0];
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Имя пользователя уже занято");
        throw e;
      }

      await auditFromRequest(req, "user.create", "user", row.id, { username: row.username, globalRole: row.global_role, mustChangePassword: row.must_change_password });
      reply.code(201).send(safeUser(row));
    },
  );

  app.patch(
    "/users/:id",
    { preHandler: requireGlobalAdmin, preValidation: zbody(ChangeRoleBody) },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof ChangeRoleBody>;
      const { user, row } = await withTransaction(async (client) => {
        // Serialize changes to the SET of active admins, not just one user's row.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('taskira:active-admins'))`);
        const user = (await client.query<UserRow>(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!user) throw notFound("Пользователь не найден");
        if (user.auth_source === "service" && body.globalRole !== "member")
          throw conflict("Сервисная запись может иметь только роль участника");

        // В режиме LDAP глобальная роль LDAP-пользователя приходит из группы
        // (LDAP_ADMIN_GROUP_DN) и пересчитывается на каждом входе — ручная смена
        // была бы затёрта. is_active менять можно (деактивация переживает вход).
        if (
          loadConfig().authMode === "ldap" &&
          user.auth_source === "ldap" &&
          body.globalRole !== user.global_role
        ) {
          throw conflict("Роль LDAP-пользователя управляется группой в директории (LDAP_ADMIN_GROUP_DN)");
        }

        // Проверка выполняется после общего лока, на свежем READ COMMITTED snapshot.
        // Апдейт разрешён, если он НЕ снимает статус последнего активного админа:
        //   - строка сейчас не активный админ, ИЛИ
        //   - после апдейта остаётся активным админом
        //     ($1='admin' и isActive не выставлен в false), ИЛИ
        //   - есть другой активный админ.
        const { rows } = await client.query<UserRow>(
          `UPDATE users
              SET session_version = session_version + CASE
                    WHEN global_role IS DISTINCT FROM $1 OR is_active IS DISTINCT FROM COALESCE($2, is_active) THEN 1
                    ELSE 0
                  END,
                  global_role = $1, is_active = COALESCE($2, is_active)
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
        return { user, row };
      });

      // Смена действует немедленно: кэш роли в requireAuth инвалидируется.
      // WS-сессии рвём, только если реально что-то отозвали (деактивация или
      // смена роли) — иначе admin, пересохранивший форму без изменений,
      // без причины отключал бы чужую живую вкладку с уведомлениями (Этап 3c).
      if (row.global_role !== user.global_role || row.is_active !== user.is_active) {
        if (!row.is_active) invalidateUserTokens(user.id);
        revokeUserSessions(user.id, "role or activity changed");
      } else {
        invalidateUserCache(user.id);
      }
      await auditFromRequest(req, "user.role.change", "user", user.id, {
        username: user.username,
        from: user.global_role,
        to: row.global_role,
        isActive: row.is_active,
      });
      return safeUser(row);
    },
  );
}
