/** Общие проверки /ready и административного статуса; в лог не попадают параметры подключения. */
import { pendingMigrations, q } from "../db.js";
import { loadConfig } from "../config.js";
import { getStorage } from "./storage.js";

export async function checkDatabaseReadiness(): Promise<{ db: boolean; migrations: boolean; pending: string[]; latencyMs: number | null }> {
  const result = { db: false, migrations: false, pending: [] as string[], latencyMs: null as number | null };
  try {
    const started = performance.now();
    await q("SELECT 1");
    result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
    result.db = true;
    result.pending = await pendingMigrations();
    result.migrations = result.pending.length === 0;
  } catch { console.error("[readiness] database check failed"); }
  return result;
}

export async function checkStorageReadiness(): Promise<boolean> {
  try {
    const storage = await getStorage(loadConfig());
    await storage.checkReady();
    return true;
  } catch { console.error("[readiness] storage check failed"); return false; }
}
