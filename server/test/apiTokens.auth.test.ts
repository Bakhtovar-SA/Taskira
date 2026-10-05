import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, newIssue, type Fixture } from "./helpers.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { withTransaction } from "../src/db.js";
import * as db from "../src/db.js";
import { generateToken, parseToken, verifyToken, peekVerified, invalidateToken, invalidateUserTokens } from "../src/services/apiTokens.js";
import { invalidateUserCache, invalidateMembership } from "../src/middleware.js";
import { emit } from "../src/services/notify.js";
import { resolveVisibleMentions } from "../src/services/mentions.js";
import { provisionFromLdap } from "../src/services/userProvisioning.js";
import { countActiveSeats } from "../src/services/license.js";
import { runMaintenanceOnce } from "../src/services/maintenance.js";
import { runDueRemindersOnce } from "../src/services/dueReminders.js";

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
let app: FastifyInstance, catalog: FastifyInstance, fx: Fixture;
const routes: { method: string; url: string }[] = [];
const extraApps: FastifyInstance[] = [];
let cfg = loadConfig(); const savedRate = { ...cfg.rateLimit }, savedReminders = { ...cfg.reminders };
beforeAll(async () => {
  app = await getApp(); cfg = loadConfig();
  catalog = buildApp();
  catalog.addHook("onRoute", route => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url });
  });
  await catalog.ready();
});
afterAll(async () => { await catalog.close(); await stopApp(); });
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });
afterEach(async () => {
  for (const other of extraApps.splice(0)) await other.close();
  for (const userId of Object.values(fx.users)) { invalidateUserTokens(userId); invalidateUserCache(userId); }
  Object.assign(cfg.rateLimit,savedRate); Object.assign(cfg.reminders,savedReminders); vi.restoreAllMocks();
});
async function tokenFor(userId: string, scope: "read" | "write" = "write", dates = { created: new Date(), expires: new Date(Date.now()+86400_000) }) {
  const generated = generateToken();
  const [row] = await q<{ id: string }>(`INSERT INTO api_tokens(user_id,name,prefix,secret_hash,scope,created_by,created_at,expires_at)
    VALUES($1,'Test',$2,$3,$4,$1,$5,$6) RETURNING id`,[userId,generated.prefix,generated.hash,scope,dates.created,dates.expires]);
  return { ...generated, id: row.id };
}
const issuePath = () => `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`;
const request = (token: string, method: InjectOptions["method"],url: string,payload?: object, server=app) =>
  server.inject({ method,url,headers:auth(token),...(payload === undefined ? {} : { payload }) });

test("generated credentials have a canonical 256-bit secret and only its hash is persisted",async () => {
  const credential = await tokenFor(fx.users.emp1), parsed = parseToken(credential.token)!;
  expect(parsed.prefix).toMatch(/^[a-z0-9]{8}$/); expect(Buffer.from(parsed.secret,"base64url")).toHaveLength(32);
  const [row] = await q<{ secret_hash:Buffer }>(`SELECT secret_hash FROM api_tokens WHERE id=$1`,[credential.id]);
  expect(row.secret_hash).toEqual(createHash("sha256").update(parsed.secret).digest());
  expect(row.secret_hash).toHaveLength(32);
  for (const malformed of [credential.token+"\n",credential.token+"=",credential.token.slice(0,-1),credential.token.replace(/^tsk_/,"TSK_")])
    expect(parseToken(malformed)).toBeNull();
});

