/** Project subscriptions: encrypted credentials, bounded creation and public DTOs. */
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { one, q, withTransaction } from "../db.js";
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { LIMITS, type WebhookCreateBody, type WebhookPatchBody, type WebhookDto, type WebhookEventType,
  type WebhookDeliveryDto, type WebhookDeliveryDetailDto, type WebhookDeliveryQuery, type IntegrationsConfigDto } from "../contract.js";
import { checkUrlShape, redactUrl, resolveTarget, TargetBlockedError, type TargetReason } from "./egress.js";
import { seal, webhookSecretContext } from "./secretBox.js";
import { fanOut } from "./webhookDispatch.js";
import { signedHeaders } from "./webhookHttp.js";

interface HookRow {
  id: string; project_id: string; name: string; url_enc: string; url_display: string; secret_enc: string;
  events: WebhookEventType[]; state: WebhookDto["state"]; disabled_reason: WebhookDto["disabledReason"];
  failure_streak: number; last_success_at: Date | null; last_failure_at: Date | null;
  prev_secret_until: Date | null; created_at: Date; updated_at: Date;
}
export function webhookDto(row: HookRow): WebhookDto {
  return { id: row.id, projectId: row.project_id, name: row.name, urlDisplay: row.url_display, events: row.events,
    state: row.state, disabledReason: row.disabled_reason, failureStreak: row.failure_streak,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null, lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    secretRotatedUntil: row.prev_secret_until?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
const missing = () => new ApiHttpError(404, "NOT_FOUND", "Подписка вебхука не найдена");
const newSecret = () => "whsec_" + randomBytes(32).toString("base64url");
function enabledKey(): Buffer {
  const cfg = loadConfig().webhooks;
  if (!cfg.enabled || !cfg.secretKey) throw new ApiHttpError(409, "WEBHOOKS_DISABLED", "Вебхуки выключены настройками инсталляции");
  return cfg.secretKey;
}
function requireActive(row: HookRow): void {
  if (row.state !== "active") throw new ApiHttpError(409, "WEBHOOK_NOT_ACTIVE", "Подписка должна быть активной");
}
let testLookup: Parameters<typeof resolveTarget>[2];
export function _setWebhookLookupForTests(lookup: Parameters<typeof resolveTarget>[2]): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Тестовый резолвер доступен только в тестах");
  testLookup = lookup;
}
const targetReasons: Record<TargetReason, string> = { shape: "Некорректный адрес вебхука", scheme: "Для вебхука требуется HTTPS",
  not_allowed: "Цель не входит в список разрешённых оператором", denied_range: "Служебная сеть не может быть целью вебхука",
  dns: "DNS-адрес цели недоступен или запрещён" };
async function validatedUrl(raw: string): Promise<URL> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const cfg = loadConfig().webhooks, url = checkUrlShape(raw, cfg);
    await Promise.race([resolveTarget(url, cfg, process.env.NODE_ENV === "test" ? testLookup : undefined),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new TargetBlockedError("dns")), 5000); })]);
    return url;
  } catch (error) {
    if (error instanceof TargetBlockedError) throw new ApiHttpError(400, "WEBHOOK_TARGET_NOT_ALLOWED", targetReasons[error.reason]);
    throw error;
  } finally { clearTimeout(timer); }
}
async function lockedHook<T>(projectId: string, id: string, run: (client: pg.PoolClient, row: HookRow) => Promise<T>): Promise<T> {
  return withTransaction(async client => {
    const row = (await client.query<HookRow>(`SELECT * FROM webhooks WHERE project_id=$1 AND id=$2 FOR UPDATE`, [projectId, id])).rows[0];
    if (!row) throw missing(); return run(client, row);
  });
}
const auditDetails = (row: HookRow) => ({ name: row.name, events: row.events, urlDisplay: row.url_display });
export async function listWebhooks(projectId: string): Promise<WebhookDto[]> {
  return (await q<HookRow>(`SELECT * FROM webhooks WHERE project_id=$1 ORDER BY created_at,id`, [projectId])).map(webhookDto);
}
export async function createWebhook(projectId: string, actor: string, body: z.infer<typeof WebhookCreateBody>) {
  const key = enabledKey(), url = await validatedUrl(body.url), id = randomUUID(), secret = newSecret();
  const row = await withTransaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('taskira:webhooks:create'))`);
    if (!(await client.query(`SELECT id FROM projects WHERE id=$1 FOR KEY SHARE`, [projectId])).rowCount)
      throw new ApiHttpError(404, "NOT_FOUND", "Проект не найден");
    const counts = (await client.query<{ total: number; project: number }>(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE project_id=$1)::int AS project FROM webhooks`, [projectId])).rows[0];
    if (counts.total >= LIMITS.webhook.total || counts.project >= LIMITS.webhook.perProject)
      throw new ApiHttpError(409, "WEBHOOK_LIMIT", "Достигнут лимит подписок вебхуков");
    return (await client.query<HookRow>(`INSERT INTO webhooks(id,project_id,name,url_enc,url_display,secret_enc,events,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [id, projectId, body.name, seal(url.href,key,webhookSecretContext(id,"url")),
      redactUrl(url.href), seal(secret,key,webhookSecretContext(id,"secret")), body.events, actor])).rows[0];
  });
  await audit(actor,"webhook.create","webhook",row.id,auditDetails(row));
  return { webhook: webhookDto(row), secret };
}
export async function patchWebhook(projectId: string, id: string, actor: string, body: z.infer<typeof WebhookPatchBody>): Promise<WebhookDto> {
  const key = enabledKey(), url = body.url === undefined ? undefined : await validatedUrl(body.url);
  const row = await lockedHook(projectId,id,async (client, previous) => {
    const changed = (await client.query<HookRow>(`UPDATE webhooks SET name=COALESCE($2,name),url_enc=COALESCE($3,url_enc),
      url_display=COALESCE($4,url_display),events=COALESCE($5,events),state=COALESCE($6,state),
      failure_streak=CASE WHEN $6='active' THEN 0 ELSE failure_streak END,
      failing_since=CASE WHEN $6='active' THEN NULL ELSE failing_since END,
      disabled_reason=CASE WHEN $6::text IS NOT NULL THEN NULL ELSE disabled_reason END,updated_at=now()
      WHERE id=$1 RETURNING *`, [previous.id, body.name ?? null, url ? seal(url.href,key,webhookSecretContext(previous.id,"url")) : null,
      url ? redactUrl(url.href) : null, body.events ?? null, body.state ?? null])).rows[0];
    if (changed.state !== "active") await client.query(`UPDATE webhook_deliveries SET state='cancelled',locked_until=NULL,updated_at=now()
      WHERE webhook_id=$1 AND state IN ('pending','sending')`, [previous.id]);
    return changed;
  });
  await audit(actor,"webhook.update","webhook",row.id,auditDetails(row)); return webhookDto(row);
}
export async function deleteWebhook(projectId: string, id: string, actor: string): Promise<void> {
  const row = await lockedHook(projectId,id,async (client, row) => { await client.query(`DELETE FROM webhooks WHERE id=$1`,[row.id]); return row; });
  await audit(actor,"webhook.delete","webhook",row.id,auditDetails(row));
}
export async function rotateWebhookSecret(projectId: string, id: string, actor: string) {
  const key = enabledKey(), secret = newSecret();
  const row = await lockedHook(projectId,id,async (client, previous) => (await client.query<HookRow>(`UPDATE webhooks
    SET prev_secret_enc=secret_enc,prev_secret_until=now()+interval '24 hours',secret_enc=$2,updated_at=now() WHERE id=$1 RETURNING *`,
    [previous.id,seal(secret,key,webhookSecretContext(previous.id,"secret"))])).rows[0]);
  await audit(actor,"webhook.rotate_secret","webhook",row.id,auditDetails(row));
  return { secret, previousValidUntil: row.prev_secret_until!.toISOString() };
}

export function integrationsConfig(): IntegrationsConfigDto {
  const cfg = loadConfig().webhooks;
  return { webhooksEnabled: cfg.enabled, allowHttp: cfg.allowHttp, allowedTargets: cfg.allowedTargets.map(rule =>
    rule.kind === "host" ? rule.host : rule.kind === "suffix" ? "*." + rule.suffix : `${rule.net}/${rule.prefix}`) };
}

export async function pingWebhook(projectId: string, id: string, actor: string): Promise<{ deliveryId: string }> {
  enabledKey();
  const { hook, eventId } = await lockedHook(projectId,id,async (client, hook) => {
    requireActive(hook);
    const event = (await client.query<{ id: string }>(`INSERT INTO integration_events(type,project_id,actor_id,dedupe_key,data)
      VALUES('ping',$1,$2,$3,$4::jsonb) RETURNING id`, [hook.project_id,actor,"ping:"+randomUUID(),JSON.stringify({ webhookId: hook.id })])).rows[0];
    return { hook, eventId: event.id };
  });
  // Выделенный выбор ждёт раскладку этого события, даже если его уже захватил воркер.
  await fanOut([eventId]);
  const delivery = await one<{ id: string }>(`SELECT id FROM webhook_deliveries WHERE webhook_id=$1 AND event_id=$2 AND NOT manual`,[hook.id,eventId]);
  if (!delivery) {
    const current = await one<HookRow>(`SELECT * FROM webhooks WHERE project_id=$1 AND id=$2`,[projectId,hook.id]);
    if (!current) throw missing(); requireActive(current);
    throw new ApiHttpError(409,"WEBHOOK_NOT_ACTIVE","Подписка изменилась во время создания проверки");
  }
  await audit(actor,"webhook.ping","webhook",hook.id,auditDetails(hook)); return { deliveryId: delivery.id };
}

interface DeliveryRow {
  id: string; event_id: string; public_event_id: string; type: string; issue_key: string | null;
  state: WebhookDeliveryDto["state"]; attempts: number; next_attempt_at: Date; last_status: number | null;
  last_error: string | null; last_duration_ms: number | null; manual: boolean; created_at: Date; updated_at: Date;
  cursor_at: string; payload: Record<string,unknown> | null; response_excerpt: string | null;
}
function deliveryDto(row: DeliveryRow): WebhookDeliveryDto {
  return { id: row.id, eventId: row.public_event_id, eventType: row.type, issueKey: row.issue_key, state: row.state,
    attempts: row.attempts, nextAttemptAt: row.next_attempt_at.toISOString(), lastStatus: row.last_status,
    lastError: row.last_error, lastDurationMs: row.last_duration_ms, manual: row.manual,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
const deliverySelect = `SELECT d.*, e.event_id AS public_event_id, e.type, e.issue_key, e.payload,
  to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
  FROM webhook_deliveries d JOIN integration_events e ON e.id=d.event_id`;
const Cursor = z.object({ at: z.string().datetime({ precision: 6 }), id: z.string().uuid() }).strict();
function readCursor(raw: string | undefined): z.infer<typeof Cursor> | null {
  if (raw === undefined) return null;
  try {
    if (!raw || Buffer.from(raw,"base64url").toString("base64url") !== raw) throw new Error("cursor");
    const cursor = Cursor.parse(JSON.parse(Buffer.from(raw,"base64url").toString("utf8")));
    const date = new Date(cursor.at);
    if (!Number.isFinite(date.getTime()) || cursor.at.startsWith("0000-")
      || date.toISOString().slice(0,23) !== cursor.at.slice(0,23)) throw new Error("cursor");
    return cursor;
  } catch { throw new ApiHttpError(400,"VALIDATION","Некорректный курсор журнала доставок"); }
}
async function existingHook(projectId: string,id: string): Promise<HookRow> {
  const row = await one<HookRow>(`SELECT * FROM webhooks WHERE project_id=$1 AND id=$2`,[projectId,id]);
  if (!row) throw missing(); return row;
}
export async function listWebhookDeliveries(projectId: string,id: string,query: z.infer<typeof WebhookDeliveryQuery>) {
  const hook = await existingHook(projectId,id), cursor = readCursor(query.cursor);
  const rows = await q<DeliveryRow>(`${deliverySelect} WHERE d.webhook_id=$1 AND ($2::text IS NULL OR d.state=$2)
    AND ($3::timestamptz IS NULL OR (d.created_at,d.id)<($3::timestamptz,$4::uuid))
    ORDER BY d.created_at DESC,d.id DESC LIMIT $5`, [hook.id,query.state ?? null,cursor?.at ?? null,cursor?.id ?? null,query.limit+1]);
  const items = rows.slice(0,query.limit), last = items.at(-1);
  return { items: items.map(deliveryDto), nextCursor: rows.length>query.limit && last
    ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString("base64url") : null };
}
export async function getWebhookDelivery(projectId: string,id: string,deliveryId: string): Promise<WebhookDeliveryDetailDto> {
  const hook = await existingHook(projectId,id);
  const row = await one<DeliveryRow>(`${deliverySelect} WHERE d.webhook_id=$1 AND d.id=$2`,[hook.id,deliveryId]);
  if (!row) throw new ApiHttpError(404,"NOT_FOUND","Доставка вебхука не найдена");
  const headers = signedHeaders("",[],row.type,row.public_event_id,row.id,loadConfig().version);
  delete headers["X-Taskira-Signature"];
  return { ...deliveryDto(row), payload: row.payload, headers, responseExcerpt: row.response_excerpt };
}
export async function redeliverWebhook(projectId: string,id: string,deliveryId: string,actor: string): Promise<{ deliveryId: string }> {
  enabledKey();
  const result = await lockedHook(projectId,id,async (client,hook) => {
    requireActive(hook);
    const row = (await client.query<{ id: string }>(`INSERT INTO webhook_deliveries(webhook_id,event_id,manual)
      SELECT webhook_id,event_id,true FROM webhook_deliveries WHERE webhook_id=$1 AND id=$2 RETURNING id`,[hook.id,deliveryId])).rows[0];
    if (!row) throw new ApiHttpError(404,"NOT_FOUND","Доставка вебхука не найдена");
    return { hook, deliveryId: row.id };
  });
  await audit(actor,"webhook.redeliver","webhook",result.hook.id,auditDetails(result.hook)); return { deliveryId: result.deliveryId };
}
export async function redeliverFailedWebhooks(projectId: string,id: string,since: string,actor: string): Promise<{ count: number }> {
  enabledKey();
  const from = new Date(since);
  if (!Number.isFinite(from.getTime()) || from.getTime()<Date.now()-7*86400_000)
    throw new ApiHttpError(400,"VALIDATION","Повтор разрешён за последние семь суток");
  // Нормализуем смещение для PostgreSQL, сохраняя исходную точность дробной части.
  const timestamp = from.toISOString().replace(/\.\d{3}Z$/, "."+(since.match(/\.(\d+)/)?.[1] ?? "000")+"Z");
  const result = await lockedHook(projectId,id,async (client,hook) => {
    requireActive(hook);
    const rows = await client.query(`INSERT INTO webhook_deliveries(webhook_id,event_id,manual)
      SELECT webhook_id,event_id,true FROM webhook_deliveries WHERE webhook_id=$1 AND state IN ('failed','cancelled')
        AND created_at>=$2::timestamptz ORDER BY created_at DESC,id DESC LIMIT 1000`,[hook.id,timestamp]);
    return { hook, count: rows.rowCount ?? 0 };
  });
  await audit(actor,"webhook.redeliver","webhook",result.hook.id,auditDetails(result.hook)); return { count: result.count };
}
