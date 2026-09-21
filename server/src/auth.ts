/** JWT-подпись и «безопасный» профиль пользователя (без хэша пароля). */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import type { JwtPayload } from "./middleware.js";
import type { GlobalRole } from "./permissions.js";
import type { NotifyPrefs, SafeUser } from "./contract.js";
export type { SafeUser };

export interface UserRow {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
  phone: string; // миграция 026 — синкается из AD (telephoneNumber) для LDAP-пользователей
  global_role: GlobalRole; // admin | member (миграция 004) — источник прав
  is_active: boolean;
  password_hash: string | null; // NULL у LDAP-пользователей (миграция 009)
  auth_source: "local" | "ldap"; // миграция 009
  ldap_dn: string | null;
  email: string | null;
  notify_prefs: NotifyPrefs | null; // миграция 011 (jsonb; node-postgres отдаёт объектом)
  avatar_driver: "local" | "s3" | null; // миграция 027
  avatar_key: string | null;
  avatar_content_type: string | null;
  avatar_updated_at: Date | null;
  session_version: string | number; // bigint, миграция 029
  failed_login_attempts: number;
  locked_until: Date | null;
}

export function safeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    initials: row.initials,
    color: row.color,
    jobRole: row.job_role,
    phone: row.phone,
    globalRole: row.global_role,
    isActive: row.is_active,
    authSource: row.auth_source,
    avatarUpdatedAt: row.avatar_updated_at ? row.avatar_updated_at.getTime() : null,
  };
}

export function signToken(app: FastifyInstance, row: UserRow): string {
  // loadConfig() — кэшированный конфиг (fix 3a), env не читается на каждый токен
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: row.id,
    globalRole: row.global_role,
    name: row.name,
    sessionVersion: Number(row.session_version),
    origIat: nowSeconds,
  };
  return app.jwt.sign(payload, { expiresIn: loadConfig().sessionTtlSeconds });
}
