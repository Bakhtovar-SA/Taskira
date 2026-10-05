import { createHmac, randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { webhookReceiver } from "./helpers/webhookReceiver.js";
import { loadConfig } from "../src/config.js";
import { _allowLoopbackForTests, parseTargetRules } from "../src/services/egress.js";
import { _setWebhookLookupForTests } from "../src/services/webhooks.js";
import { resumeWebhookDispatch, runWebhookDispatchOnce, stopWebhookDispatch, fanOut } from "../src/services/webhookDispatch.js";
import { WebhookDto, WebhookDeliveryDetailDto } from "../src/contract.js";
import { open, webhookSecretContext } from "../src/services/secretBox.js";

let app: FastifyInstance, fx: Fixture, admin: string;
let receiver: Awaited<ReturnType<typeof webhookReceiver>>;
let cfg = loadConfig(); const saved = { ...cfg.webhooks }, key = Buffer.alloc(32,9);
const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
beforeAll(async () => { app = await getApp(); cfg = loadConfig(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fx = await seedFixture(); receiver = await webhookReceiver(); admin = await login(app,"admin");
  Object.assign(cfg.webhooks,{ enabled: true,secretKey: key,allowHttp: true,allowedTargets: parseTargetRules("127.0.0.0/8,*.corp.local"),denyCidrs: [] });
  _allowLoopbackForTests(true); _setWebhookLookupForTests(lookup); resumeWebhookDispatch();
});
afterEach(async () => {
  await stopWebhookDispatch(); await receiver.close(); _setWebhookLookupForTests(undefined); _allowLoopbackForTests(false);
  Object.assign(cfg.webhooks,saved);
});
const base = () => `/api/projects/${fx.projects.p1}/webhooks`;
const body = () => ({ name: "Test hook",url: receiver.url,events: ["issue.created"] });
const request = (method: InjectOptions["method"],url: string,payload?: unknown,token=admin) =>
  app.inject({ method,url,headers: auth(token),...(payload === undefined ? {} : { payload: payload as object }) });
async function create(overrides: Record<string,unknown> = {}) {
  const response = await request("POST",base(),{ ...body(),...overrides }); expect(response.statusCode).toBe(201);
  return response.json<{ webhook: { id: string }; secret: string }>();
}
const dispatch = () => runWebhookDispatchOnce({ maxBatches: 1,lookup });
async function ping(id: string) {
  const response = await request("POST",base()+`/${id}/ping`); expect(response.statusCode).toBe(202);
  return response.json<{ deliveryId: string }>().deliveryId;
}
const signature = (header: string,body: Buffer,secret: string) => {
  const [time,...signatures] = header.split(",");
  expect(signatures).toContain("v1="+createHmac("sha256",secret).update(time.slice(2)+".").update(body).digest("hex"));
};

test.each(["mgr1","emp1","viw1"])("%s receives 403 on every integration route",async role => {
  const { webhook } = await create(), delivery = await ping(webhook.id), token = await login(app,role);
  const path = base()+`/${webhook.id}`;
  const routes: [InjectOptions["method"],string,unknown?][] = [
    ["GET","/api/integrations/config"],["GET",base()],["POST",base(),body()],
    ["PATCH",path,{ name: "Changed" }],["DELETE",path],["POST",path+"/rotate-secret"],["POST",path+"/ping"],
    ["GET",path+"/deliveries"],["GET",path+`/deliveries/${delivery}`],["POST",path+`/deliveries/${delivery}/redeliver`],
    ["POST",path+"/redeliver-failed",{ since: new Date(Date.now()-86400_000).toISOString() }],
  ];
  for (const [method,url,payload] of routes) expect((await request(method,url,payload,token)).statusCode,`${method} ${url}`).toBe(403);
  expect((await q(`SELECT id FROM webhooks`)).length).toBe(1);
});

test("global administrator can use every route; secrets and query remain private",async () => {
  const response = await request("POST",base(),{ ...body(),url: "https://hooks.corp.local/x?token=abc" });
  expect(response.statusCode).toBe(201); expect(response.headers["cache-control"]).toBe("no-store");
  const { webhook,secret } = response.json(); const path = base()+`/${webhook.id}`;
  expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/); expect(WebhookDto.safeParse(webhook).success).toBe(true);
  expect(webhook.urlDisplay).toBe("https://hooks.corp.local/x");
  expect((await request("GET","/api/integrations/config")).json()).toMatchObject({ webhooksEnabled: true,allowHttp: true,allowedTargets: ["127.0.0.0/8","*.corp.local"] });
  expect((await request("PATCH",path,{ name: "Changed",url: receiver.url+"?token=abc" })).statusCode).toBe(200);
  const rotated = await request("POST",path+"/rotate-secret"); expect(rotated.statusCode).toBe(200);
  const rotation = rotated.json(); expect(rotation.secret).not.toBe(secret); expect(Date.parse(rotation.previousValidUntil)-Date.now()).toBeGreaterThan(23*3600_000);
  const deliveryId = await ping(webhook.id); await dispatch();
  signature(String(receiver.received[0].headers["x-taskira-signature"]),receiver.received[0].body,secret);
  signature(String(receiver.received[0].headers["x-taskira-signature"]),receiver.received[0].body,rotation.secret);
  expect(receiver.received[0].headers["x-taskira-event"]).toBe("ping");
  const details = await request("GET",path+`/deliveries/${deliveryId}`);
  expect(details.statusCode).toBe(200); expect(WebhookDeliveryDetailDto.safeParse(details.json()).success).toBe(true);
  expect(details.json()).toMatchObject({ state: "succeeded",payload: { type: "ping" },headers: { "X-Taskira-Event": "ping" } });
  expect(Object.keys(details.json().headers).some(name => name.toLowerCase()==="x-taskira-signature")).toBe(false);
  const redo = await request("POST",path+`/deliveries/${deliveryId}/redeliver`); expect(redo.statusCode).toBe(202);
  await dispatch(); expect(receiver.received).toHaveLength(2);
  expect(receiver.received[1].headers["x-taskira-event-id"]).toBe(receiver.received[0].headers["x-taskira-event-id"]);
  expect(receiver.received[1].headers["x-taskira-delivery"]).not.toBe(deliveryId);
  const retry = await request("POST",path+"/redeliver-failed",{ since: new Date(Date.now()-86400_000).toISOString() });
  expect(retry.statusCode).toBe(202); expect(retry.json()).toEqual({ count: 0 });
  const allGet = [(await request("GET",base())).body,(await request("GET",path+"/deliveries")).body,details.body];
  const audit = JSON.stringify(await q(`SELECT details FROM audit_log`));
  for (const text of [...allGet,audit]) for (const value of [secret,rotation.secret,"whsec_","?token=",'"abc"'])
    expect(text).not.toContain(value);
  const encrypted = (await q<{ url_enc: string; secret_enc: string }>(`SELECT url_enc,secret_enc FROM webhooks WHERE id=$1`,[webhook.id]))[0];
  expect(open(encrypted.url_enc,key,webhookSecretContext(webhook.id,"url"))).toBe(receiver.url+"?token=abc");
  expect(encrypted.secret_enc).not.toContain(rotation.secret);
  expect((await request("DELETE",path)).statusCode).toBe(204); expect(await q(`SELECT id FROM webhook_deliveries`)).toHaveLength(0);
});

test("feature off rejects creation and ping but keeps journal and deletion available",async () => {
  const { webhook } = await create(); cfg.webhooks.enabled=false;
  for (const response of [await request("POST",base(),body()),await request("POST",base()+`/${webhook.id}/ping`)]) {
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("WEBHOOKS_DISABLED");
  }
  expect((await request("GET",base())).statusCode).toBe(200);
  expect((await request("GET",base()+`/${webhook.id}/deliveries`)).statusCode).toBe(200);
  expect((await request("DELETE",base()+`/${webhook.id}`)).statusCode).toBe(204);
});

test.each(["https://unlisted.example/x","http://hooks.corp.local/x","https://user:pw@hooks.corp.local/x"])("invalid target %s has a generic safe error",async url => {
  cfg.webhooks.allowHttp=false; cfg.webhooks.allowedTargets=parseTargetRules("*.corp.local");
  const response = await request("POST",base(),{ ...body(),url });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe("WEBHOOK_TARGET_NOT_ALLOWED");
  expect(response.body).not.toContain(url); expect(await q(`SELECT id FROM webhooks`)).toHaveLength(0);
});

test("URL patches use the same target checks and preserve the existing destination on rejection",async () => {
  const { webhook }=await create(), path=base()+`/${webhook.id}`;
  cfg.webhooks.allowedTargets=parseTargetRules("*.corp.local");
  const response=await request("PATCH",path,{ url:"https://unlisted.example/x?token=PRIVATE_QUERY" });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe("WEBHOOK_TARGET_NOT_ALLOWED");
  expect(response.body).not.toContain("PRIVATE_QUERY");
  const [row]=await q<{ url_enc: string }>(`SELECT url_enc FROM webhooks WHERE id=$1`,[webhook.id]);
  expect(open(row.url_enc,key,webhookSecretContext(webhook.id,"url"))).toBe(receiver.url);
});

test("concurrent creation cannot exceed ten subscriptions per project",async () => {
  const responses = await Promise.all(Array.from({ length: 18 },(_,n) => request("POST",base(),{ ...body(),name: "Hook "+n })));
  expect(responses.filter(r=>r.statusCode===201)).toHaveLength(10);
  for (const response of responses.filter(r=>r.statusCode!==201)) { expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("WEBHOOK_LIMIT"); }
  expect(await q(`SELECT id FROM webhooks`)).toHaveLength(10);
});

test("installation limit is enforced across projects",async () => {
  const { webhook } = await create();
  await q(`INSERT INTO webhooks(project_id,name,url_enc,url_display,secret_enc,events)
    SELECT $1,'limit',url_enc,url_display,secret_enc,events FROM webhooks CROSS JOIN generate_series(1,99) WHERE id=$2`,[fx.projects.p2,webhook.id]);
  const response = await request("POST",base(),body()); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("WEBHOOK_LIMIT");
});

test("paused and disabled subscriptions cannot send; resume clears failure state",async () => {
  const { webhook } = await create(), path = base()+`/${webhook.id}`, deliveryId = await ping(webhook.id);
  expect((await request("PATCH",path,{ state: "paused" })).statusCode).toBe(200);
  expect((await q<{ state: string }>(`SELECT state FROM webhook_deliveries WHERE id=$1`,[deliveryId]))[0].state).toBe("cancelled");
  for (const url of [path+"/ping",path+`/deliveries/${deliveryId}/redeliver`,path+"/redeliver-failed"]) {
    const response = await request("POST",url,url.endsWith("redeliver-failed") ? { since: new Date().toISOString() } : undefined);
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("WEBHOOK_NOT_ACTIVE");
  }
  await q(`UPDATE webhooks SET state='disabled',disabled_reason='failing',failure_streak=20,failing_since=now()-interval '2 days' WHERE id=$1`,[webhook.id]);
  expect((await request("PATCH",path,{ state: "disabled" })).statusCode).toBe(400);
  const resumed = await request("PATCH",path,{ state: "active" }); expect(resumed.statusCode).toBe(200);
  expect(resumed.json()).toMatchObject({ state: "active",disabledReason: null,failureStreak: 0 });
  expect((await q(`SELECT failing_since FROM webhooks WHERE id=$1`,[webhook.id]))[0]).toEqual({ failing_since: null });
  await ping(webhook.id);
});

test("bulk redelivery rejects old timestamps and creates at most one thousand manual rows",async () => {
  const { webhook } = await create(), path = base()+`/${webhook.id}`, deliveryId = await ping(webhook.id);
  await q(`UPDATE webhook_deliveries SET state='failed' WHERE id=$1`,[deliveryId]);
  await q(`INSERT INTO webhook_deliveries(webhook_id,event_id,state,manual)
    SELECT webhook_id,event_id,'cancelled',true FROM webhook_deliveries CROSS JOIN generate_series(1,1499) WHERE id=$1`,[deliveryId]);
  expect((await request("POST",path+"/redeliver-failed",{ since: new Date(Date.now()-8*86400_000).toISOString() })).statusCode).toBe(400);
  const response = await request("POST",path+"/redeliver-failed",{ since: new Date(Date.now()-86400_000).toISOString() });
  expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ count: 1000 });
  expect((await q<{ n: number }>(`SELECT count(*)::int n FROM webhook_deliveries WHERE manual AND state='pending'`))[0].n).toBe(1000);
});

