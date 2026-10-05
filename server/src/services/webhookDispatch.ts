/** Durable fan-out and bounded delivery. HTTP runs outside database transactions. */
import { withAdvisoryLock, withTransaction } from "../db.js";
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { addIntegrationEvents, recordWebhookDelivery, recordWebhookTargetBlocked, recordBackgroundJob } from "../metrics.js";
import { getBrand } from "./brand.js";
import { buildPayload, type IntegrationEventRow } from "./webhookPayload.js";
import { checkUrlShape, resolveTarget, TargetBlockedError } from "./egress.js";
import { open, SecretUnavailableError, webhookSecretContext } from "./secretBox.js";
import { send, signedHeaders, type SendResult } from "./webhookHttp.js";

interface FanOutRow extends IntegrationEventRow { project_key: string; username: string | null; auth_source: string | null }
export async function fanOut(): Promise<number> {
  // Не берём второе соединение, удерживая транзакцию: тик уже занимает соединение advisory-локом.
  const brand = await getBrand();
  const done = await withTransaction(async client => {
    const { rows } = await client.query<FanOutRow>(`SELECT e.*, p.key AS project_key, u.username, u.auth_source
      FROM integration_events e JOIN projects p ON p.id = e.project_id LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.dispatched_at IS NULL ORDER BY e.id LIMIT 500 FOR UPDATE OF e SKIP LOCKED`);
    if (!rows.length) return rows;
    const base = loadConfig().notify.appBaseUrl;
    const ids = rows.map(row => row.id);
    const payloads = rows.map(row => JSON.stringify(buildPayload(row, { instanceName: brand.name ?? "Taskira",
      appBaseUrl: base, projectKey: row.project_key, actorUsername: row.username, actorSource: row.auth_source })));
    await client.query(`UPDATE integration_events e SET payload = v.payload::jsonb
      FROM unnest($1::bigint[], $2::text[]) AS v(id, payload) WHERE e.id = v.id`, [ids, payloads]);
    await client.query(`INSERT INTO webhook_deliveries (webhook_id, event_id)
      SELECT w.id, e.id FROM integration_events e JOIN webhooks w ON w.project_id = e.project_id
      WHERE e.id = ANY($1::bigint[]) AND w.state = 'active' AND w.created_at <= e.occurred_at
        AND ((e.type = 'ping' AND e.data->>'webhookId' = w.id::text) OR (e.type <> 'ping' AND e.type = ANY(w.events)))
      ON CONFLICT (webhook_id, event_id) WHERE NOT manual DO NOTHING`, [ids]);
    await client.query(`UPDATE integration_events SET dispatched_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
    return rows;
  });
  for (const row of done) addIntegrationEvents(row.type);
  return done.length;
}

export interface ClaimedDelivery {
  id: string; webhook_id: string; event_id: string; attempts: number;
  public_event_id: string; type: string; payload: unknown;
  url_enc: string; secret_enc: string; prev_secret_enc: string | null; prev_secret_until: Date | null;
}
export async function claimDeliveries(): Promise<ClaimedDelivery[]> {
  return withTransaction(async client => {
    const { rows } = await client.query<ClaimedDelivery>(`SELECT d.id, d.webhook_id, d.event_id, d.attempts,
        e.event_id AS public_event_id, e.type, e.payload, w.url_enc, w.secret_enc, w.prev_secret_enc, w.prev_secret_until
      FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id JOIN integration_events e ON e.id = d.event_id
      WHERE d.state IN ('pending', 'sending') AND (d.state = 'pending' OR d.locked_until < now())
        AND d.next_attempt_at <= now() AND w.state = 'active' AND e.payload IS NOT NULL
      ORDER BY d.next_attempt_at, d.id LIMIT 16 FOR UPDATE OF d SKIP LOCKED`);
    const perHook = new Map<string, number>();
    const chosen: ClaimedDelivery[] = [], deferred: string[] = [];
    for (const row of rows) {
      const count = perHook.get(row.webhook_id) ?? 0;
      if (count >= 4) { deferred.push(row.id); continue; }
      perHook.set(row.webhook_id, count + 1); chosen.push({ ...row, attempts: row.attempts + 1 });
    }
    if (deferred.length) await client.query(`UPDATE webhook_deliveries SET state = 'pending', locked_until = NULL
      WHERE id = ANY($1::uuid[])`, [deferred]);
    if (chosen.length) await client.query(`UPDATE webhook_deliveries SET state = 'sending', locked_until = now() + interval '60 seconds',
      attempts = attempts + 1, updated_at = now() WHERE id = ANY($1::uuid[])`, [chosen.map(row => row.id)]);
    return chosen;
  });
}

const RETRY_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];
export function retryDelay(attempts: number, retryAfter: string | null, now = Date.now()): number {
  if (retryAfter !== null) {
    const delay = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(delay)) return Math.min(3_600_000, Math.max(0, delay));
  }
  return Math.round(RETRY_MS[Math.min(Math.max(attempts - 1, 0), RETRY_MS.length - 1)] * (0.8 + Math.random() * 0.4));
}

export async function recordResult(row: ClaimedDelivery, result: SendResult): Promise<"succeeded" | "retry" | "failed" | "cancelled" | null> {
  const stored = await withTransaction(async client => {
    // Согласованный порядок блокировок с pause/delete: сначала подписка, затем доставка.
    const hook = (await client.query<{ state: string; project_id: string; url_display: string }>(
      `SELECT state, project_id, url_display FROM webhooks WHERE id = $1 FOR UPDATE`, [row.webhook_id])).rows[0];
    if (!hook) return null;
    const current = (await client.query<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM webhook_deliveries WHERE id = $1 FOR UPDATE`, [row.id])).rows[0];
    if (!current || current.state !== "sending" || current.attempts !== row.attempts) return null;
    if (hook.state !== "active") {
      await client.query(`UPDATE webhook_deliveries SET state = 'cancelled', locked_until = NULL, updated_at = now() WHERE id = $1`, [row.id]);
      return { outcome: "cancelled" as const, cancelled: 0, disabled: null, hook };
    }
    const success = result.error === null && result.status !== null && result.status >= 200 && result.status < 300;
    const retryable = ["timeout", "dns", "connect", "tls", "internal"].includes(result.error ?? "")
      || (result.error === "http_status" && (result.status === 408 || result.status === 429 || ((result.status ?? 0) >= 500 && (result.status ?? 0) < 600)));
    const outcome = success ? "succeeded" : retryable && row.attempts < 8 ? "retry" : "failed";
    const next = outcome === "retry" ? new Date(Date.now() + retryDelay(row.attempts, result.status === 429 ? result.retryAfter : null)) : null;
    await client.query(`UPDATE webhook_deliveries SET state = $2, next_attempt_at = COALESCE($3, next_attempt_at), locked_until = NULL,
      last_status = $4, last_error = $5, last_duration_ms = $6, response_excerpt = $7, updated_at = now() WHERE id = $1`,
      [row.id, outcome === "retry" ? "pending" : outcome, next, result.status, result.error, result.durationMs, result.excerpt]);
    let disabled: string | null = null, cancelled = 0;
    if (success) {
      await client.query(`UPDATE webhooks SET failure_streak = 0, failing_since = NULL, last_success_at = now(), updated_at = now() WHERE id = $1`, [row.webhook_id]);
    } else {
      const explicit = result.error === "secret_unavailable" ? "secret_unavailable" : result.status === 410 ? "gone" : null;
      const updated = (await client.query<{ disabled_reason: string | null }>(`UPDATE webhooks SET failure_streak = failure_streak + 1,
        failing_since = COALESCE(failing_since, now()), last_failure_at = now(), updated_at = now(),
        state = CASE WHEN $2::text IS NOT NULL OR (failure_streak + 1 >= 20 AND failing_since <= now() - interval '24 hours') THEN 'disabled' ELSE state END,
        disabled_reason = CASE WHEN $2::text IS NOT NULL THEN $2 WHEN failure_streak + 1 >= 20 AND failing_since <= now() - interval '24 hours' THEN 'failing' ELSE NULL END
        WHERE id = $1 RETURNING disabled_reason`, [row.webhook_id, explicit])).rows[0];
      disabled = updated.disabled_reason;
      if (disabled) cancelled = (await client.query(`UPDATE webhook_deliveries SET state = 'cancelled', locked_until = NULL, updated_at = now()
        WHERE webhook_id = $1 AND state IN ('pending', 'sending')`, [row.webhook_id])).rowCount ?? 0;
    }
    return { outcome, cancelled, disabled, hook } as const;
  });
  if (!stored) return null;
  recordWebhookDelivery(stored.outcome, result.durationMs / 1000);
  if (stored.cancelled) recordWebhookDelivery("cancelled", undefined, stored.cancelled);
  // audit берёт соединение из пула; транзакция результата уже завершена, чтобы не исчерпать пул параллельными попытками.
  if (stored.disabled) await audit(null, "webhook.disabled", "webhook", row.webhook_id,
    { reason: stored.disabled, projectId: stored.hook.project_id, urlDisplay: stored.hook.url_display });
  return stored.outcome;
}