test.each(["read","write"] as const)("employee %s token obeys scope, issue ownership and session/admin guards",async scope => {
  const credential = await tokenFor(fx.users.emp1,scope);
  expect((await request(credential.token,"GET",`/api/projects/${fx.projects.p1}/issues`)).statusCode).toBe(200);
  const own = await request(credential.token,"PATCH",issuePath(),{ title: "Own edit" });
  expect(own.statusCode).toBe(scope === "read" ? 403 : 200);
  if (scope === "read") expect(own.json().error.code).toBe("TOKEN_SCOPE");
  await q(`UPDATE issues SET reporter_id=$2 WHERE id=$1`,[fx.issues.p1issue,fx.users.mgr1]);
  await q(`DELETE FROM issue_assignees WHERE issue_id=$1`,[fx.issues.p1issue]);
  const foreign = await request(credential.token,"PATCH",issuePath(),{ title: "Foreign edit" });
  expect(foreign.statusCode).toBe(403); expect(foreign.json().error.code).toBe(scope === "read" ? "TOKEN_SCOPE" : "FORBIDDEN");
  const protectedRoutes: [InjectOptions["method"],string,object?][] = [
    ["GET","/api/maintenance"],["GET","/api/admin/export"],["POST","/api/auth/logout"],
    ["GET","/api/auth/me"],["GET","/api/auth/config"],["PUT","/api/me/lang",{ lang: "en" }],
    ["GET","/api/me/onboarding"],["DELETE","/api/me/avatar"],
    ["POST",`/api/projects/${fx.projects.p1}/webhooks`,{ name:"Hook",url:"https://hooks.example/x",events:["issue.created"] }],
  ];
  for (const [method,url,payload] of protectedRoutes) {
    const denied = await request(credential.token,method,url,payload);
    expect(denied.statusCode,url).toBe(403); expect(denied.json().error.code,url).toBe("TOKEN_NOT_ALLOWED");
  }
  expect(own.headers["set-cookie"]).toBeUndefined();
  if (scope === "read") {
    const audits = await q<{ details: Record<string,unknown> }>(`SELECT details FROM audit_log WHERE action='token.denied' AND entity_id=$1`,[credential.id]);
    expect(audits).toHaveLength(1); expect(audits[0].details).toMatchObject({ reason:"scope",via:"token",tokenId:credential.id });
  }
});

test("an administrator token has only member visibility and employee rights; the session still has admin rights",async () => {
  await q(`INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'employee')`,[fx.projects.p2,fx.users.admin]);
  invalidateMembership(fx.users.admin,fx.projects.p2);
  const credential = await tokenFor(fx.users.admin), session = await login(app,"admin");
  const projects = await request(credential.token,"GET","/api/projects");
  expect(projects.statusCode).toBe(200); expect(JSON.stringify(projects.json())).toContain(fx.projects.p2);
  expect(JSON.stringify(projects.json())).not.toContain(fx.projects.p1);
  expect([403,404]).toContain((await request(credential.token,"GET",`/api/projects/${fx.projects.p1}/issues`)).statusCode);
  const foreignPath = `/api/projects/${fx.projects.p2}/issues/${fx.issues.p2issue}`;
  expect((await request(credential.token,"PATCH",foreignPath,{ title:"Token edit" })).statusCode).toBe(403);
  expect((await request(credential.token,"PUT",`/api/projects/${fx.projects.p2}/members/${fx.users.outsider}`,{ role:"viewer" })).statusCode).toBe(403);
  expect((await request(credential.token,"GET","/api/maintenance")).json().error.code).toBe("TOKEN_NOT_ALLOWED");
  for (const url of ["/api/roadmap","/api/reports/summary?from=2026-01-01&to=2026-12-31","/api/issues/search?q=t"]) {
    const response = await request(credential.token,"GET",url); expect(response.statusCode,url).toBe(200);
    expect(response.body,url).not.toContain(fx.projects.p1); expect(response.body,url).toContain(fx.projects.p2);
  }
  const dashboard = await request(session,"POST","/api/dashboards",{ name:"Shared",shared:true,widgets:[] });
  expect(dashboard.statusCode).toBe(201);
  expect((await request(credential.token,"PATCH",`/api/dashboards/${dashboard.json().id}`,{ name:"Token rename" })).statusCode).toBe(403);
  expect((await request(session,"PATCH",foreignPath,{ title:"Session edit" })).statusCode).toBe(200);
  expect((await request(session,"GET","/api/projects")).body).toContain(fx.projects.p1);
});

