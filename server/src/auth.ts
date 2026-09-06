/** JWT-подпись и «безопасный» профиль пользователя (без хэша пароля). */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import type { JwtPayload } from "./middleware.js";
import type { AccessRole, GlobalRole } from "./permissions.js";

export interface UserRow {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
  access_role: AccessRole; // admin | manager | employee | viewer (миграция 002) — легаси, дроп в 006
  global_role: GlobalRole; // admin | member (миграция 004) — источник прав с Фазы 2
  is_active: boolean;
  password_hash: string;
}

export interface SafeUser {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
  /** Глобальная роль ресурса (users.global_role) — источник прав с Фазы 2. */
  globalRole: GlobalRole;
  /** Легаси-роль (users.access_role). Для авторизации НЕ используется,
   *  оставлена до Фазы 4 (клиент) / дропа колонки в 006. */
  accessRole: AccessRole;
  isActive: boolean;
}

export function safeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    initials: row.initials,
    color: row.color,
    jobRole: row.job_role,
    globalRole: row.global_role,
    accessRole: row.access_role,
    isActive: row.is_active,
  };
}

export function signToken(app: FastifyInstance, row: UserRow): string {
  // loadConfig() — кэшированный конфиг (fix 3a), env не читается на каждый токен
  const payload: JwtPayload = { sub: row.id, globalRole: row.global_role, name: row.name };
  return app.jwt.sign(payload, { expiresIn: loadConfig().jwtExpires });
}