export interface DispatchOptions {
  lookup?: Parameters<typeof resolveTarget>[2];
  timeoutMs?: number; connectTimeoutMs?: number; maxMs?: number; maxBatches?: number;
}
export interface DispatchStats { skipped: boolean; events: number; sent: number; succeeded: number; retry: number; failed: number; cancelled: number }
const active = new Map<AbortController, Promise<DispatchStats>>();
let stopped = false;
export function resumeWebhookDispatch(): void { stopped = false; }
export async function stopWebhookDispatch(): Promise<void> {
  stopped = true;
  for (const controller of active.keys()) controller.abort();
  await Promise.allSettled([...active.values()]);
}

async function attempt(row: ClaimedDelivery, opts: DispatchOptions, signal: AbortSignal): Promise<SendResult> {
  const cfg = loadConfig();
  const started = performance.now();
  const empty = (error: SendResult["error"]): SendResult => ({ error, status: null, durationMs: Math.round(performance.now() - started), excerpt: "", retryAfter: null });
  try {
    if (!cfg.webhooks.secretKey) throw new SecretUnavailableError();
    const url = checkUrlShape(open(row.url_enc, cfg.webhooks.secretKey, webhookSecretContext(row.webhook_id, "url")), cfg.webhooks);
    const secrets = [open(row.secret_enc, cfg.webhooks.secretKey, webhookSecretContext(row.webhook_id, "secret"))];
    if (row.prev_secret_enc && row.prev_secret_until && new Date(row.prev_secret_until).getTime() > Date.now())
      secrets.push(open(row.prev_secret_enc, cfg.webhooks.secretKey, webhookSecretContext(row.webhook_id, "secret")));
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    const target = await Promise.race([
      resolveTarget(url, cfg.webhooks, opts.lookup),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TargetBlockedError("dns")), opts.connectTimeoutMs ?? 5000);
        abort = () => reject(new Error("stopped"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]).finally(() => { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); });
    const body = JSON.stringify(row.payload);
    const deadline = started + (opts.timeoutMs ?? 10_000);
    let result = empty("connect");
    for (const address of target.addresses) {
      if (signal.aborted) return empty("internal");
      const remaining = Math.max(1, deadline - performance.now());
      if (performance.now() >= deadline) return empty("timeout");
      result = await send({ url, ...address, body,
        headers: signedHeaders(body, secrets, row.type, row.public_event_id, row.id, cfg.version),
        timeoutMs: remaining, connectTimeoutMs: Math.min(opts.connectTimeoutMs ?? 5000, remaining), signal, redactValues: secrets });
      // Другой адрес допустим лишь при сбое соединения до HTTP-ответа.
      if (result.error !== "connect" || result.status !== null) break;
    }
    return { ...result, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof SecretUnavailableError) return empty("secret_unavailable");
    if (error instanceof TargetBlockedError) {
      recordWebhookTargetBlocked(error.reason === "denied_range" ? "denied_range" : error.reason === "dns" ? "dns" : "not_allowed");
      return empty(error.reason === "dns" ? "dns" : "target_blocked");
    }
    return empty("internal");
  }
}

