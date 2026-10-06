import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, newIssue, type Fixture } from "./helpers.js";
import type { ApiTokenCreatedDto, ServiceAccountDto } from "../src/contract.js";
import { parseToken } from "../src/services/apiTokens.js";

let app: FastifyInstance, fx: Fixture, admin: string, employee: string;
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fx = await seedFixture();
  admin = await login(app,"admin"); employee = await login(app,"emp1");
});
const request = (token: string,method: InjectOptions["method"],url: string,payload?: object) =>
  app.inject({ method,url,headers:auth(token),...(payload === undefined ? {} : { payload }) });
const tokenBody = { name: "Integration",scope: "write",expiresInDays: 90 };
async function personal(token = employee): Promise<ApiTokenCreatedDto> {
  const result = await request(token,"POST","/api/me/tokens",tokenBody);
  expect(result.statusCode).toBe(201); expect(result.headers["cache-control"]).toBe("no-store");
  return result.json();
}
async function service(username = "sync.bot"): Promise<ServiceAccountDto> {
  const result = await request(admin,"POST","/api/admin/service-accounts",{ username,name: "Служебный робот" });
  expect(result.statusCode).toBe(201); return result.json();
}
const servicePath = (id: string) => `/api/admin/service-accounts/${id}`;

test("personal issuance returns the credential once and persists only a SHA-256 hash",async () => {
  const created = await personal(); const parsed = parseToken(created.secret)!;
  expect(parsed).not.toBeNull(); expect(created.token.prefix).toBe(parsed.prefix);
  expect(created.token.scope).toBe("write");
  expect(new Date(created.token.expiresAt).getTime()-new Date(created.token.createdAt).getTime()).toBe(90*86400_000);
  const [stored] = await q<{ secret_hash: Buffer; row: object }>("SELECT secret_hash,to_jsonb(t) AS row FROM api_tokens t WHERE id=$1",[created.token.id]);
  expect(stored.secret_hash).toEqual(createHash("sha256").update(parsed.secret).digest());
  expect(JSON.stringify(stored.row)).not.toContain(parsed.secret);
  const listed = await request(employee,"GET","/api/me/tokens");
  expect(listed.json()).toEqual([created.token]); expect(listed.body).not.toContain(created.secret);
  const adminList = await request(admin,"GET","/api/admin/tokens");
  expect(adminList.body).not.toContain(parsed.secret); expect(adminList.body).not.toContain("secret_hash");
  expect(adminList.json()[0].owner.id).toBe(fx.users.emp1);
});
test("issued credential works, own revocation is immediate and repeated revocation is idempotent",async () => {
  const created = await personal();
  expect((await request(created.secret,"GET","/api/projects")).statusCode).toBe(200);
  const path = `/api/me/tokens/${created.token.id}`;
  expect((await request(employee,"DELETE",path)).statusCode).toBe(204);
  expect((await request(created.secret,"GET","/api/projects")).statusCode).toBe(401);
  expect((await request(employee,"DELETE",path)).statusCode).toBe(204);
  const [row] = await q<{ revoked_by: string }>("SELECT revoked_by FROM api_tokens WHERE id=$1",[created.token.id]);
  expect(row.revoked_by).toBe(fx.users.emp1);
  const audits = await q<{ details: object }>("SELECT details FROM audit_log WHERE action='token.revoke' AND entity_id=$1",[created.token.id]);
  expect(audits).toHaveLength(1);
});
test("personal routes do not list or revoke another user's token",async () => {
  const created = await personal(); const outsider = await login(app,"outsider");
  expect((await request(outsider,"GET","/api/me/tokens")).json()).toEqual([]);
  expect((await request(outsider,"DELETE",`/api/me/tokens/${created.token.id}`)).statusCode).toBe(404);
  expect((await request(outsider,"DELETE",`/api/me/tokens/${randomUUID()}`)).statusCode).toBe(404);
  expect((await request(created.secret,"GET","/api/projects")).statusCode).toBe(200);
});
test("concurrent personal issuance enforces ten active tokens and excludes revoked or expired rows",async () => {
  const results = await Promise.all(Array.from({ length: 11 },(_,index) =>
    request(employee,"POST","/api/me/tokens",{ ...tokenBody,name: "Token "+index })));
  expect(results.filter(result => result.statusCode === 201)).toHaveLength(10);
  const rejected = results.find(result => result.statusCode !== 201)!;
  expect(rejected.statusCode).toBe(409); expect(rejected.json().error.code).toBe("TOKEN_LIMIT");
  const rows = (await request(employee,"GET","/api/me/tokens")).json() as { id: string }[];
  await request(employee,"DELETE",`/api/me/tokens/${rows[0].id}`);
  await personal();
  await q("UPDATE api_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[rows[1].id]);
  await personal();
  expect((await q("SELECT id FROM api_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",[fx.users.emp1]))).toHaveLength(10);
});
test("token request validation rejects invalid lifetime, scope, name, extra fields and malformed ids",async () => {
  for (const body of [ { ...tokenBody,expiresInDays: 0 },{ ...tokenBody,expiresInDays: 366 },
    { ...tokenBody,expiresInDays: 1.5 },{ ...tokenBody,scope: "admin" },{ ...tokenBody,name: "   " },
    { ...tokenBody,name: "x".repeat(81) },{ ...tokenBody,userId: fx.users.admin } ]) {
    expect((await request(employee,"POST","/api/me/tokens",body)).statusCode).toBe(400);
  }
  expect((await request(employee,"DELETE","/api/me/tokens/invalid")).statusCode).toBe(400);
  expect((await request(admin,"GET","/api/admin/tokens?active=true")).statusCode).toBe(400);
  expect((await request(admin,"GET","/api/admin/tokens?userId=invalid")).statusCode).toBe(400);
  const defaultLifetime = await request(employee,"POST","/api/me/tokens",{ name: "Default",scope: "read" });
  expect(defaultLifetime.statusCode).toBe(201);
  const body = defaultLifetime.json() as ApiTokenCreatedDto;
  expect(new Date(body.token.expiresAt).getTime()-new Date(body.token.createdAt).getTime()).toBe(90*86400_000);
});
test("read and write API credentials cannot access any token or service-account management route",async () => {
  const account = await service(); const own = await personal();
  const paths: [InjectOptions["method"],string,object?][] = [
    ["GET","/api/me/tokens"],["POST","/api/me/tokens",tokenBody],["DELETE",`/api/me/tokens/${own.token.id}`],
    ["GET","/api/admin/tokens"],["DELETE",`/api/admin/tokens/${own.token.id}`],
    ["GET","/api/admin/service-accounts"],["POST","/api/admin/service-accounts",{ username: "another.bot",name: "Robot" }],
    ["PATCH",servicePath(account.id),{ isActive: false }],["GET",servicePath(account.id)+"/tokens"],
    ["POST",servicePath(account.id)+"/tokens",tokenBody],["DELETE",servicePath(account.id)+`/tokens/${own.token.id}`],
  ];
  for (const scope of ["read","write"]) {
    const result = await request(employee,"POST","/api/me/tokens",{ ...tokenBody,scope });
    const credential = result.json().secret as string;
    for (const [method,path,body] of paths) {
      const response = await request(credential,method,path,body);
      expect(response.statusCode,method+" "+path).toBe(403);
      expect(response.json().error.code).toBe("TOKEN_NOT_ALLOWED");
    }
  }
});
test("ordinary sessions cannot access any administrative management route",async () => {
  const account = await service(); const own = await personal();
  for (const [method,path,body] of [
    ["GET","/api/admin/tokens"],["DELETE",`/api/admin/tokens/${own.token.id}`],
    ["GET","/api/admin/service-accounts"],["POST","/api/admin/service-accounts",{ username: "another.bot",name: "Robot" }],
    ["PATCH",servicePath(account.id),{ name: "Changed" }],["GET",servicePath(account.id)+"/tokens"],
    ["POST",servicePath(account.id)+"/tokens",tokenBody],["DELETE",servicePath(account.id)+`/tokens/${own.token.id}`],
  ] as [InjectOptions["method"],string,object?][]) {
    const response = await request(employee,method,path,body); expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  }
});
test("service account joins a project, creates an issue and receives token audit attribution",async () => {
  const account = await service();
  expect(account.projects).toEqual([]); expect(account.activeTokens).toBe(0);
  const [user] = await q<{ auth_source: string; global_role: string; password_hash: null; ldap_dn: null; initials: string; job_role: string }>(
    "SELECT auth_source,global_role,password_hash,ldap_dn,initials,job_role FROM users WHERE id=$1",[account.id]);
  expect(user).toEqual({ auth_source: "service",global_role: "member",password_hash: null,ldap_dn: null,initials: "СР",job_role: "Сервисная учётная запись" });
  expect((await request(admin,"PUT",`/api/projects/${fx.projects.p1}/members/${account.id}`,{ role: "employee" })).statusCode).toBe(200);
  const issued = await request(admin,"POST",servicePath(account.id)+"/tokens",tokenBody);
  expect(issued.statusCode).toBe(201); expect(issued.headers["cache-control"]).toBe("no-store");
  const credential = issued.json() as ApiTokenCreatedDto;
  const created = await request(credential.secret,"POST",`/api/projects/${fx.projects.p1}/issues`,newIssue());
  expect(created.statusCode).toBe(201); expect(created.json().reporterId).toBe(account.id);
  const [audit] = await q<{ actor_id: string; details: { via: string; tokenId: string } }>(
    "SELECT actor_id,details FROM audit_log WHERE action='issue.create' AND entity_id=$1",[created.json().id]);
  expect(audit.actor_id).toBe(account.id); expect(audit.details.via).toBe("token"); expect(audit.details.tokenId).toBe(credential.token.id);
  const list = (await request(admin,"GET","/api/admin/service-accounts")).json() as ServiceAccountDto[];
  expect(list[0].projects).toEqual([{ projectId: fx.projects.p1,role: "employee" }]); expect(list[0].activeTokens).toBe(1);
  expect((await request(admin,"GET",servicePath(account.id)+"/tokens")).body).not.toContain(credential.secret);
});
test("deactivation blocks cached service tokens immediately, prevents issuance and preserves safe renaming",async () => {
  const account = await service();
  const credential = (await request(admin,"POST",servicePath(account.id)+"/tokens",tokenBody)).json() as ApiTokenCreatedDto;
  expect((await request(credential.secret,"GET","/api/projects")).statusCode).toBe(200);
  const changed = await request(admin,"PATCH",servicePath(account.id.toUpperCase()),{ name: "Обновлённый робот",isActive: false });
  expect(changed.statusCode).toBe(200); expect(changed.json().isActive).toBe(false);
  expect((await request(credential.secret,"GET","/api/projects")).statusCode).toBe(401);
  expect((await request(admin,"POST",servicePath(account.id)+"/tokens",tokenBody)).statusCode).toBe(409);
  await request(admin,"PATCH",servicePath(account.id),{ isActive: true });
  expect((await request(credential.secret,"GET","/api/projects")).statusCode).toBe(200);
  const [row] = await q<{ initials: string; session_version: string }>("SELECT initials,session_version FROM users WHERE id=$1",[account.id]);
  expect(row.initials).toBe("ОР"); expect(Number(row.session_version)).toBe(2);
});
test("concurrent service issuance enforces five active tokens and revocation frees a slot",async () => {
  const account = await service(); const path = servicePath(account.id)+"/tokens";
  const results = await Promise.all(Array.from({ length: 6 },() => request(admin,"POST",path,tokenBody)));
  expect(results.filter(result => result.statusCode === 201)).toHaveLength(5);
  expect(results.find(result => result.statusCode === 409)!.json().error.code).toBe("TOKEN_LIMIT");
  const issued = results.find(result => result.statusCode === 201)!.json() as ApiTokenCreatedDto;
  expect((await request(admin,"DELETE",path+"/"+issued.token.id)).statusCode).toBe(204);
  expect((await request(admin,"DELETE",path+"/"+issued.token.id)).statusCode).toBe(204);
  expect((await request(admin,"POST",path,tokenBody)).statusCode).toBe(201);
  expect((await request(issued.secret,"GET","/api/projects")).statusCode).toBe(401);
});
test("service routes cannot target a human account or another service's token",async () => {
  const account = await service(), other = await service("other.bot");
  const human = await personal(); const issued = (await request(admin,"POST",servicePath(account.id)+"/tokens",tokenBody)).json() as ApiTokenCreatedDto;
  for (const id of [fx.users.emp1,randomUUID()]) {
    expect((await request(admin,"PATCH",servicePath(id),{ name: "Robot" })).statusCode).toBe(404);
    expect((await request(admin,"GET",servicePath(id)+"/tokens")).statusCode).toBe(404);
    expect((await request(admin,"POST",servicePath(id)+"/tokens",tokenBody)).statusCode).toBe(404);
  }
  expect((await request(admin,"DELETE",servicePath(other.id)+`/tokens/${issued.token.id}`)).statusCode).toBe(404);
  expect((await request(admin,"DELETE",servicePath(fx.users.emp1)+`/tokens/${human.token.id}`)).statusCode).toBe(404);
  expect((await request(issued.secret,"GET","/api/projects")).statusCode).toBe(200);
});
test("service names and usernames are validated, duplicate login conflicts and privileged fields are rejected",async () => {
  await service();
  expect((await request(admin,"POST","/api/admin/service-accounts",{ username: "sync.bot",name: "Second" })).statusCode).toBe(409);
  expect((await request(admin,"POST","/api/admin/service-accounts",{ username: "emp1",name: "Robot" })).statusCode).toBe(409);
  for (const body of [{ username: "ab",name: "Robot" },{ username: "valid.bot",name: "  " },
    { username: "valid.bot",name: "Robot",globalRole: "admin" },{ username: "bad login",name: "Robot" }])
    expect((await request(admin,"POST","/api/admin/service-accounts",body)).statusCode).toBe(400);
  const account = await service("new.bot");
  for (const body of [{},{ name: "  " },{ globalRole: "admin" },{ isActive: "false" }])
    expect((await request(admin,"PATCH",servicePath(account.id),body)).statusCode).toBe(400);
});
test("administrative filters expose safe owner metadata and global revocation invalidates another user's token",async () => {
  const own = await personal(), another = await personal(admin);
  const filtered = await request(admin,"GET",`/api/admin/tokens?userId=${fx.users.emp1}&active=1`);
  expect(filtered.json()).toHaveLength(1); expect(filtered.json()[0].id).toBe(own.token.id);
  expect(filtered.json()[0].owner).toEqual({ id: fx.users.emp1,username: "emp1",name: "Employee One",authSource: "local" });
  expect((await request(own.secret,"GET","/api/projects")).statusCode).toBe(200);
  expect((await request(admin,"DELETE",`/api/admin/tokens/${own.token.id}`)).statusCode).toBe(204);
  expect((await request(own.secret,"GET","/api/projects")).statusCode).toBe(401);
  expect((await request(admin,"GET","/api/admin/tokens?active=1")).json().map((token: { id: string }) => token.id)).toEqual([another.token.id]);
  expect((await request(admin,"GET","/api/admin/tokens")).json()).toHaveLength(2);
});
test("creation and revocation audit contains identifiers but no credential",async () => {
  const issued = await personal(); await request(admin,"DELETE",`/api/admin/tokens/${issued.token.id}`);
  const rows = await q<{ actor_id: string; action: string; details: object }>(
    "SELECT actor_id,action,details FROM audit_log WHERE action IN ('token.create','token.revoke') ORDER BY created_at");
  expect(rows.map(row => row.actor_id)).toEqual([fx.users.emp1,fx.users.admin]);
  for (const row of rows) expect(row.details).toEqual({ tokenId: issued.token.id,prefix: issued.token.prefix,scope: "write",ownerId: fx.users.emp1 });
  expect(JSON.stringify(rows)).not.toContain(issued.secret); expect(JSON.stringify(rows)).not.toContain(parseToken(issued.secret)!.secret);
});

test("service author profiles in comments and history survive leaving the project",async () => {
  const account = await service();
  const root = `/api/projects/${fx.projects.p1}`;
  expect((await request(admin,"PUT",`${root}/members/${account.id}`,{ role: "employee" })).statusCode).toBe(200);
  const issued = (await request(admin,"POST",servicePath(account.id)+"/tokens",tokenBody)).json() as ApiTokenCreatedDto;
  const created = await request(issued.secret,"POST",root+"/issues",newIssue());
  expect(created.statusCode).toBe(201); const issuePath = root+"/issues/"+created.json().id;
  const comment = await request(issued.secret,"POST",issuePath+"/comments",{ body: "Synced by service" });
  expect(comment.statusCode).toBe(201); expect(comment.json().author.authSource).toBe("service");
  expect((await request(admin,"DELETE",`${root}/members/${account.id}`)).statusCode).toBe(204);
  const comments = await request(admin,"GET",issuePath+"/comments");
  expect(comments.statusCode).toBe(200); expect(comments.json()[0].author).toMatchObject({ id: account.id,authSource: "service",name: account.name });
  const activity = await request(admin,"GET",issuePath+"/activity");
  expect(activity.statusCode).toBe(200);
  expect(activity.json().find((entry: { actorId: string }) => entry.actorId === account.id).actor).toMatchObject({ id: account.id,authSource: "service" });
});
