import { randomUUID, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { webhookReceiver } from "./helpers/webhookReceiver.js";
import { loadConfig } from "../src/config.js";
import { _allowLoopbackForTests, parseTargetRules, redactUrl } from "../src/services/egress.js";
import { seal, webhookSecretContext } from "../src/services/secretBox.js";
import { claimDeliveries, fanOut, recordResult, recordResults, resumeWebhookDispatch, retryDelay, runWebhookDispatchOnce, stopWebhookDispatch, type DispatchOptions } from "../src/services/webhookDispatch.js";
import { send, signedHeaders } from "../src/services/webhookHttp.js";
import { runDueEventsOnce } from "../src/services/dueEvents.js";
import { getMaintenanceStatus, runMaintenanceOnce, startMaintenance, stopMaintenance } from "../src/services/maintenance.js";
import { _resetMetrics } from "../src/metrics.js";

let app: FastifyInstance, fx: Fixture;
let receiver: Awaited<ReturnType<typeof webhookReceiver>>;
let cfg = loadConfig();
const saved = { ...cfg.webhooks }, savedMaintenance = { ...cfg.maintenance };
const savedBase = cfg.notify.appBaseUrl, savedZone = cfg.reminders.timeZone;
const key = Buffer.alloc(32, 9), secret = "whsec_test-current-secret";
beforeAll(async () => { app = await getApp(); cfg = loadConfig(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fx = await seedFixture(); receiver = await webhookReceiver();
  Object.assign(cfg.webhooks, { enabled: true, secretKey: key, allowHttp: true, allowedTargets: parseTargetRules("127.0.0.0/8,*.receiver.invalid"), denyCidrs: [] });
  cfg.notify.appBaseUrl = "https://taskira.example";
  _allowLoopbackForTests(true); resumeWebhookDispatch(); _resetMetrics();
});
afterEach(async () => {
  stopMaintenance();
  await stopWebhookDispatch(); await receiver.close(); _allowLoopbackForTests(false);
  Object.assign(cfg.webhooks, saved); Object.assign(cfg.maintenance, savedMaintenance);
  cfg.notify.appBaseUrl = savedBase; cfg.reminders.timeZone = savedZone;
});

async function hook(events = ["issue.created"], url = receiver.url + "?token=private-query", state = "active") {
  const id = randomUUID();
  await q(`INSERT INTO webhooks (id, project_id, name, url_enc, url_display, secret_enc, events, state)
    VALUES ($1,$2,'test',$3,$4,$5,$6,$7)`, [id, fx.projects.p1, seal(url, key, webhookSecretContext(id, "url")), redactUrl(url), seal(secret, key, webhookSecretContext(id, "secret")), events, state]);
  return id;
}
async function event(type = "issue.created", data: Record<string, unknown> = {}) {
  return (await q<{ id: string }>(`INSERT INTO integration_events (type, project_id, issue_id, issue_key, actor_id, dedupe_key, data)
    VALUES ($1,$2,$3,'CORP-1',$4,$5,$6::jsonb) RETURNING id`, [type, fx.projects.p1, fx.issues.p1issue, fx.users.emp1, "test:" + randomUUID(), JSON.stringify(data)]))[0].id;
}
const tick = (options: DispatchOptions = {}) => runWebhookDispatchOnce({ maxBatches: 1, ...options });
const deliveries = () => q<{ id: string; state: string; attempts: number; last_error: string | null; last_status: number | null; next_attempt_at: Date; response_excerpt: string }>(`SELECT * FROM webhook_deliveries ORDER BY created_at, id`);
const retryNow = () => q(`UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE state = 'pending'`);
const signature = (header: string, body: Buffer, signingSecret: string) => {
  const [time, ...signatures] = header.split(","), timestamp = Number(time.slice(2));
  expect(Math.abs(Date.now() / 1000 - timestamp)).toBeLessThan(300);
  expect(signatures).toContain("v1=" + createHmac("sha256", signingSecret).update(`${timestamp}.`).update(body).digest("hex"));
};

test("creating an issue yields one thin, signed delivery", async () => {
  await hook(); const token = await login(app, "admin");
  const created = await app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/issues`, headers: auth(token), payload: newIssue({ title: "PRIVATE_TITLE", description: "PRIVATE_DESCRIPTION" }) });
  expect(created.statusCode).toBe(201);
  expect(await tick()).toMatchObject({ events: 1, sent: 1, succeeded: 1 });
  expect(receiver.received).toHaveLength(1);
  const request = receiver.received[0];
  expect(request.headers["x-taskira-event"]).toBe("issue.created");
  expect(request.headers["x-taskira-webhook-version"]).toBe("1");
  expect(request.body.toString()).not.toContain("PRIVATE_");
  signature(String(request.headers["x-taskira-signature"]), request.body, secret);
  expect((await deliveries())[0]).toMatchObject({ state: "succeeded", attempts: 1, last_status: 200 });
});
test.each(["unsubscribed", "paused", "late"])("fan-out excludes %s subscriptions", async kind => {
  if (kind === "late") { await event(); await hook(); }
  else { await hook(kind === "unsubscribed" ? ["issue.updated"] : ["issue.created"], receiver.url, kind === "paused" ? "paused" : "active"); await event(); }
  await tick(); expect(receiver.received).toHaveLength(0); expect(await deliveries()).toHaveLength(0);
});
test("ping targets just its subscription", async () => {
  const id = await hook(); await hook(); await event("ping", { webhookId: id });
  await tick(); expect(receiver.received).toHaveLength(1);
  expect(receiver.received[0].headers["x-taskira-event"]).toBe("ping");
});
test("500 reschedules within 48–72 seconds and a subsequent attempt succeeds", async () => {
  await hook(); await event(); receiver.setReply({ status: 500 });
  const started = Date.now(); await tick();
  let row = (await deliveries())[0];
  expect(row).toMatchObject({ state: "pending", attempts: 1, last_error: "http_status", last_status: 500 });
  expect(row.next_attempt_at.getTime() - started).toBeGreaterThanOrEqual(48_000);
  expect(row.next_attempt_at.getTime() - Date.now()).toBeLessThanOrEqual(72_000);
  receiver.setReply({ status: 200 }); await retryNow(); await tick(); row = (await deliveries())[0];
  expect(row).toMatchObject({ state: "succeeded", attempts: 2 });
});
test("eight failed attempts end the delivery", async () => {
  await hook(); await event(); receiver.setReply({ status: 500 });
  for (let attempt = 1; attempt <= 8; attempt++) { await retryNow(); await tick(); expect((await deliveries())[0].attempts).toBe(attempt); }
  expect((await deliveries())[0].state).toBe("failed"); expect(receiver.received).toHaveLength(8);
});
test.each([400, 403, 404])("HTTP %i is terminal", async status => {
  await hook(); await event(); receiver.setReply({ status }); await tick();
  expect((await deliveries())[0]).toMatchObject({ state: "failed", attempts: 1, last_status: status });
});
test("429 respects Retry-After capped at an hour", async () => {
  await hook(); await event(); receiver.setReply({ status: 429, headers: { "Retry-After": "999999" } });
  await tick(); const row = (await deliveries())[0];
  expect(row.state).toBe("pending"); expect(row.next_attempt_at.getTime() - Date.now()).toBeGreaterThan(3_599_000);
  expect(row.next_attempt_at.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
  expect(retryDelay(1, new Date(Date.now() + 300_000).toUTCString())).toBeGreaterThan(298_000);
});
test("410 disables the hook and cancels remaining deliveries", async () => {
  const id = await hook(); for (let i = 0; i < 6; i++) await event(); receiver.setReply({ status: 410 });
  await tick();
  expect((await q(`SELECT state, disabled_reason FROM webhooks WHERE id=$1`, [id]))[0]).toEqual({ state: "disabled", disabled_reason: "gone" });
  const rows = await deliveries(); expect(rows.filter(row => row.state === "failed")).toHaveLength(1);
  expect(rows.filter(row => row.state === "cancelled")).toHaveLength(5);
});
test("a day-long failure streak disables the hook, cancels its queue and audits a redacted URL", async () => {
  const id = await hook(); for (let i = 0; i < 6; i++) await event();
  await q(`UPDATE webhooks SET failure_streak=19, failing_since=now()-interval '25 hours' WHERE id=$1`, [id]);
  receiver.setReply({ status: 500 }); await tick();
  expect((await q(`SELECT state, disabled_reason FROM webhooks WHERE id=$1`, [id]))[0]).toEqual({ state: "disabled", disabled_reason: "failing" });
  expect((await deliveries()).every(row => row.state === "cancelled")).toBe(true);
  const log = await q<{ details: Record<string, unknown> }>(`SELECT details FROM audit_log WHERE action='webhook.disabled'`);
  expect(log).toHaveLength(1); expect(log[0].details).toMatchObject({ reason: "failing", projectId: fx.projects.p1, urlDisplay: receiver.url });
  expect(JSON.stringify(log)).not.toContain("private-query");
});
test("a changed encryption key disables instead of sending unauthenticated traffic", async () => {
  const id = await hook(); await event(); cfg.webhooks.secretKey = Buffer.alloc(32, 8); await tick();
  expect(receiver.received).toHaveLength(0);
  expect((await deliveries())[0]).toMatchObject({ state: "failed", last_error: "secret_unavailable" });
  expect((await q(`SELECT disabled_reason FROM webhooks WHERE id=$1`, [id]))[0]).toEqual({ disabled_reason: "secret_unavailable" });
});
test("an expired sending lease repeats with the same event and delivery IDs", async () => {
  await hook(); await event(); await fanOut(); const [row] = await claimDeliveries();
  const body = JSON.stringify(row.payload);
  await send({ url: new URL(receiver.url), address: "127.0.0.1", family: 4, body,
    headers: signedHeaders(body, [secret], row.type, row.public_event_id, row.id, "test"), timeoutMs: 1000, connectTimeoutMs: 500 });
  // HTTP succeeded; process died before recordResult.
  await q(`UPDATE webhook_deliveries SET locked_until=now()-interval '1 second' WHERE id=$1`, [row.id]); await tick();
  expect(receiver.received).toHaveLength(2);
  for (const header of ["x-taskira-event-id", "x-taskira-delivery"]) expect(receiver.received[0].headers[header]).toBe(receiver.received[1].headers[header]);
  expect((await deliveries())[0]).toMatchObject({ state: "succeeded", attempts: 2 });
});
test("a stale attempt result cannot overwrite a newer claim", async () => {
  await hook(); await event(); await fanOut(); const [row] = await claimDeliveries();
  await q(`UPDATE webhook_deliveries SET attempts=attempts+1 WHERE id=$1`, [row.id]);
  expect(await recordResult(row, { status: 200, error: null, durationMs: 1, excerpt: "ok", retryAfter: null })).toBeNull();
  expect((await deliveries())[0]).toMatchObject({ state: "sending", attempts: 2 });
});
test("a failed result batch rolls back earlier updates and leaves every lease recoverable", async () => {
  await hook(); await event(); await event(); await fanOut(); const rows = await claimDeliveries();
  const success = { status: 200, error: null, durationMs: 1, excerpt: "ok", retryAfter: null };
  await expect(recordResults([{ row: rows[0], result: success },
    { row: rows[1], result: { ...success, excerpt: "x".repeat(513) } }])).rejects.toMatchObject({ code: "23514" });
  expect((await deliveries()).every(row => row.state === "sending" && row.attempts === 1)).toBe(true);
  const metrics = await app.inject({ method: "GET", url: "/metrics" });
  expect(metrics.body).not.toContain('taskira_webhook_deliveries_total{result="succeeded"}');
  await q(`UPDATE webhook_deliveries SET locked_until=now()-interval '1 second'`); await tick();
  expect((await deliveries()).every(row => row.state === "succeeded" && row.attempts === 2)).toBe(true);
});
test("concurrent fan-outs create one automatic delivery", async () => {
  await hook(); await event(); await Promise.all([fanOut(), fanOut()]); expect(await deliveries()).toHaveLength(1);
});
test("concurrent ticks share the advisory lock", async () => {
  await hook(); await event(); receiver.setReply({ delayMs: 100 });
  const results = await Promise.all([tick(), tick()]); expect(results.filter(row => row.skipped)).toHaveLength(1);
  expect(receiver.received).toHaveLength(1);
});
test("a batch sends at most four requests per subscription and leaves excess attempts untouched", async () => {
  await hook(); for (let i = 0; i < 8; i++) await event(); receiver.setReply({ delayMs: 50 }); await tick();
  expect(receiver.received).toHaveLength(4); expect(receiver.peak).toBeLessThanOrEqual(4);
  expect((await deliveries()).filter(row => row.state === "pending").every(row => row.attempts === 0)).toBe(true);
});
test("a batch sends no more than sixteen requests overall", async () => {
  for (let i = 0; i < 4; i++) await hook(); for (let i = 0; i < 4; i++) await event();
  receiver.setReply({ delayMs: 50 }); await tick(); expect(receiver.received).toHaveLength(16); expect(receiver.peak).toBeLessThanOrEqual(16);
});
test("one older backlog does not prevent a fresh subscription from receiving its event", async () => {
  await hook(); for (let i = 0; i < 32; i++) await event(); await fanOut();
  await q(`UPDATE webhook_deliveries SET next_attempt_at=now()-interval '1 hour'`);
  const fresh = await hook(["issue.updated"]); await event("issue.updated"); await tick();
  expect((await q(`SELECT state FROM webhook_deliveries WHERE webhook_id=$1`, [fresh]))[0]).toEqual({ state: "succeeded" });
});
test("round-robin grants a fifth subscription a slot even while four older backlogs remain", async () => {
  const ids = []; for (let i = 0; i < 5; i++) ids.push(await hook());
  for (let i = 0; i < 8; i++) await event(); await fanOut();
  for (let i = 0; i < ids.length; i++) await q(`UPDATE webhook_deliveries SET next_attempt_at=now()-make_interval(mins=>$2::int) WHERE webhook_id=$1`, [ids[i], 10-i]);
  await tick(); await tick();
  const delivered = await q<{ webhook_id: string }>(`SELECT DISTINCT webhook_id FROM webhook_deliveries WHERE state='succeeded'`);
  expect(delivered.map(row => row.webhook_id).sort()).toEqual(ids.sort());
});
test("the sender pins the checked address and preserves Host without environment proxies", async () => {
  const original = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY };
  try {
    process.env.HTTP_PROXY = "http://127.0.0.1:1"; process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    await hook(["issue.created"], `http://a.receiver.invalid:${receiver.port}/hook`); await event();
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]); await tick({ lookup });
    expect(lookup).toHaveBeenCalledTimes(1); expect(receiver.received[0].headers.host).toBe(`a.receiver.invalid:${receiver.port}`);
  } finally {
    for (const [name, value] of Object.entries(original)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
test("a connection failure can fall back only to another checked address", async () => {
  await hook(["issue.created"], `http://a.receiver.invalid:${receiver.port}/hook`); await event();
  await tick({ lookup: async () => [{ address: "127.0.0.2", family: 4 }, { address: "127.0.0.1", family: 4 }] });
  expect(receiver.received).toHaveLength(1); expect((await deliveries())[0].state).toBe("succeeded");
});
test("DNS is checked again on retry and a new forbidden address receives no request", async () => {
  await hook(["issue.created"], `http://a.receiver.invalid:${receiver.port}/hook`); await event();
  const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
  receiver.setReply({ status: 500 }); await tick({ lookup }); _allowLoopbackForTests(false); await retryNow(); await tick({ lookup });
  expect(lookup).toHaveBeenCalledTimes(2); expect(receiver.received).toHaveLength(1);
  expect((await deliveries())[0]).toMatchObject({ state: "failed", last_error: "target_blocked" });
});
test("DNS failures are transient and expose no resolver diagnostics", async () => {
  await hook(["issue.created"], `http://a.receiver.invalid:${receiver.port}/hook`); await event();
  await tick({ lookup: async () => { throw new Error("private resolver details"); } });
  expect((await deliveries())[0]).toMatchObject({ state: "pending", last_error: "dns", response_excerpt: "" });
});
test("HTTPS rejects an untrusted receiver certificate before sending the body", async () => {
  await receiver.close(); receiver = await webhookReceiver(true);
  await hook(["issue.created"], `https://a.receiver.invalid:${receiver.port}/hook`); await event();
  await tick({ lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
  expect(receiver.received).toHaveLength(0);
  expect((await deliveries())[0]).toMatchObject({ state: "pending", last_error: "tls", response_excerpt: "" });
});
test("redirect responses are terminal and never followed", async () => {
  await hook(); await event(); receiver.setReply({ status: 302, headers: { Location: receiver.url + "/redirected" } }); await tick();
  expect(receiver.received).toHaveLength(1); expect((await deliveries())[0]).toMatchObject({ state: "failed", last_error: "redirect" });
});
test("a megabyte response is stopped at the response limit", async () => {
  await hook(); await event(); receiver.setReply({ body: "x".repeat(1024 * 1024) }); await tick();
  expect((await deliveries())[0]).toMatchObject({ state: "failed", last_error: "too_large" });
  expect(Buffer.byteLength((await deliveries())[0].response_excerpt)).toBeLessThanOrEqual(512);
});
test("the overall timeout bounds a slow receiver", async () => {
  await hook(); await event(); receiver.setReply({ delayMs: 300 }); await tick({ timeoutMs: 80, connectTimeoutMs: 80 });
  expect((await deliveries())[0]).toMatchObject({ state: "pending", last_error: "timeout" });
});
test("response excerpts redact echoed query credentials and signatures within 512 UTF-8 bytes", async () => {
  await hook(); await event(); receiver.setHandler((request, response) => response.end("private-query " + secret + " " + request.headers["x-taskira-signature"] + "\u0000" + "Я".repeat(400)));
  await tick(); const row = (await deliveries())[0];
  expect(row.state).toBe("succeeded"); expect(row.response_excerpt).not.toContain("private-query");
  expect(row.response_excerpt).not.toContain("v1="); expect(row.response_excerpt).not.toContain("\u0000");
  expect(row.response_excerpt).not.toContain(secret);
  expect(Buffer.byteLength(row.response_excerpt)).toBeLessThanOrEqual(512);
});
test("excerpt masking does not re-expand a short query value inside the replacement", async () => {
  await hook(["issue.created"], receiver.url + "?key=e"); await event(); receiver.setReply({ body: "e".repeat(128) });
  await tick(); expect((await deliveries())[0]).toMatchObject({ state: "succeeded" });
  expect((await deliveries())[0].response_excerpt).toBe("[redacted]".repeat(128).slice(0, 512));
});
test("rotation signs with both current and unexpired previous secrets", async () => {
  const id = await hook(), old = "whsec_test-previous-secret";
  await q(`UPDATE webhooks SET prev_secret_enc=$2, prev_secret_until=now()+interval '24 hours' WHERE id=$1`, [id, seal(old, key, webhookSecretContext(id, "secret"))]);
  await event(); await tick(); const request = receiver.received[0];
  signature(String(request.headers["x-taskira-signature"]), request.body, secret);
  signature(String(request.headers["x-taskira-signature"]), request.body, old);
  expect(String(request.headers["x-taskira-signature"]).split(",")).toHaveLength(3);
});
test("an expired previous secret is not decrypted or included in the signature", async () => {
  const id = await hook();
  await q(`UPDATE webhooks SET prev_secret_enc='unavailable', prev_secret_until=now()-interval '1 second' WHERE id=$1`, [id]);
  await event(); await tick();
  expect((await deliveries())[0].state).toBe("succeeded");
  const request = receiver.received[0]; signature(String(request.headers["x-taskira-signature"]), request.body, secret);
  expect(String(request.headers["x-taskira-signature"]).split(",")).toHaveLength(2);
});
test("a shutdown aborts active HTTP and leaves a recoverable lease", async () => {
  await hook(); await event(); receiver.setReply({ delayMs: 5000 }); const running = tick();
  await vi.waitFor(() => expect(receiver.received).toHaveLength(1));
  const started = Date.now(); await stopWebhookDispatch(); await running;
  expect(Date.now() - started).toBeLessThan(3000); expect((await deliveries())[0].state).toBe("sending");
  receiver.setReply({}); resumeWebhookDispatch();
  await q(`UPDATE webhook_deliveries SET locked_until=now()-interval '1 second'`); await tick();
  expect((await deliveries())[0].state).toBe("succeeded");
});
test("due events use the installation date and deduplicate across more than one batch", async () => {
  await hook(["issue.due"]); cfg.reminders.timeZone = "America/Los_Angeles";
  await q(`INSERT INTO issues (project_id,num,key,title,type_id,priority_id,status_id,reporter_id,rank,due_date)
    SELECT $1,n,'CORP-'||n,'due-'||n,'task','medium',$2,$3,n,'2026-10-05'::date FROM generate_series(100,1100) n`, [fx.projects.p1, fx.p1status.todo, fx.users.emp1]);
  expect(await runDueEventsOnce(new Date("2026-10-06T05:00:00Z"))).toBe(1001);
  expect(await runDueEventsOnce(new Date("2026-10-06T05:00:00Z"))).toBe(0);
  expect((await q<{ count: string }>(`SELECT count(*)::text FROM integration_events WHERE type='issue.due'`))[0].count).toBe("1001");
});
test("closed, archived and unsubscribed issues do not emit due events", async () => {
  await hook(["issue.due"]); const date = "2026-10-05";
  await q(`UPDATE issues SET due_date=$1::date`, [date]);
  await q(`UPDATE issues SET status_id=(SELECT id FROM workflow_statuses WHERE project_id=$1 AND category='done' LIMIT 1) WHERE id=$2`, [fx.projects.p1, fx.issues.p1issue]);
  expect(await runDueEventsOnce(new Date("2026-10-05T06:00:00Z"))).toBe(0);
  await q(`UPDATE issues SET status_id=$1, archived_at=now() WHERE id=$2`, [fx.p1status.todo, fx.issues.p1issue]);
  expect(await runDueEventsOnce(new Date("2026-10-05T06:00:00Z"))).toBe(0);
});
test("retention removes expired events and cascades deliveries in batches, including while webhooks are disabled", async () => {
  await hook(); for (let i = 0; i < 5; i++) await event(); await fanOut();
  await q(`UPDATE integration_events SET occurred_at=now()-interval '40 days'`); await event();
  cfg.webhooks.enabled = false; Object.assign(cfg.maintenance, { batchSize: 2, batchPauseMs: 0, maxPerRun: 100 });
  await runMaintenanceOnce({ dryRun: true }); expect(await deliveries()).toHaveLength(5);
  await runMaintenanceOnce(); expect(await deliveries()).toHaveLength(0);
  expect((await q<{ count: string }>(`SELECT count(*)::text FROM integration_events`))[0].count).toBe("1");
});
test("successful and failed attempts, queue age and outbox are exported as bounded-label metrics", async () => {
  await hook(); await event(); await tick(); receiver.setReply({ status: 500 }); await event(); await tick();
  const response = await app.inject({ method: "GET", url: "/metrics" });
  expect(response.body).toContain('taskira_webhook_deliveries_total{result="succeeded"} 1');
  expect(response.body).toContain('taskira_webhook_deliveries_total{result="retry"} 1');
  expect(response.body).toContain('taskira_webhook_queue_size 1');
  expect(response.body).toContain('taskira_integration_outbox_undispatched 0');
  expect(response.body).toContain('taskira_webhook_delivery_duration_seconds_count 2');
  expect(response.body).not.toContain("private-query");
});
test("disabled webhooks perform no fan-out, HTTP or due-event work", async () => {
  await hook(); await event(); cfg.webhooks.enabled = false;
  expect(await tick()).toMatchObject({ skipped: true, events: 0, sent: 0 });
  expect(await runDueEventsOnce()).toBe(0); expect(await deliveries()).toHaveLength(0);
});
test("maintenance registers both webhook jobs with staggered startup", () => {
  Object.assign(cfg.maintenance, { enabled: true, startDelayMs: 60_000, storageSweepEnabled: false });
  const before = Date.now(); startMaintenance();
  const jobs = getMaintenanceStatus().jobs;
  expect(jobs.find(job => job.name === "webhook-dispatch")).toMatchObject({ intervalMs: cfg.webhooks.pollMs, lastRunAt: null });
  expect(jobs.find(job => job.name === "due-events")).toMatchObject({ intervalMs: 600_000, lastRunAt: null });
  expect(Date.parse(jobs.find(job => job.name === "webhook-dispatch")!.nextRunAt!)).toBeGreaterThanOrEqual(before + 80_000);
  expect(Date.parse(jobs.find(job => job.name === "due-events")!.nextRunAt!)).toBeGreaterThanOrEqual(before + 85_000);
});
