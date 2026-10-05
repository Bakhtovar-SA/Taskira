/** Session-only issuance and revocation; limits are serialized on the owner row. */
import type { z } from "zod";
import { audit } from "../audit.js";
import { one, q, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { ApiTokenCreateBody, LIMITS, type ApiTokenDto, type ApiTokenCreatedDto, type ApiTokenAdminDto } from "../contract.js";
import { generateToken, invalidateToken } from "./apiTokens.js";

interface TokenRow {
  id: string; user_id: string; name: string; prefix: string; scope: "read" | "write";
  created_at: Date; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null;
}
const columns = "id, user_id, name, prefix, scope, created_at, expires_at, last_used_at, revoked_at";
export function tokenDto(row: TokenRow): ApiTokenDto {
  return { id: row.id, name: row.name, prefix: row.prefix, scope: row.scope,
    createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null, revokedAt: row.revoked_at?.toISOString() ?? null };
}
const missing = () => new ApiHttpError(404, "NOT_FOUND", "Токен не найден");
const details = (row: TokenRow) => ({ tokenId: row.id, prefix: row.prefix, scope: row.scope, ownerId: row.user_id });

export async function assertServiceAccount(id: string): Promise<void> {
  if (!await one("SELECT id FROM users WHERE id=$1 AND auth_source='service'", [id]))
    throw new ApiHttpError(404, "NOT_FOUND", "Сервисная запись не найдена");
}
export async function listTokens(ownerId: string): Promise<ApiTokenDto[]> {
  return (await q<TokenRow>(`SELECT ${columns} FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [ownerId])).map(tokenDto);
}
export async function createApiToken(ownerId: string, actorId: string, service: boolean,
  body: z.infer<typeof ApiTokenCreateBody>): Promise<ApiTokenCreatedDto> {
  const result = await withTransaction(async client => {
    const owner = (await client.query<{ auth_source: string; is_active: boolean }>(
      "SELECT auth_source,is_active FROM users WHERE id=$1 FOR UPDATE", [ownerId])).rows[0];
    if (!owner || service !== (owner.auth_source === "service"))
      throw new ApiHttpError(service ? 404 : 403, service ? "NOT_FOUND" : "TOKEN_NOT_ALLOWED",
        service ? "Сервисная запись не найдена" : "Сервисная запись не может выпускать персональные токены");
    if (!owner.is_active) throw new ApiHttpError(409, "CONFLICT", "Пользователь деактивирован");
    const count = (await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM api_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()", [ownerId])).rows[0].n;
    if (count >= (service ? LIMITS.apiToken.perService : LIMITS.apiToken.perUser))
      throw new ApiHttpError(409, "TOKEN_LIMIT", "Достигнут лимит активных токенов");
    // A rare prefix collision retries without aborting the transaction or exposing a credential.
    for (let attempt = 0; attempt < 5; attempt++) {
      const generated = generateToken();
      const row = (await client.query<TokenRow>(
        `INSERT INTO api_tokens(user_id,name,prefix,secret_hash,scope,created_by,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,now()+($7::int*interval '1 day'))
         ON CONFLICT(prefix) DO NOTHING RETURNING ${columns}`,
        [ownerId,body.name,generated.prefix,generated.hash,body.scope,actorId,body.expiresInDays])).rows[0];
      if (row) return { row, secret: generated.token };
    }
    throw new Error("Could not allocate an API token prefix");
  });
  await audit(actorId, "token.create", "apiToken", result.row.id, details(result.row));
  return { token: tokenDto(result.row), secret: result.secret };
}
export async function revokeApiToken(id: string, actorId: string, ownerId?: string, service = false): Promise<void> {
  const result = await withTransaction(async client => {
    // Owner/source restrictions are part of the lookup: /me never reveals someone else's token.
    const row = (await client.query<TokenRow>(
      `SELECT ${columns.split(", ").map(column => "t."+column).join(",")}
       FROM api_tokens t JOIN users u ON u.id=t.user_id
       WHERE t.id=$1 AND ($2::uuid IS NULL OR t.user_id=$2) AND (NOT $3::boolean OR u.auth_source='service')
       FOR UPDATE OF t`, [id,ownerId ?? null,service])).rows[0];
    if (!row) throw missing();
    if (row.revoked_at) return { row, changed: false };
    await client.query("UPDATE api_tokens SET revoked_at=now(),revoked_by=$2 WHERE id=$1", [row.id,actorId]);
    return { row, changed: true };
  });
  invalidateToken(result.row.prefix);
  if (result.changed) await audit(actorId, "token.revoke", "apiToken", result.row.id, details(result.row));
}
export async function listAdminTokens(filters: { userId?: string; active?: "1" }): Promise<ApiTokenAdminDto[]> {
  const rows = await q<TokenRow & { owner_name: string; owner_username: string; owner_source: "local" | "ldap" | "service" }>(
    `SELECT ${columns.split(", ").map(column => "t."+column).join(",")},
       u.name AS owner_name,u.username AS owner_username,u.auth_source AS owner_source
     FROM api_tokens t JOIN users u ON u.id=t.user_id
     WHERE ($1::uuid IS NULL OR t.user_id=$1)
       AND (NOT $2::boolean OR (t.revoked_at IS NULL AND t.expires_at>now()))
     ORDER BY t.created_at DESC,t.id DESC`, [filters.userId ?? null,filters.active === "1"]);
  return rows.map(row => ({ ...tokenDto(row), owner: { id: row.user_id, name: row.owner_name,
    username: row.owner_username, authSource: row.owner_source } }));
}
