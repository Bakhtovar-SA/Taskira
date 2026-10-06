/** SEC-PWD-01 (ADR-0034): смена своего пароля и административный сброс — только для локальных учёток.
 *   POST /api/me/password                      — сессия (не API-токен): текущий + новый пароль;
 *   POST /api/admin/users/:id/password-reset   — глобальный админ: одноразовый временный пароль.
 *  LDAP-учётки (и сервисные записи) получают 409 PASSWORD_NOT_LOCAL: их пароль живёт в каталоге. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { auditFromRequest } from "../audit.js";
import { safeUser, signToken, type UserRow } from "../auth.js";
import { loadConfig } from "../config.js";
import { ChangePasswordBody, UserIdParams, type LoginResultDto, type PasswordResetResultDto } from "../contract.js";
import { ApiHttpError, notFound, requireGlobalAdmin, requireSession, revokeUserSessions, unauthorized, zbody, zparams } from "../middleware.js";
import { hashPassword, verifyPassword } from "../services/passwordHash.js";
import { assertPasswordAllowed, generateTemporaryPassword, passwordRouteLimit, recordPasswordFailure } from "../services/passwords.js";
import { sessionCookie } from "../sessionCookie.js";

const notLocal = () =>
  new ApiHttpError(409, "PASSWORD_NOT_LOCAL", "Пароль этой учётной записи управляется в каталоге (LDAP) — сменить его в Taskira нельзя");

export async function passwordRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/me/password",
    { ...passwordRouteLimit, preHandler: requireSession, preValidation: zbody(ChangePasswordBody) },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body as z.infer<typeof ChangePasswordBody>;
      const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.user.sub]);
      if (!row) throw unauthorized("Пользователь больше не существует");
      if (row.auth_source !== "local" || !row.password_hash) throw notLocal();

      // Блокировка — та же, что у входа: пока она действует, текущий пароль даже не проверяем.
      if (row.locked_until && row.locked_until.getTime() > Date.now()) {
        await auditFromRequest(req, "auth.password.change", "user", row.id, { reason: "locked" }, "denied");
        throw new ApiHttpError(429, "ACCOUNT_LOCKED", "Слишком много неверных паролей — учётная запись временно заблокирована, попробуйте позже");
      }
      // Как у входа: истёкшая блокировка начинает новое окно ошибок, иначе одна опечатка блокировала бы снова.
      if (row.locked_until) await q(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [row.id]);

      const check = await verifyPassword(currentPassword, row.password_hash);
      if (!check.ok) {
        const locked = await recordPasswordFailure(row.id);
        await auditFromRequest(req, "auth.password.change", "user", row.id, { reason: "wrong_current", locked }, "denied");
        // 403, а не 401: 401 клиент понимает как «сессия кончилась» и выкидывает на форму входа.
        throw new ApiHttpError(403, "CURRENT_PASSWORD_INVALID", "Текущий пароль указан неверно");
      }
      if (row.must_change_password && row.password_expires_at && row.password_expires_at.getTime() <= Date.now()) {
        await auditFromRequest(req, "auth.password.change", "user", row.id, { reason: "temporary_expired" }, "denied");
        throw new ApiHttpError(403, "TEMP_PASSWORD_EXPIRED", "Срок временного пароля истёк — попросите администратора выдать новый");
      }
      if (newPassword === currentPassword)
        throw new ApiHttpError(400, "PASSWORD_REUSED", "Новый пароль должен отличаться от текущего");
      await assertPasswordAllowed(newPassword, row);

      const hash = await hashPassword(newPassword);
      // password_hash = прежний: параллельная смена/сброс между SELECT и UPDATE не затирается молча.
      const updated = await one<UserRow>(
        `UPDATE users
            SET password_hash = $2, session_version = session_version + 1,
                must_change_password = false, password_expires_at = NULL, password_changed_at = now(),
                failed_login_attempts = 0, locked_until = NULL
          WHERE id = $1 AND password_hash = $3
          RETURNING *`,
        [row.id, hash, row.password_hash],
      );
      if (!updated) throw new ApiHttpError(409, "CONFLICT", "Пароль только что изменился — обновите страницу и повторите");

      // Все прежние сессии (другие вкладки и устройства, украденный cookie) отозваны новой session_version
      // (ASVS V7.4.3); текущей выдаём новый токен — как при входе, с новым началом абсолютного срока.
      revokeUserSessions(row.id, "password changed");
      await auditFromRequest(req, "auth.password.change", "user", row.id, { forced: row.must_change_password });
      const token = signToken(app, updated);
      reply.removeHeader("set-cookie"); // ротация в authenticate() могла поставить cookie со старой версией сессии
      reply.header("Cache-Control", "no-store").header("Set-Cookie", sessionCookie(token));
      const result: LoginResultDto = { token, user: safeUser(updated), mustChangePassword: false };
      return reply.send(result);
    },
  );

  app.post(
    "/admin/users/:id/password-reset",
    { ...passwordRouteLimit, preHandler: requireGlobalAdmin, preValidation: zparams(UserIdParams) },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof UserIdParams>;
      if (id === req.user.sub)
        throw new ApiHttpError(409, "PASSWORD_RESET_SELF", "Свой пароль меняйте в личных настройках — там нужен текущий пароль");
      const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
      if (!row) throw notFound("Пользователь не найден");
      if (row.auth_source !== "local") throw notLocal();

      const temporaryPassword = await generateTemporaryPassword(row);
      const hash = await hashPassword(temporaryPassword);
      const updated = await one<{ password_expires_at: Date }>(
        `UPDATE users
            SET password_hash = $2, must_change_password = true,
                password_expires_at = now() + ($3 * interval '1 hour'),
                session_version = session_version + 1, failed_login_attempts = 0, locked_until = NULL
          WHERE id = $1 AND auth_source = 'local'
          RETURNING password_expires_at`,
        [id, hash, loadConfig().passwords.resetTtlHours],
      );
      if (!updated) throw notLocal();
      // Сброс — реальный отзыв: старый пароль мог быть скомпрометирован, все сессии пользователя закрываются.
      revokeUserSessions(id, "password reset by admin");
      const expiresAt = updated.password_expires_at.toISOString();
      // В журнал — только факт и срок, никакого материала пароля.
      await auditFromRequest(req, "user.password.reset", "user", id, { username: row.username, expiresAt });
      const result: PasswordResetResultDto = { temporaryPassword, expiresAt };
      return reply.header("Cache-Control", "no-store").send(result);
    },
  );
}
