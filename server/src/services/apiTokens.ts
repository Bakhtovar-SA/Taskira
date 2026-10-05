/** API credentials: only a hash is stored; positive verification cache lasts 30 seconds. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { one, q } from "../db.js";
import { audit } from "../audit.js";
import { AUTH_CACHE_TTL_MS, boundedSet } from "./authCache.js";

export interface VerifiedToken { tokenId: string; userId: string; scope: "read" | "write" }
interface TokenRow {
  id: string; user_id: string; prefix: string; secret_hash: Buffer; scope: VerifiedToken["scope"];
  expires_at: Date; revoked_at: Date | null;
}
const TTL = AUTH_CACHE_TTL_MS;
const verified = new Map<string, { row: TokenRow; at: number }>();
const uses = new Map<string, number>();
const denials = new Map<string, number>();
const requests = new WeakMap<FastifyRequest, VerifiedToken>();
const deadlines = new WeakMap<VerifiedToken, { expiresAt: number; cacheUntil: number; generation: number }>();
// A revocation also prevents an earlier database lookup from repopulating the cache.
let generation = 0;
const hash = (secret: string) => createHash("sha256").update(secret).digest();
function context(row: TokenRow): VerifiedToken {
  const token = { tokenId: row.id, userId: row.user_id, scope: row.scope };
  deadlines.set(token, { expiresAt: row.expires_at.getTime(), cacheUntil: (verified.get(row.prefix)?.at ?? Date.now()) + TTL, generation });
  return token;
}
export function generateToken(): { token: string; prefix: string; hash: Buffer } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let prefix = "";
  while (prefix.length < 8) for (const byte of randomBytes(8)) {
    if (byte >= 252) continue; // Uniform public identifier across the full 36-character alphabet.
    prefix += alphabet[byte % 36];
    if (prefix.length === 8) break;
  }
  const secret = randomBytes(32).toString("base64url");
  return { token: `tsk_${prefix}_${secret}`, prefix, hash: hash(secret) };
}
export function parseToken(raw: string): { prefix: string; secret: string } | null {
  if (raw.length !== 56) return null;
  const match = /^tsk_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match || Buffer.from(match[2], "base64url").toString("base64url") !== match[2]) return null;
  return { prefix: match[1], secret: match[2] };
}
function cached(prefix: string): TokenRow | undefined {
  const entry = verified.get(prefix);
  if (entry && Date.now() - entry.at < TTL && !entry.row.revoked_at && entry.row.expires_at.getTime() > Date.now()) return entry.row;
  verified.delete(prefix); return undefined;
}
function matches(row: TokenRow, secret: string): boolean {
  const digest = hash(secret);
  return row.secret_hash.length === digest.length && timingSafeEqual(row.secret_hash, digest);
}
/** Synchronous rate-limiter lookup: unknown credentials must keep the IP bucket. */
export function peekVerified(raw: string): VerifiedToken | null {
  const parsed = parseToken(raw); if (!parsed) return null;
  const row = cached(parsed.prefix); return row && matches(row, parsed.secret) ? context(row) : null;
}
export function rememberVerifiedRequest(req: FastifyRequest, token: VerifiedToken): void { requests.set(req, token); }
export function verifiedRequest(req: FastifyRequest): VerifiedToken | undefined {
  const token = requests.get(req), deadline = token && deadlines.get(token), now = Date.now();
  // Parsing/uploading a body can outlast the credential's expiry or a revocation.
  return deadline && deadline.generation === generation && deadline.expiresAt > now && deadline.cacheUntil > now ? token : undefined;
}
export async function verifyToken(raw: string): Promise<VerifiedToken | null> {
  const parsed = parseToken(raw); if (!parsed) return null;
  const started = generation;
  const row = cached(parsed.prefix) ?? await one<TokenRow>(`SELECT id,user_id,prefix,secret_hash,scope,expires_at,revoked_at
    FROM api_tokens WHERE prefix=$1`, [parsed.prefix]);
  if (!row || started !== generation || row.revoked_at || row.expires_at.getTime() <= Date.now() || !matches(row, parsed.secret)) return null;
  if (!verified.has(parsed.prefix)) boundedSet(verified, parsed.prefix, { row, at: Date.now() });
  return context(row);
}
export function invalidateToken(prefix: string): void {
  const row = verified.get(prefix)?.row;
  generation++; verified.delete(prefix);
  if (row) { uses.delete(row.id); denials.delete(row.id); }
}
export function invalidateUserTokens(userId: string): void {
  generation++;
  for (const [prefix, entry] of verified) if (entry.row.user_id === userId) {
    verified.delete(prefix); uses.delete(entry.row.id); denials.delete(entry.row.id);
  }
}
/** Best effort, with both memory and SQL guards; an IP never contains the credential. */
export function recordTokenUse(tokenId: string, ip: string): void {
  const now = Date.now(); if (now - (uses.get(tokenId) ?? 0) < 60_000) return;
  boundedSet(uses, tokenId, now);
  void q(`UPDATE api_tokens SET last_used_at=now(),last_used_ip=$2::inet
    WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()
      AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')`, [tokenId, ip])
    .catch(() => { if (uses.get(tokenId) === now) uses.delete(tokenId); });
}
export async function auditScopeDenial(token: VerifiedToken): Promise<void> {
  const now = Date.now(); if (now - (denials.get(token.tokenId) ?? 0) < 60_000) return;
  boundedSet(denials, token.tokenId, now);
  await audit(token.userId,"token.denied","token",token.tokenId,{ reason: "scope", via: "token", tokenId: token.tokenId },"denied");
}
