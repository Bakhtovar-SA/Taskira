/** Один снимок состояния инсталляции. Проверки независимы; факты и журналы не содержат секретов. */
import { statfs } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { q } from "../db.js";
import type { SystemCheck, SystemStatusDto } from "../contract.js";
import { createTtlCache } from "./ttlCache.js";
import { checkDatabaseReadiness, checkStorageReadiness } from "./readiness.js";
import { searchIndexStatus } from "./healthWarnings.js";
import { getMaintenanceStatus } from "./maintenance.js";
import { getLicenseStatus } from "./license.js";
import { emptyOpsFacts, getOpsSnapshot, opsState } from "./opsStatus.js";

type Id = SystemCheck["id"];
type Check<K extends Id> = Extract<SystemCheck, { id: K }>;
const ids = ["database", "storage", "mail", "ldap", "jobs", "license", "search", "backup", "restoreDrill", "webhooks", "recurring"] as const;
const cache = createTtlCache<SystemStatusDto>(15_000);
const age = (at: string): number => Math.max(0, Date.now() - Date.parse(at));

function unknownCheck(id: Id): SystemCheck {
  const cfg = loadConfig();
  switch (id) {
    case "database": return { id, state: "unknown", facts: { latencyMs: null, pendingMigrations: [] } };
    case "storage": return { id, state: "unknown", facts: { driver: cfg.storage.driver, freeBytes: null, totalBytes: null } };
    case "mail": return { id, state: "unknown", facts: { enabled: cfg.notify.emailEnabled, pending: 0, oldestPendingSec: null, failed24h: 0 } };
    case "ldap": return { id, state: "unknown", facts: { mode: cfg.authMode, lastSuccessAt: null, lastError: null } };
    case "jobs": return { id, state: "unknown", facts: { jobs: [] } };
    case "license": return { id, state: "unknown", facts: { status: "unknown", expiresAt: null, seatsUsed: null, seatsLimit: null } };
    case "search": return { id, state: "unknown", facts: { missingIndexes: [] } };
    case "backup": case "restoreDrill": return { id, state: "unknown", facts: emptyOpsFacts() };
    case "webhooks": return { id, state: "unknown", facts: { enabled: cfg.webhooks?.enabled ?? false, active: 0, disabled: 0, pending: 0, oldestPendingSec: null, failed24h: 0 } };
    case "recurring": return { id, state: "unknown", facts: { active: 0, paused: 0, ownerLostAccess: 0, failed24h: 0 } };
  }
}