test("invalid, unknown, expired and revoked credentials have the same generic response",async () => {
  const valid = await tokenFor(fx.users.emp1), expired = await tokenFor(fx.users.emp1,"write",{ created:new Date(Date.now()-2*86400_000),expires:new Date(Date.now()-86400_000) });
  const revoked = await tokenFor(fx.users.emp1); await q(`UPDATE api_tokens SET revoked_at=now() WHERE id=$1`,[revoked.id]);
  const wrong = `tsk_${valid.prefix}_${generateToken().token.slice(13)}`;
  const failures = [];
  for (const raw of [wrong,generateToken().token,expired.token,revoked.token,"tsk_bad"]) {
    const response = await request(raw,"GET","/api/projects"); expect(response.statusCode).toBe(401); failures.push(response.json());
  }
  for (const failure of failures) expect(failure).toEqual(failures[0]);
  expect(await verifyToken(valid.token)).toMatchObject({ userId:fx.users.emp1 });
  expect(peekVerified(wrong)).toBeNull(); expect(peekVerified(valid.token)).not.toBeNull();
});

test("revocation invalidation is immediate and absolute expiry is enforced inside the positive cache",async () => {
  const credential = await tokenFor(fx.users.emp1);
  expect(await verifyToken(credential.token)).not.toBeNull();
  const future = Date.now()+2*86400_000; vi.spyOn(Date,"now").mockReturnValue(future);
  expect(peekVerified(credential.token)).toBeNull(); expect(await verifyToken(credential.token)).toBeNull(); vi.restoreAllMocks();
  expect(await verifyToken(credential.token)).not.toBeNull();
  await q(`UPDATE api_tokens SET revoked_at=now() WHERE id=$1`,[credential.id]); invalidateToken(credential.prefix);
  expect((await request(credential.token,"GET","/api/projects")).statusCode).toBe(401);
});

test("logout leaves API credentials valid; deactivation invalidates the user's token cache immediately",async () => {
  const credential = await tokenFor(fx.users.emp1), session = await login(app,"emp1"), admin = await login(app,"admin");
  expect((await request(credential.token,"GET","/api/projects")).statusCode).toBe(200);
  expect((await request(session,"POST","/api/auth/logout")).statusCode).toBe(204);
  expect((await request(credential.token,"GET","/api/projects")).statusCode).toBe(200);
  const deactivated = await request(admin,"PATCH",`/api/users/${fx.users.emp1}`,{ globalRole:"member",isActive:false });
  expect(deactivated.statusCode).toBe(200); expect(peekVerified(credential.token)).toBeNull();
  expect((await request(credential.token,"GET","/api/projects")).statusCode).toBe(401);
});

test("a credential revoked during database verification cannot repopulate the cache",async () => {
  const credential = await tokenFor(fx.users.emp1);
  const [row] = await q(`SELECT id,user_id,prefix,secret_hash,scope,expires_at,revoked_at FROM api_tokens WHERE id=$1`,[credential.id]);
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  vi.spyOn(db,"one").mockImplementationOnce(async () => pending as never);
  const verification = verifyToken(credential.token);
  await q(`UPDATE api_tokens SET revoked_at=now() WHERE id=$1`,[credential.id]); invalidateToken(credential.prefix); release(row);
  expect(await verification).toBeNull(); expect(peekVerified(credential.token)).toBeNull();
});

test("a user lookup started before deactivation cannot restore stale active state",async () => {
  const credential = await tokenFor(fx.users.emp1); await verifyToken(credential.token);
  const [row] = await q(`SELECT global_role,is_active,session_version,name FROM users WHERE id=$1`,[fx.users.emp1]);
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  const lookup = vi.spyOn(db,"one").mockImplementationOnce(async () => pending as never);
  const response = request(credential.token,"GET","/api/projects");
  await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
  await q(`UPDATE users SET is_active=false WHERE id=$1`,[fx.users.emp1]); invalidateUserCache(fx.users.emp1); release(row);
  expect((await response).statusCode).toBe(401);
});

test("expiry after the limiter verified the token is rechecked before the handler",async () => {
  const credential = await tokenFor(fx.users.emp1); await verifyToken(credential.token);
  Object.assign(cfg.rateLimit,{ enabled:true,max:3,windowMs:60_000 });
  const server = buildApp(); extraApps.push(server);
  server.addHook("preValidation",async () => { vi.spyOn(Date,"now").mockReturnValue(Date.now()+2*86400_000); });
  await server.ready(); expect((await request(credential.token,"GET","/api/projects",undefined,server)).statusCode).toBe(401);
});