test("bulk redelivery without since uses the database's last 24 hours",async () => {
  const { webhook } = await create(), deliveryId = await ping(webhook.id);
  await q(`UPDATE webhook_deliveries SET state='failed' WHERE id=$1`,[deliveryId]);
  await q(`INSERT INTO webhook_deliveries(webhook_id,event_id,state,manual,created_at)
    SELECT webhook_id,event_id,'cancelled',true,now()-interval '23 hours' FROM webhook_deliveries WHERE id=$1`,[deliveryId]);
  await q(`INSERT INTO webhook_deliveries(webhook_id,event_id,state,manual,created_at)
    SELECT webhook_id,event_id,'failed',true,now()-interval '25 hours' FROM webhook_deliveries WHERE id=$1`,[deliveryId]);
  const response = await request("POST",base()+`/${webhook.id}/redeliver-failed`,{});
  expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ count: 2 });
  expect((await q<{ n: number }>(`SELECT count(*)::int n FROM webhook_deliveries WHERE manual AND state='pending'`))[0].n).toBe(2);
});

test("cursor preserves microseconds and UUID ties without duplicates or gaps",async () => {
  const { webhook } = await create(), deliveryId = await ping(webhook.id), path=base()+`/${webhook.id}/deliveries`;
  await q(`UPDATE webhook_deliveries SET created_at='2026-10-05T00:00:00.000004Z' WHERE id=$1`,[deliveryId]);
  await q(`INSERT INTO webhook_deliveries(webhook_id,event_id,manual,created_at)
    SELECT webhook_id,event_id,true,'2026-10-05T00:00:00.000001Z'::timestamptz + (n/2)*interval '1 microsecond'
    FROM webhook_deliveries CROSS JOIN generate_series(1,5) n WHERE id=$1`,[deliveryId]);
  const expected = (await q<{ id: string }>(`SELECT id FROM webhook_deliveries ORDER BY created_at DESC,id DESC`)).map(row=>row.id);
  const seen: string[]=[]; let cursor: string|null=null;
  do {
    const response = await request("GET",path+"?limit=2"+(cursor ? "&cursor="+cursor : "")); expect(response.statusCode).toBe(200);
    const page = response.json(); seen.push(...page.items.map((row: { id: string })=>row.id)); cursor=page.nextCursor;
  } while (cursor);
  expect(seen).toEqual(expected);
  for (const query of ["cursor=broken","limit=101","state=unknown","cursor="+Buffer.from(JSON.stringify({at:"bad",id:randomUUID()})).toString("base64url")])
    expect((await request("GET",path+"?"+query)).statusCode).toBe(400);
  await q(`UPDATE webhook_deliveries SET state='failed' WHERE id=$1`,[deliveryId]);
  expect((await request("GET",path+"?state=failed")).json().items.map((row: { id: string })=>row.id)).toEqual([deliveryId]);
});