/** Открытые функции также позволяют проверить отказ отдельного источника, не подменяя весь снимок. */
export const systemChecks: { [K in Id]: () => Promise<Check<K>> } = {
  async database() {
    const result = await checkDatabaseReadiness();
    return { id: "database", state: !result.db || !result.migrations ? "fail" : (result.latencyMs ?? 0) > 200 ? "warn" : "ok",
      facts: { latencyMs: result.latencyMs, pendingMigrations: result.pending } };
  },
  async storage() {
    const cfg = loadConfig();
    const facts = { driver: cfg.storage.driver, freeBytes: null as number | null, totalBytes: null as number | null };
    if (!await checkStorageReadiness()) return { id: "storage", state: "fail", facts };
    if (facts.driver === "s3") return { id: "storage", state: "ok", facts };
    const fs = await statfs(cfg.storage.dir);
    facts.freeBytes = fs.bavail * fs.bsize;
    facts.totalBytes = fs.blocks * fs.bsize;
    const ratio = facts.totalBytes === 0 ? 0 : facts.freeBytes / facts.totalBytes;
    const state = ratio < 0.02 || facts.freeBytes < 500 * 1024 ** 2 ? "fail"
      : ratio < 0.10 || facts.freeBytes < 2 * 1024 ** 3 ? "warn" : "ok";
    return { id: "storage", state, facts };
  },
  async mail() {
    const cfg = loadConfig().notify;
    const facts = { enabled: cfg.emailEnabled, pending: 0, oldestPendingSec: null as number | null, failed24h: 0 };
    if (!cfg.emailEnabled) return { id: "mail", state: "off", facts };
    if (!cfg.smtp) return { id: "mail", state: "fail", facts };
    const [row] = await q<{ pending: number; oldest: number | null; failed: number }>(`SELECT
      count(*)::int AS pending, GREATEST(0, extract(epoch FROM now() - min(created_at)))::double precision AS oldest,
      (SELECT count(*)::int FROM notifications WHERE email_state = 'failed' AND email_failed_at >= now() - interval '1 day') AS failed
      FROM notifications WHERE email_state = 'pending'`);
    Object.assign(facts, { pending: row.pending, oldestPendingSec: row.pending === 0 ? null : row.oldest, failed24h: row.failed });
    return { id: "mail", state: (facts.oldestPendingSec ?? 0) > 1800 || facts.failed24h > 0 ? "warn" : "ok", facts };
  },
  async ldap() {
    const cfg = loadConfig();
    const facts = { mode: cfg.authMode, lastSuccessAt: null as string | null, lastError: null as string | null };
    if (cfg.authMode === "local" || !cfg.ldap?.bindDn) return { id: "ldap", state: "off", facts };
    const [latest, successes] = await Promise.all([
      q<{ at: Date; failed: boolean }>(`SELECT created_at AS at,
        COALESCE((details->>'errors')::int, 0) > 0 OR COALESCE((details->>'notFound')::int, 0) > 0 AS failed
        FROM audit_log WHERE action = 'ldap.resync' ORDER BY created_at DESC, id DESC LIMIT 1`),
      q<{ at: Date }>(`SELECT created_at AS at FROM audit_log WHERE action = 'ldap.resync'
        AND COALESCE((details->>'errors')::int, 0) = 0 AND COALESCE((details->>'notFound')::int, 0) = 0
        ORDER BY created_at DESC, id DESC LIMIT 1`),
    ]);
    facts.lastSuccessAt = successes[0]?.at.toISOString() ?? null;
    const job = getMaintenanceStatus().jobs.find(job => job.name === "ldap-resync");
    const jobFailed = job?.lastResult === "error" && job.lastRunAt !== null
      && (!latest[0] || Date.parse(job.lastRunAt) >= latest[0].at.getTime());
    if (latest[0]?.failed || jobFailed) facts.lastError = "resync_failed";
    return { id: "ldap", state: facts.lastError || !facts.lastSuccessAt || age(facts.lastSuccessAt) > 3 * cfg.ldap.resyncIntervalMs ? "warn" : "ok", facts };
  },
  async jobs() {
    const jobs = getMaintenanceStatus().jobs;
    const stale = jobs.some(job => job.lastResult === "error" || (job.intervalMs > 0 && (job.lastSuccessAt
      ? age(job.lastSuccessAt) > 3 * job.intervalMs : process.uptime() * 1000 > job.startDelayMs + job.intervalMs)));
    return { id: "jobs", state: stale ? "warn" : "ok", facts: { jobs: jobs.map(({ name, lastSuccessAt, lastResult, intervalMs }) => ({ name, lastSuccessAt, lastResult, intervalMs })) } };
  },
  async license() {
    const status = await getLicenseStatus();
    const facts = { status: status.state, expiresAt: null as string | null, seatsUsed: null as number | null, seatsLimit: null as number | null };
    if (status.state === "invalid") return { id: "license", state: "fail", facts };
    if (status.state === "unset") return { id: "license", state: "warn", facts };
    Object.assign(facts, { expiresAt: new Date(status.claims.exp * 1000).toISOString(), seatsUsed: status.seatsUsed, seatsLimit: status.claims.maxSeats });
    return { id: "license", state: status.state === "expired" || status.seatsOverLimit || status.daysUntilExpiry <= 30 ? "warn" : "ok", facts };
  },
  async search() {
    const { missing } = await searchIndexStatus();
    return { id: "search", state: missing.length > 0 ? "warn" : "ok", facts: { missingIndexes: missing } };
  },
  async backup() {
    const { facts } = await getOpsSnapshot("backup");
    return { id: "backup", state: opsState(facts, "backup"), facts };
  },
  async restoreDrill() {
    const { facts } = await getOpsSnapshot("restore_drill");
    return { id: "restoreDrill", state: opsState(facts, "restore_drill"), facts };
  },
  async webhooks() {
    const enabled = loadConfig().webhooks?.enabled ?? false;
    const facts = { enabled, active: 0, disabled: 0, pending: 0, oldestPendingSec: null as number | null, failed24h: 0 };
    const [tables] = await q<{ present: boolean }>(`SELECT to_regclass('webhooks') IS NOT NULL AND to_regclass('webhook_deliveries') IS NOT NULL AS present`);
    if (!tables.present) return { id: "webhooks", state: "off", facts };
    const [subscriptions, deliveries] = await Promise.all([
      q<{ total: number; active: number; disabled: number }>(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state = 'disabled')::int AS disabled FROM webhooks`),
      q<{ pending: number; oldest: number | null; failed: number }>(`SELECT count(*)::int AS pending,
        GREATEST(0, extract(epoch FROM now() - min(created_at)))::double precision AS oldest,
        (SELECT count(*)::int FROM webhook_deliveries WHERE state = 'failed' AND updated_at >= now() - interval '1 day') AS failed
        FROM webhook_deliveries WHERE state IN ('pending', 'sending')`),
    ]);
    Object.assign(facts, { active: subscriptions[0].active, disabled: subscriptions[0].disabled, pending: deliveries[0].pending,
      oldestPendingSec: deliveries[0].pending === 0 ? null : deliveries[0].oldest, failed24h: deliveries[0].failed });
    const state = !enabled && subscriptions[0].total === 0 ? "off"
      : facts.disabled > 0 || (facts.oldestPendingSec ?? 0) > 900 || facts.failed24h > 0 ? "warn" : "ok";
    return { id: "webhooks", state, facts };
  },
  async recurring() {
    const facts = { active: 0, paused: 0, ownerLostAccess: 0, failed24h: 0 };
    if (!loadConfig().recurring?.enabled) return { id: "recurring", state: "off", facts };
    const [tables] = await q<{ present: boolean }>(`SELECT to_regclass('recurring_rules') IS NOT NULL AND to_regclass('recurring_runs') IS NOT NULL AS present`);
    if (!tables.present) return { id: "recurring", state: "off", facts };
    const [rules, failures] = await Promise.all([
      q<{ total: number; active: number; paused: number; lost: number }>(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state = 'paused')::int AS paused,
        count(*) FILTER (WHERE paused_reason = 'owner_lost_access')::int AS lost FROM recurring_rules`),
      q<{ failed: number }>(`SELECT count(*)::int AS failed FROM recurring_runs WHERE result = 'failed' AND ran_at >= now() - interval '1 day'`),
    ]);
    Object.assign(facts, { active: rules[0].active, paused: rules[0].paused, ownerLostAccess: rules[0].lost, failed24h: failures[0].failed });
    return { id: "recurring", state: rules[0].total === 0 ? "off" : facts.ownerLostAccess > 0 || facts.failed24h > 0 ? "warn" : "ok", facts };
  },
};

export async function getSystemStatus(): Promise<SystemStatusDto> {
  return cache.get("status", async () => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5000); timer.unref(); });
    try {
      const checks = await Promise.all(ids.map(async id => {
        // Обработчик отказа остаётся на запоздавшем promise: после таймаута нет unhandled rejection.
        const check = Promise.resolve().then<SystemCheck>(() => systemChecks[id]()).catch(() => {
          console.error(`[system-status] ${id} check failed`);
          return unknownCheck(id);
        });
        const result = await Promise.race([check, deadline]);
        if (result !== null) return result;
        console.error(`[system-status] ${id} check timed out`);
        return unknownCheck(id);
      }));
      return { version: loadConfig().version, checkedAt: new Date().toISOString(), checks };
    } finally { clearTimeout(timer); }
  });
}

/** Сброс используется только проверками и локальным измерением некэшированного снимка. */
export function clearSystemStatusCache(): void { cache.clear(); }
