/** Service accounts are ordinary project members with no interactive login. */
import type { z } from "zod";
import { audit } from "../audit.js";
import { q, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { invalidateUserCache, revokeUserSessions } from "../middleware.js";
import { invalidateUserTokens } from "./apiTokens.js";
import type { ServiceAccountCreateBody, ServiceAccountPatchBody, ServiceAccountDto } from "../contract.js";

// Mirrors the data palette and login hash used by local-user creation (src/dataColors.ts).
const COLORS = ["#5283e0", "#a468c7", "#c65b93", "#d15c56", "#c66c00", "#2e9e52", "#00a19a", "#0094ce"];
function colorFor(username: string): string {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}
const initials = (name: string) => name.split(/\s+/).slice(0,2)
  .map(word => Array.from(word)[0]?.toUpperCase() ?? "").join("");
interface AccountRow {
  id: string; username: string; name: string; is_active: boolean; created_at: Date;
  projects: ServiceAccountDto["projects"]; active_tokens: number;
}
export async function listServiceAccounts(id?: string): Promise<ServiceAccountDto[]> {
  const rows = await q<AccountRow>(
    `SELECT u.id,u.username,u.name,u.is_active,u.created_at,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',pm.project_id,'role',pm.role) ORDER BY p.key,p.id)
         FROM project_members pm JOIN projects p ON p.id=pm.project_id WHERE pm.user_id=u.id),'[]'::jsonb) AS projects,
       (SELECT count(*)::int FROM api_tokens t WHERE t.user_id=u.id AND t.revoked_at IS NULL AND t.expires_at>now()) AS active_tokens
     FROM users u WHERE u.auth_source='service' AND ($1::uuid IS NULL OR u.id=$1) ORDER BY u.name,u.id`, [id ?? null]);
  return rows.map(row => ({ id: row.id, username: row.username, name: row.name, isActive: row.is_active,
    createdAt: row.created_at.toISOString(), projects: row.projects, activeTokens: row.active_tokens }));
}
export async function createServiceAccount(actorId: string, body: z.infer<typeof ServiceAccountCreateBody>): Promise<ServiceAccountDto> {
  let id: string;
  try {
    id = (await q<{ id: string }>(
      `INSERT INTO users(username,name,initials,color,job_role,auth_source,global_role,password_hash)
       VALUES($1,$2,$3,$4,'Сервисная учётная запись','service','member',NULL) RETURNING id`,
      [body.username,body.name,initials(body.name),colorFor(body.username)]))[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiHttpError(409, "CONFLICT", "Имя пользователя уже занято");
    throw error;
  }
  await audit(actorId,"service_account.create","user",id,{ username: body.username, name: body.name });
  return (await listServiceAccounts(id))[0];
}
export async function patchServiceAccount(id: string, actorId: string, body: z.infer<typeof ServiceAccountPatchBody>): Promise<ServiceAccountDto> {
  const result = await withTransaction(async client => {
    const old = (await client.query<{ id: string; name: string; is_active: boolean }>(
      "SELECT id,name,is_active FROM users WHERE id=$1 AND auth_source='service' FOR UPDATE", [id])).rows[0];
    if (!old) throw new ApiHttpError(404,"NOT_FOUND","Сервисная запись не найдена");
    await client.query(
      `UPDATE users SET name=COALESCE($2,name),initials=COALESCE($3,initials),is_active=COALESCE($4,is_active),
       session_version=session_version+CASE WHEN is_active IS DISTINCT FROM COALESCE($4,is_active) THEN 1 ELSE 0 END WHERE id=$1`,
      [old.id,body.name ?? null,body.name === undefined ? null : initials(body.name),body.isActive ?? null]);
    return { id: old.id, changedActivity: body.isActive !== undefined && body.isActive !== old.is_active };
  });
  // PostgreSQL accepts uppercase UUID paths; authentication caches use its canonical lowercase id.
  if (body.isActive === false) invalidateUserTokens(result.id);
  if (result.changedActivity) revokeUserSessions(result.id,"service account activity changed");
  else invalidateUserCache(result.id);
  await audit(actorId,"service_account.update","user",result.id,{ ...body });
  return (await listServiceAccounts(result.id))[0];
}
