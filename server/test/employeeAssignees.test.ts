import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let fx: Fixture;
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });
const url = () => `/api/projects/${fx.projects.p1}/issues`;
const request = (method: "POST" | "PATCH", path: string, token: string, payload: unknown) => app.inject({ method, url: path, headers: auth(token), payload });
async function create(token: string, assigneeIds: string[] = []) {
  const result = await request("POST", url(), token, newIssue({ assigneeIds }));
  expect(result.statusCode).toBe(201);
  return result.json() as { id: string; title: string; assigneeIds: string[] };
}
async function assignees(id: string) {
  return (await q<{ user_id: string }>(`SELECT user_id FROM issue_assignees WHERE issue_id = $1 ORDER BY user_id`, [id])).map(row => row.user_id).sort();
}

test("employee creates unassigned/self-assigned tasks, but cannot assign others or consume a task number on refusal", async () => {
  const employee = await login(app, "emp1");
  await create(employee);
  const omitted = await request("POST", url(), employee, newIssue({ assigneeIds: undefined }));
  expect(omitted.statusCode).toBe(201);
  expect(omitted.json().assigneeIds).toEqual([]);
  const own = await create(employee, [fx.users.emp1]);
  expect(own.assigneeIds).toEqual([fx.users.emp1]);
  const before = await q(`SELECT next_num FROM project_counters WHERE project_id = $1`, [fx.projects.p1]);
  for (const ids of [[fx.users.mgr1], [fx.users.emp1, fx.users.mgr1]]) {
    expect((await request("POST", url(), employee, newIssue({ assigneeIds: ids }))).statusCode).toBe(403);
  }
  expect(await q(`SELECT next_num FROM project_counters WHERE project_id = $1`, [fx.projects.p1])).toEqual(before);
});

test("employee cannot add others on own tasks or change foreign tasks; rejected patches leave all fields unchanged", async () => {
  const admin = await login(app, "admin"), employee = await login(app, "emp1");
  const own = await create(employee, [fx.users.emp1]);
  const foreign = await create(admin, [fx.users.mgr1]);
  for (const issue of [own, foreign]) {
    expect((await request("PATCH", `${url()}/${issue.id}`, employee, { title: "Must not save", assigneeIds: [fx.users.emp1, fx.users.mgr1] })).statusCode).toBe(403);
    expect((await q<{ title: string }>(`SELECT title FROM issues WHERE id = $1`, [issue.id]))[0].title).toBe(issue.title);
    expect(await assignees(issue.id)).toEqual(issue.assigneeIds.sort());
  }
  expect((await request("PATCH", `${url()}/${own.id}`, employee, { assigneeIds: [] })).statusCode).toBe(200);
  expect((await request("PATCH", `${url()}/${own.id}`, employee, { assigneeIds: [fx.users.emp1] })).statusCode).toBe(200);
});

test("employee preserves other assignees set by a manager while adding/removing self", async () => {
  const manager = await login(app, "mgr1"), employee = await login(app, "emp1");
  const own = await create(employee);
  expect((await request("PATCH", `${url()}/${own.id}`, manager, { assigneeIds: [fx.users.mgr1] })).statusCode).toBe(200);
  expect((await request("PATCH", `${url()}/${own.id}`, employee, { assigneeIds: [fx.users.mgr1, fx.users.emp1] })).statusCode).toBe(200);
  expect((await request("PATCH", `${url()}/${own.id}`, employee, { assigneeIds: [fx.users.emp1] })).statusCode).toBe(403);
  expect((await request("PATCH", `${url()}/${own.id}`, employee, { assigneeIds: [fx.users.mgr1] })).statusCode).toBe(200);
  expect(await assignees(own.id)).toEqual([fx.users.mgr1]);
});

test("bulk assignment cannot bypass self-only policy or remove other assignees", async () => {
  const admin = await login(app, "admin"), employee = await login(app, "emp1");
  const own = await create(employee);
  const shared = await create(admin, [fx.users.emp1, fx.users.mgr1]);
  const bulk = (ids: string[], assigneeId: string) => request("PATCH", `${url()}/bulk`, employee, { action: "assignee", issueIds: ids, assigneeId });
  const denied = await bulk([own.id], fx.users.mgr1);
  expect(denied.json().succeeded).toEqual([]);
  expect(denied.json().failed).toHaveLength(1);
  expect(await assignees(own.id)).toEqual([]);
  expect((await request("PATCH", `${url()}/${own.id}`, admin, { assigneeIds: [fx.users.mgr1] })).statusCode).toBe(200);
  const mixed = await bulk([own.id, shared.id], fx.users.emp1);
  expect(mixed.json().succeeded).toEqual([own.id, shared.id]);
  expect(mixed.json().failed).toEqual([]);
  expect(await assignees(own.id)).toEqual([fx.users.emp1, fx.users.mgr1].sort());
  expect(await assignees(shared.id)).toEqual([fx.users.emp1, fx.users.mgr1].sort());
  expect((await bulk([own.id, shared.id], "none")).json().succeeded).toEqual([own.id, shared.id]);
  expect(await assignees(own.id)).toEqual([fx.users.mgr1]);
  expect(await assignees(shared.id)).toEqual([fx.users.mgr1]);
  const foreign = await create(admin, [fx.users.mgr1]);
  expect((await bulk([foreign.id], fx.users.emp1)).json().succeeded).toEqual([]);
  expect(await assignees(foreign.id)).toEqual([fx.users.mgr1]);
});
