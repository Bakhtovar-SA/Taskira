import type { FastifyRequest } from "fastify";
import { loadConfig } from "./config.js";

export const SESSION_COOKIE = "taskira_session";

function secureAttribute(): string {
  const enabled = loadConfig().sessionCookieSecure;
  return enabled ? "; Secure" : "";
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function requestToken(req: Pick<FastifyRequest, "headers">): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return cookieValue(req.headers.cookie, SESSION_COOKIE);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${loadConfig().sessionTtlSeconds}${secureAttribute()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute()}`;
}
