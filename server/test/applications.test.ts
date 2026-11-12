import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import type { ApplicationEnabled, ApplicationsDto } from "../src/applicationContract.js";
import { applicationSettings, routeApplication } from "../src/applications/registry.js";
import { modules } from "../src/services/workspace.js";
import { runWorkspaceOnce } from "../src/services/workspaceProcesses.js";
import { runRecurringWork } from "../src/services/recurring.js";
import { createIssueInTx } from "../src/services/issueCreate.js";
import { projectById } from "../src/services/project.js";
import { withTransaction } from "../src/db.js";
import { checkedRoutes } from "./responseContract.js";
import { runMaintenanceOnce } from "../src/services/maintenance.js";

let app: FastifyInstance, fixture: Fixture;
let tokens: Record<string, string>;
const base = () => `/api/projects/${fixture.projects.p1}`;
const call = (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", path: string, payload?: unknown, who = "mgr1") =>
  app.inject({ method, url: path, headers: auth(tokens[who]), ...(payload === undefined ? {} : { payload }) });
const enabled = { work: true, knowledge: true, objects: true };
async function configure(patch: Partial<ApplicationEnabled>) {
  const { revision, ...current } = await applicationSettings();
  const response = await call("PATCH", "/api/applications", { revision, enabled: { ...current, ...patch } }, "admin");
  expect(response.statusCode, response.body).toBe(200);
  return response.json<ApplicationsDto>();
}
async function document() {
  const response = await call("POST", `${base()}/documents`, { title: "Operating instructions" });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; revision: number }>();
}
async function object() {
  const response = await call("POST", `${base()}/object-types`, { name: "Systems", fields: [] });
  expect(response.statusCode, response.body).toBe(201);
  const type = response.json<{ id: string }>();
  const created = await call("POST", `${base()}/objects`, { typeId: type.id, title: "Portal" });
  expect(created.statusCode, created.body).toBe(201);
  return { ...created.json<{ id: string; revision: number }>(), typeId: type.id };
}
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fixture = await seedFixture(); tokens = {};
  for (const who of ["admin", "mgr1", "emp1", "outsider"]) tokens[who] = await login(app, who);
  expect((await call("PATCH", `${base()}/workspace/modules`, { documents: true, objects: true, processes: true, planning: true })).statusCode).toBe(200);
});

test("catalogue defaults preserve the installation and expose only visible projects", async () => {
  const response = await call("GET", "/api/applications");
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual({ revision: 1, canManage: false, applications: [
    { id: "work", enabled: true, projectIds: [fixture.projects.p1] },
    { id: "knowledge", enabled: true, projectIds: [fixture.projects.p1] },
    { id: "objects", enabled: true, projectIds: [fixture.projects.p1] },
  ] });
  const admin = (await call("GET", "/api/applications", undefined, "admin")).json<ApplicationsDto>();
  expect(admin.canManage).toBe(true);
  expect(admin.applications.find(item => item.id === "work")!.projectIds).toEqual([fixture.projects.p1, fixture.projects.p2]);
  expect(admin.applications.find(item => item.id === "knowledge")!.projectIds).toEqual([fixture.projects.p1]);
  expect((await call("GET", "/api/applications", undefined, "outsider")).json<ApplicationsDto>().applications.every(item => item.projectIds.length === 0)).toBe(true);
  expect((await app.inject({ url: "/api/applications" })).statusCode).toBe(401);
  expect(checkedRoutes()).toContain("GET /api/applications");
});

test("task invitation does not expose the project through the application catalogue", async () => {
  await q("INSERT INTO issue_collaborators(issue_id,user_id,added_by) VALUES($1,$2,$3)", [fixture.issues.p1issue, fixture.users.outsider, fixture.users.mgr1]);
  const result = (await call("GET", "/api/applications", undefined, "outsider")).json<ApplicationsDto>();
  expect(result.applications.every(item => !item.projectIds.includes(fixture.projects.p1))).toBe(true);
});