test("last use is written at most once a minute and issue/comment/bulk audit keeps token attribution",async () => {
  const credential = await tokenFor(fx.users.mgr1), writes = vi.spyOn(db,"q");
  for (let i=0;i<2;i++) expect((await request(credential.token,"GET","/api/projects")).statusCode).toBe(200);
  await vi.waitFor(async () => {
    const [used] = await q<{ last_used_at:Date|null; last_used_ip:string|null }>(`SELECT last_used_at,last_used_ip FROM api_tokens WHERE id=$1`,[credential.id]);
    expect(used.last_used_at).not.toBeNull(); expect(used.last_used_ip).toBe("127.0.0.1");
  });
  expect(writes.mock.calls.filter(([sql]) => String(sql).includes("UPDATE api_tokens SET last_used_at"))).toHaveLength(1);
  expect((await request(credential.token,"PATCH",issuePath(),{ title:"Audit edit" })).statusCode).toBe(200);
  expect((await request(credential.token,"POST",issuePath()+"/comments",{ body:"Audit comment" })).statusCode).toBe(201);
  // manageAccess belongs only to global admin, so even a manager's write token cannot mutate membership.
  expect((await request(credential.token,"PUT",`/api/projects/${fx.projects.p1}/members/${fx.users.outsider}`,{ role:"viewer" })).statusCode).toBe(403);
  expect((await request(credential.token,"PATCH",`/api/projects/${fx.projects.p1}/issues/bulk`,{ action:"priority",issueIds:[fx.issues.p1issue],priorityId:"high" })).statusCode).toBe(200);
  const audits = await q<{ actor_id:string; action:string; details:Record<string,unknown> }>(`SELECT actor_id,action,details FROM audit_log WHERE action IN ('issue.update','comment.create','access.denied','issue.bulkAction')`);
  expect(audits.length).toBeGreaterThanOrEqual(5);
  for (const entry of audits) { expect(entry.actor_id).toBe(fx.users.mgr1); expect(entry.details).toMatchObject({ via:"token",tokenId:credential.id }); }
  expect(JSON.stringify(audits)).not.toContain(credential.token);
});

test("only a verified header token gets a separate limiter bucket and one hash per request",async () => {
  Object.assign(cfg.rateLimit,{ enabled:true,max:3,windowMs:60_000 });
  const server = buildApp(); extraApps.push(server); await server.ready();
  const first = await tokenFor(fx.users.emp1), second = await tokenFor(fx.users.emp1);
  // Cold valid token consumes IP; subsequent valid credentials have independent buckets.
  expect((await request(first.token,"GET","/api/projects",undefined,server)).statusCode).toBe(200);
  vi.mocked(createHash).mockClear();
  expect((await request(first.token,"GET","/api/projects",undefined,server)).statusCode).toBe(200);
  expect(vi.mocked(createHash)).toHaveBeenCalledTimes(1);
  for (let i=0;i<2;i++) expect((await request(first.token,"GET","/api/projects",undefined,server)).statusCode).toBe(200);
  expect((await request(first.token,"GET","/api/projects",undefined,server)).statusCode).toBe(429);
  expect((await request(second.token,"GET","/api/projects",undefined,server)).statusCode).toBe(200);
  for (let i=0;i<3;i++) expect((await request(second.token,"GET","/api/projects",undefined,server)).statusCode).toBe(200);
  // Two cold valid requests used IP. One random prefix fits; changing prefix cannot make a fourth slot.
  expect((await request(generateToken().token,"GET","/api/projects",undefined,server)).statusCode).toBe(401);
  expect((await request(generateToken().token,"GET","/api/projects",undefined,server)).statusCode).toBe(429);
  const wrong = `tsk_${first.prefix}_${generateToken().token.slice(13)}`;
  expect((await request(wrong,"GET","/api/projects",undefined,server)).statusCode).toBe(429);
});

