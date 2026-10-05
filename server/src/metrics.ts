/** Минимальный реестр Prometheus без внешнего collector/sidecar. */
import { q } from "./db.js";

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const LDAP_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

interface HistogramValue {
  count: number;
  sum: number;
  buckets: number[];
}

const httpRequests = new Map<string, number>();
const httpDurations = new Map<string, HistogramValue>();
const s3Errors = new Map<string, number>();
const ldapDurations = new Map<string, HistogramValue>();
const JOB_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300, 900];
const jobRuns = new Map<string, number>();
const jobDurations = new Map<string, HistogramValue>();
const jobLastSuccess = new Map<string, number>();
const jobRunning = new Map<string, number>();
let maintenanceArchived = 0;
let maintenanceAuditPurged = 0;
let backgroundQueueSize = 0;
let collectionErrors = 0;
const integrationEvents = new Map<string, number>();
const webhookDeliveries = new Map<string, number>();
const webhookBlocked = new Map<string, number>();
const webhookDurations = new Map<string, HistogramValue>();
const WEBHOOK_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
let webhookQueueSize = 0, webhookQueueOldest = 0, integrationOutbox = 0;
let webhooksByState = new Map<string, number>();

export function addIntegrationEvents(type: string): void {
  if (!["issue.created", "issue.updated", "issue.statusChanged", "issue.assigned", "issue.commented", "issue.due", "ping"].includes(type)) return;
  integrationEvents.set(type, (integrationEvents.get(type) ?? 0) + 1);
}
export function recordWebhookDelivery(result: "succeeded" | "retry" | "failed" | "cancelled", seconds?: number, count = 1): void {
  webhookDeliveries.set(result, (webhookDeliveries.get(result) ?? 0) + count);
  if (seconds !== undefined) observe(webhookDurations, WEBHOOK_BUCKETS, {}, seconds);
}
export function recordWebhookTargetBlocked(reason: "not_allowed" | "denied_range" | "dns"): void {
  webhookBlocked.set(reason, (webhookBlocked.get(reason) ?? 0) + 1);
}

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function parseLabels(key: string): Record<string, string> {
  if (!key) return {};
  return Object.fromEntries(key.split("\u0000").map((part) => {
    const at = part.indexOf("=");
    return [part.slice(0, at), part.slice(at + 1)];
  }));
}

function observe(store: Map<string, HistogramValue>, buckets: number[], labels: Record<string, string>, value: number): void {
  const key = labelsKey(labels);
  const current = store.get(key) ?? { count: 0, sum: 0, buckets: buckets.map(() => 0) };
  current.count += 1;
  current.sum += value;
  buckets.forEach((limit, index) => {
    if (value <= limit) current.buckets[index] += 1;
  });
  store.set(key, current);
}

export function observeHttpRequest(method: string, route: string, status: number, seconds: number): void {
  const base = { method, route };
  const counterKey = labelsKey({ ...base, status: String(status) });
  httpRequests.set(counterKey, (httpRequests.get(counterKey) ?? 0) + 1);
  observe(httpDurations, HTTP_BUCKETS, base, seconds);
}

export function observeLdapResync(seconds: number, outcome: "success" | "partial" | "error"): void {
  observe(ldapDurations, LDAP_BUCKETS, { outcome }, seconds);
}

/** Итог тика фонового джоба. `skipped` — чужой процесс держит лок джоба (не ошибка, длительность не пишется). */
export function recordBackgroundJob(job: string, result: "success" | "error" | "skipped", seconds?: number): void {
  const key = labelsKey({ job, result });
  jobRuns.set(key, (jobRuns.get(key) ?? 0) + 1);
  if (result !== "skipped" && seconds !== undefined) observe(jobDurations, JOB_BUCKETS, { job }, seconds);
  if (result === "success") jobLastSuccess.set(job, Date.now() / 1000);
}

export function setBackgroundJobRunning(job: string, running: boolean): void {
  jobRunning.set(job, running ? 1 : 0);
}

