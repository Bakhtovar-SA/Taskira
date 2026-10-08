/** Отчёты операций хоста: общие факты для экрана и scrape, без зависимости от фоновых заданий. */
import { basename } from "node:path";
import { q } from "../db.js";
import type { OpsFacts, OpsKind, OpsRunDto, StatusState } from "../contract.js";

interface OpsRow {
  id: string; kind: OpsKind; started_at: Date; finished_at: Date | null;
  result: "running" | "success" | "failure"; host: string | null; archive: string | null;
  app_version: string | null; details: Record<string, unknown>; error: string | null;
}
const COLUMNS = "id, kind, started_at, finished_at, result, host, archive, app_version, details, error";
const SIX_HOURS = 6 * 60 * 60_000;
const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
export const emptyOpsFacts = (): OpsFacts => ({ lastSuccessAt: null, lastRunAt: null, lastResult: null, archive: null });

function safeDetails(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const details: Record<string, unknown> = {};
  for (const key of ["bytes", "durationSec", "projects", "issues"]) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) details[key] = value;
  }
  for (const key of ["countsSkipped", "attachmentSkipped"]) {
    if (typeof raw[key] === "boolean") details[key] = raw[key];
  }
  if (raw.storageDriver === "local" || raw.storageDriver === "s3") details.storageDriver = raw.storageDriver;
  if (Array.isArray(raw.checks)) details.checks = raw.checks.filter(value => ["ready", "login", "projects", "counts", "attachment"].includes(value));
  return details;
}

function mapRun(row: OpsRow, now = Date.now()): OpsRunDto {
  return { id: row.id, kind: row.kind, startedAt: row.started_at.toISOString(), finishedAt: iso(row.finished_at),
    result: row.result === "running" && now - row.started_at.getTime() > SIX_HOURS ? "interrupted" : row.result,
    host: row.host, archive: row.archive === null ? null : basename(row.archive.replaceAll("\\", "/")),
    appVersion: row.app_version, details: safeDetails(row.details), error: row.error ? "operation_failed" : null };
}
export async function getOpsRuns(kind: OpsKind, limit: number): Promise<OpsRunDto[]> {
  const rows = await q<OpsRow>(`SELECT ${COLUMNS} FROM ops_runs WHERE kind = $1 ORDER BY started_at DESC, id DESC LIMIT $2`, [kind, limit]);
  return rows.map(row => mapRun(row));
}
export async function getOpsSnapshot(kind: OpsKind): Promise<{ facts: OpsFacts; lastCompletedSuccess: number | null }> {
  const [latest, successful, completed] = await Promise.all([
    getOpsRuns(kind, 1),
    q<{ at: Date }>(`SELECT finished_at AS at FROM ops_runs WHERE kind = $1 AND result = 'success' AND finished_at IS NOT NULL
      ORDER BY finished_at DESC, id DESC LIMIT 1`, [kind]),
    q<{ result: string }>(`SELECT result FROM ops_runs WHERE kind = $1 AND result <> 'running' AND finished_at IS NOT NULL
      ORDER BY finished_at DESC, id DESC LIMIT 1`, [kind]),
  ]);
  const run = latest[0];
  if (!run) return { facts: emptyOpsFacts(), lastCompletedSuccess: null };
  return { facts: { lastSuccessAt: iso(successful[0]?.at ?? null), lastRunAt: run.startedAt, lastResult: run.result, archive: run.archive },
    lastCompletedSuccess: run.result === "interrupted" ? 0 : completed[0] ? Number(completed[0].result === "success") : null };
}
export function opsState(facts: OpsFacts, kind: OpsKind, now = Date.now()): StatusState {
  if (facts.lastResult === "failure" || facts.lastResult === "interrupted") return "fail";
  if (facts.lastSuccessAt === null) return "unknown";
  const age = Math.max(0, now - Date.parse(facts.lastSuccessAt));
  const [warning, failure] = kind === "backup" ? [26 * 3600_000, 50 * 3600_000] : [8 * 86400_000, 15 * 86400_000];
  return age > failure ? "fail" : age >= warning ? "warn" : "ok";
}
