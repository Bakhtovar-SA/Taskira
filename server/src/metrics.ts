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
let backgroundQueueSize = 0;
let collectionErrors = 0;

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function parseLabels(key: string): Record<string, string> {
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
  return `{${body}}`;
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
  return `${lines.join("\n")}\n`;
}

/** Только для изолированных тестов. */
export function _resetMetrics(): void {
  httpRequests.clear();
  httpDurations.clear();
  s3Errors.clear();
  ldapDurations.clear();
  backgroundQueueSize = 0;
  collectionErrors = 0;
}