/** Вызывается startJob, который уже держит advisory-лок и учитывает статус тика. */
export function runWebhookDispatchWork(opts: DispatchOptions = {}): Promise<DispatchStats> {
  const controller = new AbortController();
  const task = (async () => {
    const stats: DispatchStats = { skipped: false, events: 0, sent: 0, succeeded: 0, retry: 0, failed: 0, cancelled: 0 };
    if (!loadConfig().webhooks.enabled || stopped) return { ...stats, skipped: true };
    const started = performance.now();
    let batches = 0;
    while (!controller.signal.aborted && performance.now() - started < (opts.maxMs ?? 10_000) && batches++ < (opts.maxBatches ?? Infinity)) {
      const events = await fanOut(); stats.events += events;
      if (controller.signal.aborted) break;
      const rows = await claimDeliveries();
      if (!rows.length && !events) break;
      const sent = await Promise.all(rows.map(row => attempt(row, opts, controller.signal)));
      // HTTP — до 16 параллельных запросов; БД — до 4 транзакций, последовательно на подписку.
      // Ожидание одной строки webhooks не должно занимать весь пул и задерживать пользовательский PATCH.
      const byHook = new Map<string, number[]>();
      rows.forEach((row, index) => byHook.set(row.webhook_id, [...(byHook.get(row.webhook_id) ?? []), index]));
      const groups = [...byHook.values()]; let nextGroup = 0;
      const writers = Math.min(groups.length, Math.max(1, Math.min(4, loadConfig().pgPoolMax - 3)));
      const results = await Promise.allSettled(Array.from({ length: writers }, async () => {
        for (;;) {
          const group = groups[nextGroup++];
          if (!group) return;
          for (const index of group) {
            if (controller.signal.aborted) return; // аренда сохранится, следующий процесс подберёт работу
            const outcome = await recordResult(rows[index], sent[index]);
            if (outcome) { stats.sent++; stats[outcome]++; }
          }
        }
      }));
      // Не освобождаем advisory-лок и регистрацию shutdown, пока остальные попытки ещё выполняются.
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    return stats;
  })();
  active.set(controller, task);
  void task.finally(() => active.delete(controller)).catch(() => undefined);
  return task;
}

export async function runWebhookDispatchOnce(opts: DispatchOptions = {}): Promise<DispatchStats> {
  const empty: DispatchStats = { skipped: true, events: 0, sent: 0, succeeded: 0, retry: 0, failed: 0, cancelled: 0 };
  if (!loadConfig().webhooks.enabled || stopped) {
    recordBackgroundJob("webhook-dispatch", "skipped");
    return empty;
  }
  const started = performance.now();
  const r = await withAdvisoryLock("taskira:job:webhook-dispatch", { wait: false }, () => runWebhookDispatchWork(opts));
  const stats = r.acquired ? r.value : empty;
  recordBackgroundJob("webhook-dispatch", stats.skipped ? "skipped" : "success", stats.skipped ? undefined : (performance.now() - started) / 1000);
  return stats;
}
