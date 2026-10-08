/** Общие проверки /ready и административного статуса; в лог не попадают параметры подключения. */
import { pendingMigrations, q } from "../db.js";
import { loadConfig } from "../config.js";
import { getStorage } from "./storage.js";
import type { FastifyBaseLogger } from "fastify";

function logFailure(check: "database" | "storage", error: unknown, logger?: Pick<FastifyBaseLogger, "warn">): void {
  const err = error as { code?: unknown; name?: unknown } | null;
  const knownCodes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENOENT", "EACCES", "ENOSPC", "XX000"];
  const code = typeof err?.code === "string" && (knownCodes.includes(err.code) || /^[0-9]{2}[A-Z0-9]{3}$/.test(err.code)) ? err.code : "unknown";
  const name = typeof err?.name === "string" && ["Error", "TypeError", "RangeError", "AggregateError"].includes(err.name) ? err.name : "Error";
  const facts = { check, code, name };
  const message = `readiness ${check} check failed`;
  if (logger) logger.warn(facts, message);
  else console.error(message, facts);
}

export async function checkDatabaseReadiness(logger?: Pick<FastifyBaseLogger, "warn">): Promise<{ db: boolean; migrations: boolean; pending: string[]; latencyMs: number | null }> {
  const result = { db: false, migrations: false, pending: [] as string[], latencyMs: null as number | null };
  try {
    const started = performance.now();
    await q("SELECT 1");
    result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
    result.db = true;
    result.pending = await pendingMigrations();
    result.migrations = result.pending.length === 0;
  } catch (error) { logFailure("database", error, logger); }
  return result;
}

export async function checkStorageReadiness(logger?: Pick<FastifyBaseLogger, "warn">): Promise<boolean> {
  try {
    const storage = await getStorage(loadConfig());
    await storage.checkReady();
    return true;
  } catch (error) { logFailure("storage", error, logger); return false; }
}