test("configuration is administrator-only, strict, versioned and audited atomically", async () => {
  const body = { revision: 1, enabled: { ...enabled, objects: false } };
  expect((await call("PATCH", "/api/applications", body)).statusCode).toBe(403);
  expect((await call("PATCH", "/api/applications", { revision: 1, enabled: { work: false, knowledge: false, objects: false } }, "admin")).statusCode).toBe(400);
  expect((await call("PATCH", "/api/applications", { ...body, projectIds: [fixture.projects.p2] }, "admin")).statusCode).toBe(400);
  const responses = await Promise.all([call("PATCH", "/api/applications", body, "admin"), call("PATCH", "/api/applications", body, "admin")]);
  expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
  expect(await applicationSettings()).toEqual({ revision: 2, ...body.enabled });
  expect((await q<{ details: { revision: number } }>("SELECT details FROM audit_log WHERE action='applications.changed'")).map(row => row.details.revision)).toEqual([2]);
  expect(checkedRoutes()).toContain("PATCH /api/applications");
});

test("Knowledge disable blocks editing and keeps document reads/export and stored project settings", async () => {
  const doc = await document();
  await configure({ knowledge: false });
  const create = await call("POST", `${base()}/documents`, { title: "Unavailable" });
  expect(create.statusCode, create.body).toBe(409);
  expect(create.json().error.code).toBe("APPLICATION_DISABLED");
  expect((await call("PATCH", `${base()}/documents/${doc.id}`, { revision: doc.revision, title: "Unavailable" })).statusCode).toBe(409);
  expect((await call("POST", `${base()}/documents/${doc.id}/versions`, { name: "Unavailable" })).statusCode).toBe(409);
  expect((await call("GET", `${base()}/documents/${doc.id}`)).statusCode).toBe(200);
  expect((await call("GET", `${base()}/documents/${doc.id}/export`)).statusCode).toBe(200);
  expect((await call("GET", `${base()}/workspace/modules`)).json()).toMatchObject({ documents: true, objects: true });
  expect(await modules(fixture.projects.p1)).toMatchObject({ documents: false, objects: true, processes: true });
  expect((await call("POST", `${base()}/issues`, newIssue())).statusCode).toBe(201);
  await configure({ knowledge: true });
  expect((await call("PATCH", `${base()}/documents/${doc.id}`, { revision: doc.revision, title: "Available" })).statusCode).toBe(200);
});

test("Objects disable protects schemas, records and shared links without blocking other applications", async () => {
  const record = await object(), doc = await document();
  await configure({ objects: false });
  expect((await call("POST", `${base()}/object-types`, { name: "Unavailable", fields: [] })).statusCode).toBe(409);
  expect((await call("POST", `${base()}/objects`, { typeId: record.typeId, title: "Unavailable" })).statusCode).toBe(409);
  expect((await call("PATCH", `${base()}/objects/${record.id}`, { revision: record.revision, title: "Unavailable" })).statusCode).toBe(409);
  expect((await call("POST", `${base()}/entity-links`, { source: { kind: "document", id: doc.id }, target: { kind: "object", id: record.id } })).statusCode).toBe(409);
  expect((await call("GET", `${base()}/objects/${record.id}`)).statusCode).toBe(200);
  expect((await call("GET", `${base()}/object-types`)).statusCode).toBe(200);
  expect((await call("POST", `${base()}/documents`, { title: "Still available" })).statusCode).toBe(201);
});

