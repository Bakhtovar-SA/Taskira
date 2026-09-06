/** JWT-подпись и «безопасный» профиль пользователя (без хэша пароля). */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import type { JwtPayload } from "./middleware.js";
import type { AccessRole } from "./permissions.js";

export interface UserRow {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
  access_role: AccessRole; // admin | manager | employee | viewer (миграция 002)
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
    accessRole: row.access_role,
    isActive: row.is_active,
  };
}

export function signToken(app: FastifyInstance, row: UserRow): string {
  // loadConfig() — кэшированный конфиг (fix 3a), env не читается на каждый токен
  const payload: JwtPayload = { sub: row.id, role: row.access_role, name: row.name };
  return app.jwt.sign(payload, { expiresIn: loadConfig().jwtExpires });
}