test("project and subscription scope produce 404, including delivery IDs from another subscription",async () => {
  const first = await create(), second = await create(), deliveryId=await ping(first.webhook.id);
  expect((await request("GET",`/api/projects/${randomUUID()}/webhooks`)).statusCode).toBe(404);
  const wrongProject=`/api/projects/${fx.projects.p2}/webhooks/${first.webhook.id}`;
  for (const [method,suffix,payload] of [["PATCH","",{name:"x"}],["DELETE",""],["POST","/rotate-secret"],["POST","/ping"],["GET","/deliveries"],["GET",`/deliveries/${deliveryId}`],["POST",`/deliveries/${deliveryId}/redeliver`],["POST","/redeliver-failed",{since:new Date().toISOString()}]] as const)
    expect((await request(method,wrongProject+suffix,payload)).statusCode).toBe(404);
  expect((await request("GET",base()+`/${second.webhook.id}/deliveries/${deliveryId}`)).statusCode).toBe(404);
  expect((await request("POST",base()+`/${second.webhook.id}/deliveries/${deliveryId}/redeliver`)).statusCode).toBe(404);
});

test("uppercase UUID spelling cannot break encrypted field contexts",async () => {
  const { webhook }=await create(), path=base()+`/${webhook.id.toUpperCase()}`;
  expect((await request("PATCH",path,{url:receiver.url+"?token=abc"})).statusCode).toBe(200);
  const rotate=await request("POST",path+"/rotate-secret"); expect(rotate.statusCode).toBe(200);
  const response=await request("POST",path+"/ping"); expect(response.statusCode).toBe(202); await dispatch();
  expect(receiver.received).toHaveLength(1); signature(String(receiver.received[0].headers["x-taskira-signature"]),receiver.received[0].body,rotate.json().secret);
});

test("ping is immediately materialized even behind a full undispatched page",async () => {
  const { webhook }=await create();
  await q(`INSERT INTO integration_events(type,project_id,dedupe_key) SELECT 'issue.created',$1,'backlog:'||n FROM generate_series(1,501)n`,[fx.projects.p1]);
  const deliveryId=await ping(webhook.id);
  expect((await q<{ type: string }>(`SELECT e.type FROM webhook_deliveries d JOIN integration_events e ON e.id=d.event_id WHERE d.id=$1`,[deliveryId]))[0].type).toBe("ping");
  expect((await q<{ n: number }>(`SELECT count(*)::int n FROM integration_events WHERE dispatched_at IS NULL`))[0].n).toBe(501);
  await fanOut();
});
