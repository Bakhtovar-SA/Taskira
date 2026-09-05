/** JWT-подпись и «безопасный» профиль пользователя (без хэша пароля). */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import type { JwtPayload } from "./middleware.js";

export interface UserRow {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
  access_role: "admin" | "manager" | "developer" | "viewer";
  password_hash: string;
}

export type SafeUser = Omit<UserRow, "password_hash"> & { accessRole: UserRow["access_role"]; jobRole: UserRow["job_role"] };

export function safeUser(row: UserRow): SafeUser {
  const { password_hash: _omit, access_role, job_role, ...rest } = row;
  return { ...rest, accessRole: access_role, jobRole: job_role };
}

export function signToken(app: FastifyInstance, row: UserRow): string {
  const payload: JwtPayload = { sub: row.id, role: row.access_role, name: row.name };
  return app.jwt.sign(payload, { expiresIn: loadConfig().jwtExpires });
}