test("Work disable stops direct and cross-application task mutations, preserving original rights and facts", async () => {
  const doc = await document();
  const before = (await q("SELECT * FROM issues WHERE id=$1", [fixture.issues.p1issue]))[0];
  await configure({ work: false });
  const paths = [
    call("POST", `${base()}/issues`, newIssue()),
    call("PATCH", `${base()}/issues/${fixture.issues.p1issue}`, { title: "Unavailable" }),
    call("POST", `${base()}/issues/${fixture.issues.p1issue}/transition`, { to: fixture.p1status.inprogress }),
    call("POST", `${base()}/issues/${fixture.issues.p1issue}/comments`, { body: "Unavailable" }),
    call("DELETE", `${base()}/issues/${fixture.issues.p1issue}`),
    call("POST", `${base()}/documents/${doc.id}/issues`, { title: "Cross-app creation", requestId: randomUUID() }),
    call("POST", `${base()}/plans`, { name: "Unavailable", items: [] }),
  ];
  for (const response of await Promise.all(paths)) {
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("APPLICATION_DISABLED");
  }
  expect((await call("GET", `${base()}/issues/${fixture.issues.p1issue}`)).statusCode).toBe(200);
  expect((await call("GET", `${base()}/issues/${fixture.issues.p1issue}`, undefined, "outsider")).statusCode).toBe(403);
  expect((await call("POST", `${base()}/issues`, newIssue(), "outsider")).statusCode).toBe(403);
  expect((await q("SELECT * FROM issues WHERE id=$1", [fixture.issues.p1issue]))[0]).toEqual(before);
  const project = (await projectById(fixture.projects.p1))!;
  await expect(withTransaction(client => createIssueInTx(client, project, { title: "Blocked", description: "", typeId: "task", priorityId: "medium", labels: [], complexity: null, assigneeIds: [], checklistItems: [] }, fixture.users.mgr1))).rejects.toMatchObject({ code: "APPLICATION_DISABLED" });
  expect((await call("POST", `${base()}/documents`, { title: "Still available" })).statusCode).toBe(201);
  await object();
});

test("processes and pending automation events wait for Work to be re-enabled without losing or duplicating work", async () => {
  const template = (await call("POST", `${base()}/process-templates`, { name: "Check", steps: [{ key: "a", title: "First" }, { key: "b", title: "Next", dependsOn: ["a"] }] })).json();
  const version = (await call("POST", `${base()}/process-templates/${template.id}/publish`)).json();
  const started = await call("POST", `${base()}/process-runs`, { templateId: template.id, expectedVersionId: version.id, title: "Check", requestId: randomUUID() });
  expect(started.statusCode, started.body).toBe(201);
  const run = started.json();
  await call("POST", `${base()}/automation-rules`, { name: "Follow-up", event: "issue.created", when: { mode: "all", items: [{ field: "title", op: "eq", value: "Trigger" }] }, actions: [{ type: "createIssue", title: "Follow-up" }], enabled: true });
  expect((await call("POST", `${base()}/issues`, newIssue({ title: "Trigger" }))).statusCode).toBe(201);
  const done = (await q<{ id: string }>("SELECT id FROM workflow_statuses WHERE project_id=$1 AND category='done' LIMIT 1", [fixture.projects.p1]))[0];
  expect((await call("POST", `${base()}/issues/${run.steps[0].issueId}/transition`, { to: done.id })).statusCode).toBe(200);
  await configure({ work: false });
  const pending = await q("SELECT id FROM workspace_events WHERE processed_at IS NULL ORDER BY id");
  await runWorkspaceOnce();
  expect(await q("SELECT id FROM workspace_events WHERE processed_at IS NULL ORDER BY id")).toEqual(pending);
  expect((await call("GET", `${base()}/process-runs/${run.id}`)).json().steps[1].issueId).toBeNull();
  expect((await call("POST", `${base()}/process-templates/${template.id}/preview`)).statusCode).toBe(200);
  await configure({ work: true });
  await runWorkspaceOnce(); await runWorkspaceOnce();
  expect((await call("GET", `${base()}/process-runs/${run.id}`)).json().steps[1].issueId).toBeTruthy();
  expect((await q<{ count: string }>("SELECT count(*) FROM issues WHERE project_id=$1 AND title='Follow-up'", [fixture.projects.p1]))[0].count).toBe("1");
});

