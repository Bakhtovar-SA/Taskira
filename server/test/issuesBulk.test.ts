/** Массовые операции (ТЗ 3.3, план v2 Трек 3): PATCH /api/projects/:id/issues/bulk.
 *  Главная проверка из самого ТЗ: частичный успех под ролью employee (task-level
 *  ограничение) — с точным списком отказов, а не общий 403 по первой чужой задаче. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });

const p1 = () => fx.projects.p1;
const bulkUrl = () => `/api/projects/${p1()}/issues/bulk`;
const issuesUrl = () => `/api/projects/${p1()}/issues`;

async function createIssue(token: string, over: Record<string, unknown> = {}) {
  const r = await post(issuesUrl(), token, {
    title: "т", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, complexity: null, ...over,
  });
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body) as { id: string; key: string };
}

describe("PATCH /issues/bulk — status", () => {
  test("admin: все задачи переходят todo → inprogress", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin);
    const b = await createIssue(admin);
    const r = await patch(bulkUrl(), admin, { action: "status", issueIds: [a.id, b.id], statusId: fx.p1status.inprogress });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect(body.failed).toEqual([]);

    const rows = await q<{ status_id: string }>(`SELECT status_id FROM issues WHERE id = ANY($1)`, [[a.id, b.id]]);
    expect(rows.every((row) => row.status_id === fx.p1status.inprogress)).toBe(true);
  });

  // Проверка, буквально требуемая ТЗ 3.3: массовая смена статуса на задачах разных
  // исполнителей под ролью employee (task-level ограничение) — частичный успех с
  // точным списком отказов.
  test("employee: своя задача меняется, чужая — в отказах с точной причиной, остальные не откатываются", async () => {
    const admin = await login(app, "admin");
    const emp = await login(app, "emp1");
    const own = await createIssue(admin, { assigneeIds: [fx.users.emp1] });
    const foreign = await createIssue(admin, { assigneeIds: [fx.users.mgr1] });

    const r = await patch(bulkUrl(), emp, { action: "status", issueIds: [own.id, foreign.id], statusId: fx.p1status.inprogress });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.succeeded).toEqual([own.id]);
    expect(body.failed).toEqual([{ issueId: foreign.id, reason: "Нет прав на эту задачу" }]);

    const rows = await q<{ id: string; status_id: string }>(`SELECT id, status_id FROM issues WHERE id = ANY($1)`, [[own.id, foreign.id]]);
    expect(rows.find((row) => row.id === own.id)?.status_id).toBe(fx.p1status.inprogress);
    expect(rows.find((row) => row.id === foreign.id)?.status_id).not.toBe(fx.p1status.inprogress); // не тронута
  });

  test("недопустимый переход по схеме — эта задача в отказах, остальные всё равно применяются", async () => {
    const admin = await login(app, "admin");
    const wf = JSON.parse((await g(`/api/projects/${p1()}/workflow`, admin)).body);
    const reviewId = wf.statuses.find((s: { sid: string }) => s.sid === "review").id;
    // todo → review не входит в DEFAULT_TRANSITIONS; inprogress → review — входит.
    const blocked = await createIssue(admin);
    const ok = await createIssue(admin);
    await q(`UPDATE issues SET status_id = $1 WHERE id = $2`, [fx.p1status.inprogress, ok.id]);

    const r = await patch(bulkUrl(), admin, { action: "status", issueIds: [blocked.id, ok.id], statusId: reviewId });
    const body = JSON.parse(r.body);
    expect(body.succeeded).toEqual([ok.id]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].issueId).toBe(blocked.id);
    expect(body.failed[0].reason).toContain("запрещён схемой");
  });

  test("несуществующая/чужого проекта задача — в отказах, не 404 на весь запрос", async () => {
    const admin = await login(app, "admin");
    const ok = await createIssue(admin);
    const fake = "99999999-9999-4999-8999-999999999999";
    const r = await patch(bulkUrl(), admin, { action: "status", issueIds: [ok.id, fake], statusId: fx.p1status.inprogress });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.succeeded).toEqual([ok.id]);
    expect(body.failed).toEqual([{ issueId: fake, reason: "Задача не найдена в проекте" }]);
  });
});

describe("PATCH /issues/bulk — assignee", () => {
  test("заменяет список исполнителей ровно одним значением, даже если раньше их было несколько", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin, { assigneeIds: [fx.users.mgr1, fx.users.emp1] });
    const r = await patch(bulkUrl(), admin, { action: "assignee", issueIds: [a.id], assigneeId: fx.users.viw1 });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).succeeded).toEqual([a.id]);

    const detail = JSON.parse((await g(`${issuesUrl()}/${a.id}`, admin)).body);
    expect(detail.assigneeIds).toEqual([fx.users.viw1]);
  });

  test('assigneeId="none" снимает всех исполнителей', async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin, { assigneeIds: [fx.users.mgr1] });
    const r = await patch(bulkUrl(), admin, { action: "assignee", issueIds: [a.id], assigneeId: "none" });
    expect(r.statusCode).toBe(200);
    const detail = JSON.parse((await g(`${issuesUrl()}/${a.id}`, admin)).body);
    expect(detail.assigneeIds).toEqual([]);
  });

  test("несуществующий/не-член-проекта assigneeId — 400 на весь запрос (не частичный успех)", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin);
    const r = await patch(bulkUrl(), admin, { action: "assignee", issueIds: [a.id], assigneeId: fx.users.outsider });
    expect(r.statusCode).toBe(400);
  });
});

describe("PATCH /issues/bulk — priority", () => {
  test("меняет приоритет у всех задач выборки", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin, { priorityId: "low" });
    const b = await createIssue(admin, { priorityId: "medium" });
    const r = await patch(bulkUrl(), admin, { action: "priority", issueIds: [a.id, b.id], priorityId: "critical" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).succeeded.sort()).toEqual([a.id, b.id].sort());
    const rows = await q<{ priority_id: string }>(`SELECT priority_id FROM issues WHERE id = ANY($1)`, [[a.id, b.id]]);
    expect(rows.every((row) => row.priority_id === "critical")).toBe(true);
  });
});

describe("PATCH /issues/bulk — delete", () => {
  test("удаляет задачи выборки; viewer (нет права delete) получает отказ по каждой", async () => {
    const admin = await login(app, "admin");
    const viw = await login(app, "viw1");
    const a = await createIssue(admin);
    const b = await createIssue(admin);

    const denied = await patch(bulkUrl(), viw, { action: "delete", issueIds: [a.id, b.id] });
    expect(denied.statusCode).toBe(200);
    expect(JSON.parse(denied.body).succeeded).toEqual([]);
    expect(JSON.parse(denied.body).failed).toHaveLength(2);

    const r = await patch(bulkUrl(), admin, { action: "delete", issueIds: [a.id, b.id] });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).succeeded.sort()).toEqual([a.id, b.id].sort());
    expect((await g(`${issuesUrl()}/${a.id}`, admin)).statusCode).toBe(404);
  });
});

describe("PATCH /issues/bulk — общие проверки", () => {
  test("outsider (не участник проекта) — 403", async () => {
    const admin = await login(app, "admin");
    const outsider = await login(app, "outsider");
    const a = await createIssue(admin);
    const r = await patch(bulkUrl(), outsider, { action: "priority", issueIds: [a.id], priorityId: "high" });
    expect(r.statusCode).toBe(403);
  });

  test("пустой issueIds — 400", async () => {
    const admin = await login(app, "admin");
    expect((await patch(bulkUrl(), admin, { action: "priority", issueIds: [], priorityId: "high" })).statusCode).toBe(400);
  });

  test("issueIds больше LIMITS.bulkIssuesMax — 400", async () => {
    const admin = await login(app, "admin");
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await patch(bulkUrl(), admin, { action: "priority", issueIds: ids, priorityId: "high" })).statusCode).toBe(400);
  });

  test("дубликаты в issueIds считаются один раз", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin);
    const r = await patch(bulkUrl(), admin, { action: "priority", issueIds: [a.id, a.id], priorityId: "high" });
    expect(JSON.parse(r.body).succeeded).toEqual([a.id]);
  });

  test("audit_log получает по записи на задачу плюс одну сводную на весь батч", async () => {
    const admin = await login(app, "admin");
    const a = await createIssue(admin);
    const b = await createIssue(admin);
    await patch(bulkUrl(), admin, { action: "priority", issueIds: [a.id, b.id], priorityId: "high" });
    const rows = await q<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_log WHERE action IN ('issue.update', 'issue.bulkAction') ORDER BY created_at`,
    );
    expect(rows.filter((r) => r.action === "issue.update")).toHaveLength(2);
    expect(rows.filter((r) => r.action === "issue.bulkAction")).toHaveLength(1);
  });
});