export function addMaintenanceWork(archived: number, auditPurged: number): void {
  maintenanceArchived += archived;
  maintenanceAuditPurged += auditPurged;
}

export function incrementS3Error(operation: string): void {
  s3Errors.set(operation, (s3Errors.get(operation) ?? 0) + 1);
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelSet(labels: Record<string, string>): string {
  const body = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",");
  return body ? `{${body}}` : "";
}

function renderHistogram(name: string, help: string, store: Map<string, HistogramValue>, buckets: number[]): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (const [key, value] of [...store.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const labels = parseLabels(key);
    buckets.forEach((limit, index) => {
      lines.push(`${name}_bucket${labelSet({ ...labels, le: String(limit) })} ${value.buckets[index]}`);
    });
    lines.push(`${name}_bucket${labelSet({ ...labels, le: "+Inf" })} ${value.count}`);
    lines.push(`${name}_sum${labelSet(labels)} ${value.sum}`);
    lines.push(`${name}_count${labelSet(labels)} ${value.count}`);
  }
  return lines;
}

/** Обновляется при scrape: размер durable email-очереди хранится в PostgreSQL. */
export async function refreshBackgroundQueueMetrics(): Promise<void> {
  try {
    const rows = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications WHERE email_state = 'pending'`,
    );
    backgroundQueueSize = Number(rows[0]?.count ?? 0);
  } catch {
    collectionErrors += 1;
  }
  try {
    const [queue, states] = await Promise.all([
      q<{ size: string; oldest: number; outbox: string }>(`SELECT count(*)::text AS size,
        COALESCE(GREATEST(0, extract(epoch FROM now() - min(created_at))), 0)::double precision AS oldest,
        (SELECT count(*)::text FROM integration_events WHERE dispatched_at IS NULL) AS outbox
        FROM webhook_deliveries WHERE state IN ('pending', 'sending')`),
      q<{ state: string; count: string }>(`SELECT state, count(*)::text FROM webhooks GROUP BY state`),
    ]);
    webhookQueueSize = Number(queue[0].size); webhookQueueOldest = queue[0].oldest; integrationOutbox = Number(queue[0].outbox);
    webhooksByState = new Map(states.map(row => [row.state, Number(row.count)]));
  } catch { collectionErrors += 1; }
}

export function renderMetrics(activeWsConnections: number): string {
  const lines = [
    "# HELP taskira_http_requests_total HTTP responses grouped by route template and status code.",
    "# TYPE taskira_http_requests_total counter",
  ];
  for (const [key, value] of [...httpRequests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`taskira_http_requests_total${labelSet(parseLabels(key))} ${value}`);
  }
  lines.push(...renderHistogram(
    "taskira_http_request_duration_seconds",
    "HTTP request duration grouped by route template.",
    httpDurations,
    HTTP_BUCKETS,
  ));
  lines.push(
    "# HELP taskira_ws_connections Current open WebSocket connections.",
    "# TYPE taskira_ws_connections gauge",
    `taskira_ws_connections ${activeWsConnections}`,
    "# HELP taskira_background_queue_size Pending background jobs by queue.",
    "# TYPE taskira_background_queue_size gauge",
    `taskira_background_queue_size{queue="email_notifications"} ${backgroundQueueSize}`,
  );
  lines.push(...renderHistogram(
    "taskira_ldap_resync_duration_seconds",
    "Duration of a complete LDAP resynchronization.",
    ldapDurations,
    LDAP_BUCKETS,
  ));
  lines.push("# HELP taskira_background_job_runs_total Background job ticks by job and result (success, error, skipped = lock held elsewhere). Per process.", "# TYPE taskira_background_job_runs_total counter");
  for (const [key, value] of [...jobRuns.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`taskira_background_job_runs_total${labelSet(parseLabels(key))} ${value}`);
  }
  lines.push(...renderHistogram(
    "taskira_background_job_duration_seconds",
    "Duration of executed background job ticks (skipped ticks excluded).",
    jobDurations,
    JOB_BUCKETS,
  ));
  lines.push("# HELP taskira_background_job_last_success_timestamp_seconds Unix time of the last successful tick of the job in this process.", "# TYPE taskira_background_job_last_success_timestamp_seconds gauge");
  for (const [job, value] of [...jobLastSuccess.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`taskira_background_job_last_success_timestamp_seconds${labelSet({ job })} ${value}`);
  }
  lines.push("# HELP taskira_background_job_running 1 while a tick of the job is executing in this process.", "# TYPE taskira_background_job_running gauge");
  for (const [job, value] of [...jobRunning.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`taskira_background_job_running${labelSet({ job })} ${value}`);
  }
  lines.push(
    "# HELP taskira_maintenance_archived_issues_total Issues auto-archived by this process.",
    "# TYPE taskira_maintenance_archived_issues_total counter",
    `taskira_maintenance_archived_issues_total ${maintenanceArchived}`,
    "# HELP taskira_maintenance_audit_purged_total audit_log rows purged by retention in this process.",
    "# TYPE taskira_maintenance_audit_purged_total counter",
    `taskira_maintenance_audit_purged_total ${maintenanceAuditPurged}`,
  );
  lines.push(
    "# HELP taskira_s3_errors_total S3 operation errors.",
    "# TYPE taskira_s3_errors_total counter",
  );
  for (const [operation, value] of [...s3Errors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`taskira_s3_errors_total${labelSet({ operation })} ${value}`);
  }
  lines.push(
    "# HELP taskira_metrics_collection_errors_total Errors while collecting scrape-time metrics.",
    "# TYPE taskira_metrics_collection_errors_total counter",
    `taskira_metrics_collection_errors_total ${collectionErrors}`,
  );
  for (const [name, help, label, values] of [
    ["taskira_integration_events_total", "Integration events processed by fan-out in this process.", "type", integrationEvents],
    ["taskira_webhook_deliveries_total", "Delivery outcomes in this process.", "result", webhookDeliveries],
    ["taskira_webhook_target_blocked_total", "Rejected destinations in this process.", "reason", webhookBlocked],
  ] as const) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [value, count] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${name}${labelSet({ [label]: value })} ${count}`);
  }
  lines.push(...renderHistogram("taskira_webhook_delivery_duration_seconds", "Duration of webhook attempts including DNS and connection fallback.", webhookDurations, WEBHOOK_BUCKETS));
  for (const [name, help, value] of [
    ["taskira_webhook_queue_size", "Pending and leased deliveries.", webhookQueueSize],
    ["taskira_webhook_queue_oldest_age_seconds", "Age of the oldest queued delivery.", webhookQueueOldest],
    ["taskira_integration_outbox_undispatched", "Integration events awaiting fan-out.", integrationOutbox],
  ] as const) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
  lines.push("# HELP taskira_webhooks Subscriptions by state.", "# TYPE taskira_webhooks gauge");
  for (const state of ["active", "paused", "disabled"]) lines.push(`taskira_webhooks${labelSet({ state })} ${webhooksByState.get(state) ?? 0}`);
  return `${lines.join("\n")}\n`;
}

/** Только для изолированных тестов. */
export function _resetMetrics(): void {
  httpRequests.clear();
  httpDurations.clear();
  s3Errors.clear();
  ldapDurations.clear();
  jobRuns.clear();
  jobDurations.clear();
  jobLastSuccess.clear();
  jobRunning.clear();
  maintenanceArchived = 0;
  maintenanceAuditPurged = 0;
  backgroundQueueSize = 0;
  collectionErrors = 0;
  integrationEvents.clear(); webhookDeliveries.clear(); webhookBlocked.clear(); webhookDurations.clear();
  webhooksByState.clear(); webhookQueueSize = 0; webhookQueueOldest = 0; integrationOutbox = 0;
}