test("recurring schedules remain pending while Work is disabled", async () => {
  const [template] = await q<{ id: string }>("INSERT INTO issue_templates(project_id,name,type_id,priority_id,title,description,position) VALUES($1,'Recurring','task','medium','Recurring','',0) RETURNING id", [fixture.projects.p1]);
  const created = await call("POST", `${base()}/recurring`, { name: "Daily", templateId: template.id, schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: "2026-11-01", assigneeIds: [], skipIfOpen: false });
  expect(created.statusCode, created.body).toBe(201);
  const rule = created.json();
  await q("UPDATE recurring_rules SET next_run_at='2026-11-10T09:00:00Z' WHERE id=$1", [rule.id]);
  const before = await q("SELECT state,next_run_at,last_run_at FROM recurring_rules WHERE id=$1", [rule.id]);
  await configure({ work: false });
  expect(await runRecurringWork(new Date("2026-11-11T12:00:00Z"))).toMatchObject({ skipped: true, created: 0 });
  expect(await q("SELECT state,next_run_at,last_run_at FROM recurring_rules WHERE id=$1", [rule.id])).toEqual(before);
  expect(await q("SELECT id FROM recurring_runs WHERE rule_id=$1", [rule.id])).toEqual([]);
});

test("stored project switches remain independent; existing material is discoverable for read-only access", async () => {
  await document(); await object();
  await call("PATCH", `${base()}/workspace/modules`, { documents: false, objects: false, processes: false, planning: false });
  await configure({ knowledge: false, objects: false });
  const catalogue = (await call("GET", "/api/applications")).json<ApplicationsDto>();
  expect(catalogue.applications.filter(item => item.id !== "work").every(item => !item.enabled && item.projectIds.includes(fixture.projects.p1))).toBe(true);
  await configure({ knowledge: true, objects: true });
  expect(await modules(fixture.projects.p1)).toMatchObject({ documents: false, objects: false, processes: false, planning: false });
  expect((await call("POST", `${base()}/documents`, { title: "Project module still off" })).json().error.code).toBe("MODULE_DISABLED");
});

test("installation export retains app configuration and background archiving respects disabled Work", async () => {
  await q("UPDATE issues SET done_at=now()-interval '100 years' WHERE id=$1", [fixture.issues.p1issue]);
  await configure({ work: false });
  expect(await runMaintenanceOnce({ dryRun: true })).toMatchObject({ archived: 0 });
  expect(await runMaintenanceOnce()).toMatchObject({ archived: 0 });
  expect((await q<{ archived_at: Date | null }>("SELECT archived_at FROM issues WHERE id=$1", [fixture.issues.p1issue]))[0].archived_at).toBeNull();
  const exported = await call("GET", "/api/admin/export", undefined, "admin");
  expect(exported.statusCode, exported.body).toBe(200);
  const rows = exported.body.trim().split("\n").map(line => JSON.parse(line));
  expect(rows.find(row => row.type === "applicationSettings")).toMatchObject({ revision: 2, work: false, knowledge: true, objects: true });
  expect(rows.some(row => row.type === "issue" && row.id === fixture.issues.p1issue)).toBe(true);
  await configure({ work: true });
  expect(await runMaintenanceOnce()).toMatchObject({ archived: 1 });
});

test.each([
  ["/api/projects/:projectId/issues/:id/comments", "work"],
  ["/api/projects/:projectId/process-runs/:id/review", "work"],
  ["/api/projects/:projectId/documents/:id/attachments", "knowledge"],
  ["/api/projects/:projectId/object-types/:id", "objects"],
  ["/api/projects/:projectId/objects/:id", "objects"],
  ["/api/dashboards/:dashboardId", "work"],
  ["/api/projects/:projectId/workspace/modules", undefined],
  ["/api/projects/:projectId/members/:userId", undefined],
  ["/api/projects/:projectId/files", undefined],
])("route boundary %s belongs to %s", (path, owner) => {
  expect(routeApplication(path!)).toBe(owner);
});