test("credentials in cookies/query and WebSocket auth are rejected; header credentials do not enter request logs",async () => {
  const credential = await tokenFor(fx.users.emp1);
  for (const options of [{ url:"/api/projects?token="+credential.token },{ url:"/api/projects",headers:{ cookie:"taskira_session="+credential.token } }]) {
    expect((await app.inject(options)).statusCode).toBe(401);
  }
  const ws = await app.injectWS("/api/ws");
  const closed = new Promise<number>((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error("WS did not close")),1000);
    ws.on("close",code => { clearTimeout(timer); resolve(code); });
  });
  ws.send(JSON.stringify({ type:"auth",token:credential.token })); expect(await closed).toBe(1008);
  const lines: string[] = []; const logged = buildApp({ level:"info",stream:{ write:line => { lines.push(line); } } });
  extraApps.push(logged); await logged.ready();
  expect((await request(credential.token,"GET","/api/projects",undefined,logged)).statusCode).toBe(200);
  expect(lines.join("")).toContain("incoming request"); expect(lines.join("")).not.toContain("tsk_");
});

test("service account has no login, LDAP adoption, notifications, reminders, mentions, assignee suggestion or licensed seat",async () => {
  const [service] = await q<{ id:string }>(`INSERT INTO users(username,name,initials,color,job_role,global_role,auth_source,password_hash,last_login_at)
    VALUES('robot','Robot service','RS','#334455','qa','member','service',NULL,now()) RETURNING id`);
  await q(`INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'employee')`,[fx.projects.p1,service.id]);
  await q(`INSERT INTO issue_assignees(issue_id,user_id) VALUES($1,$2)`,[fx.issues.p1issue,service.id]);
  expect((await app.inject({ method:"POST",url:"/api/auth/login",payload:{ username:"robot",password:"password123" } })).statusCode).toBe(401);
  await expect(provisionFromLdap({ login:"robot",name:"Robot",dn:"cn=robot,dc=test",email:null,groupDns:[] })).rejects.toMatchObject({ statusCode:409 });
  await expect(q(`UPDATE users SET global_role='admin' WHERE id=$1`,[service.id])).rejects.toMatchObject({ code:"23514" });
  await expect(q(`UPDATE users SET password_hash='not-a-real-hash' WHERE id=$1`,[service.id])).rejects.toMatchObject({ code:"23514" });
  await emit({ type:"issue.comment",actorId:fx.users.mgr1,projectId:fx.projects.p1,issueId:fx.issues.p1issue });
  expect(await q(`SELECT id FROM notifications WHERE user_id=$1`,[service.id])).toHaveLength(0);
  expect(await resolveVisibleMentions(fx.projects.p1,fx.issues.p1issue,["robot"])).toEqual([]);
  const admin = await login(app,"admin"), employee = await login(app,"emp1");
  expect((await request(admin,"GET","/api/users/pickable?q=Robot")).json()).toEqual([]);
  expect((await request(admin,"GET","/api/users/pickable?q=Robot&includeService=1")).json()).toEqual([expect.objectContaining({ id:service.id,authSource:"service" })]);
  expect((await request(employee,"GET","/api/users/pickable?q=Robot&includeService=1")).statusCode).toBe(403);
  const serviceCredential = await tokenFor(service.id);
  expect((await request(serviceCredential.token,"GET",`/api/projects/${fx.projects.p1}/issues`)).statusCode).toBe(200);
  expect((await request(serviceCredential.token,"GET","/api/users/pickable?q=Robot&includeService=1")).statusCode).toBe(403);
  expect(await countActiveSeats(30)).toBe(2); // Only the two real successful logins above.
  Object.assign(cfg.reminders,{ enabled:true,hour:0,timeZone:"UTC" });
  const now = new Date("2026-10-05T12:00:00Z"); await q(`UPDATE issues SET due_date='2026-10-05' WHERE id=$1`,[fx.issues.p1issue]);
  await runDueRemindersOnce(now);
  expect(await q(`SELECT id FROM notifications WHERE user_id=$1`,[service.id])).toHaveLength(0);
});

test("maintenance purges credentials 90 days after revocation or expiry in bounded batches",async () => {
  const old = await tokenFor(fx.users.emp1,"write",{ created:new Date(Date.now()-200*86400_000),expires:new Date(Date.now()-100*86400_000) });
  const revoked = await tokenFor(fx.users.emp1); await q(`UPDATE api_tokens SET revoked_at=now()-interval '91 days' WHERE id=$1`,[revoked.id]);
  const recent = await tokenFor(fx.users.emp1); await q(`UPDATE api_tokens SET revoked_at=now() WHERE id=$1`,[recent.id]);
  const active = await tokenFor(fx.users.emp1);
  await runMaintenanceOnce();
  expect((await q<{ id:string }>(`SELECT id FROM api_tokens ORDER BY id`)).map(row => row.id).sort()).toEqual([recent.id,active.id].sort());
  expect(await q(`SELECT id FROM api_tokens WHERE id=ANY($1::uuid[])`,[[old.id,revoked.id]])).toHaveLength(0);
});

test("the expand migration accepts the historical checks and fails atomically on a renamed auth-source check",async () => {
  const migration = await readFile(new URL("../migrations/20261005T1007_api_tokens.sql",import.meta.url),"utf8");
  for (const renamed of [false,true]) {
    await expect(withTransaction(async client => {
      const schema = "int06_"+randomUUID().replaceAll("-","");
      await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET LOCAL search_path TO ${schema},public`);
      await client.query(`CREATE TABLE users(id uuid PRIMARY KEY,password_hash text,ldap_dn text,global_role text,
        auth_source text NOT NULL DEFAULT 'local' CONSTRAINT ${renamed ? "custom_source" : "users_auth_source_check"} CHECK(auth_source IN ('local','ldap')),
        CONSTRAINT users_local_has_password CHECK(auth_source<>'local' OR password_hash IS NOT NULL))`);
      await client.query(migration);
      await client.query(`INSERT INTO users(id,global_role,auth_source) VALUES(gen_random_uuid(),'member','service')`);
      throw new Error("expanded and rolled back");
    })).rejects.toThrow(renamed ? "Unexpected CHECK" : "expanded and rolled back");
  }
});

test("an administrator token without membership cannot mutate any registered route except explicit personal data",async () => {
  expect(catalog.printRoutes()).toContain("api");
  const credential = await tokenFor(fx.users.admin);
  const personal = new Map<string,string>([
    ["POST /api/notifications/read","marks only the token owner's notifications"],
    ["POST /api/notifications/dismiss","dismisses only the token owner's notifications"],
    ["PATCH /api/notifications/prefs","changes only the token owner's delivery preferences"],
    ["POST /api/dashboards","creates a personal dashboard; shared dashboard is tested separately"],
    ["POST /api/dashboards/data","computes widgets from projects visible as a member"],
  ]);
  const seen = new Set<string>();
  for (const route of routes) {
    if (["GET","HEAD","OPTIONS"].includes(route.method) || !route.url.startsWith("/api/")) continue;
    const key = route.method+" "+route.url; if (seen.has(key)) continue; seen.add(key);
    const values: Record<string,string> = { projectId:fx.projects.p1,id:fx.issues.p1issue,userId:fx.users.outsider,dashboardId:randomUUID() };
    const url = route.url.replace(/:([A-Za-z]+)/g,(_match,name) => values[name] ?? randomUUID());
    let payload: object = {};
    if (key === "POST /api/dashboards") payload = { name:"Personal",shared:false,widgets:[] };
    else if (key === "POST /api/dashboards/data") payload = { widgets:[] };
    else if (key === "PATCH /api/notifications/prefs") payload = { email:"off" };
    else if (route.url.endsWith("/issues") && route.method === "POST") payload = newIssue();
    else if (route.url.endsWith("/issues/:id") && route.method === "PATCH") payload = { title:"Rejected" };
    else if (route.url.endsWith("/members/:userId") && route.method === "PUT") payload = { role:"viewer" };
    const response = await request(credential.token,route.method as InjectOptions["method"],url,route.method === "DELETE" ? undefined : payload,catalog);
    if (response.statusCode>=200 && response.statusCode<300) expect(personal.has(key),key+" unexpected mutation").toBe(true);
  }
  expect(seen.size).toBeGreaterThan(70);
});
