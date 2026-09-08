/** Связи между задачами (issue_links, миграция 014) — ticket §3.2.
 *  Право линковать = `edit` на ИСХОДНУЮ задачу; обе задачи должны быть в проекте
 *  (иначе 404 — не раскрываем существование чужих задач). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const links = (issueId: string) => `/api/projects/${p1()}/issues/${issueId}/links`;

/** Ещё одна задача в P1 (создаёт менеджер). */
async function secondP1Issue(): Promise<string> {
  const mgr = await login(app, "mgr1");
  const res = await post(`/api/projects/${p1()}/issues`, mgr, newIssue({ title: "second" }));
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).id as string;
}

describe("issue links", () => {
  test("manager линкует relates — связь видна с обеих сторон", async () => {
    const mgr = await login(app, "mgr1");
    const a = fx.issues.p1issue;
    const b = await secondP1Issue();

    const r = await post(links(a), mgr, { linkedIssueId: b, type: "relates" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.id).toBeTruthy();
    expect(body.links).toHaveLength(1);
    expect(body.links[0].dir).toBe("relates");
    expect(body.links[0].issue.id).toBe(b);

    // со стороны b — тоже relates, и указывает на a
    const detailB = JSON.parse((await g(`/api/projects/${p1()}/issues/${b}`, mgr)).body);
    expect(detailB.links).toHaveLength(1);
    expect(detailB.links[0].dir).toBe("relates");
    expect(detailB.links[0].issue.id).toBe(a);
  });

  test("blocks направлен: источник — blocks, цель — blocked_by", async () => {
    const mgr = await login(app, "mgr1");
    const a = fx.issues.p1issue;
    const b = await secondP1Issue();

    await post(links(a), mgr, { linkedIssueId: b, type: "blocks" });

    const da = JSON.parse((await g(`/api/projects/${p1()}/issues/${a}`, mgr)).body);
    const db = JSON.parse((await g(`/api/projects/${p1()}/issues/${b}`, mgr)).body);
    expect(da.links[0].dir).toBe("blocks");
    expect(db.links[0].dir).toBe("blocked_by");
  });

  test("blocked_by с открытой задачи: сервер разворачивает, ответ — связи :id", async () => {
    const mgr = await login(app, "mgr1");
    const a = fx.issues.p1issue;
    const b = await secondP1Issue();

    // «a заблокирована задачей b» — POST идёт на /issues/a/links
    const r = await post(links(a), mgr, { linkedIssueId: b, type: "blocked_by" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].dir).toBe("blocked_by"); // ответ — со стороны a
    expect(body.links[0].issue.id).toBe(b);

    // со стороны b — это blocks
    const db = JSON.parse((await g(`/api/projects/${p1()}/issues/${b}`, mgr)).body);
    expect(db.links[0].dir).toBe("blocks");

    // дубль в обратную сторону (b blocks a) — 400
    expect((await post(links(a), mgr, { linkedIssueId: b, type: "blocks" })).statusCode).toBe(400);
    expect((await post(links(b), mgr, { linkedIssueId: a, type: "blocks" })).statusCode).toBe(400);
  });

  test("employee линкует свою задачу; viewer — 403", async () => {
    const emp = await login(app, "emp1"); // reporter+assignee p1issue
    const viw = await login(app, "viw1");
    const b = await secondP1Issue();

    expect((await post(links(fx.issues.p1issue), emp, { linkedIssueId: b, type: "relates" })).statusCode).toBe(200);
    expect((await post(links(fx.issues.p1issue), viw, { linkedIssueId: b, type: "relates" })).statusCode).toBe(403);
  });

  test("нельзя связать с задачей вне проекта (404) и с самой собой (400)", async () => {
    const mgr = await login(app, "mgr1");
    expect(
      (await post(links(fx.issues.p1issue), mgr, { linkedIssueId: fx.issues.p2issue, type: "relates" })).statusCode,
    ).toBe(404);
    expect(
      (await post(links(fx.issues.p1issue), mgr, { linkedIssueId: fx.issues.p1issue, type: "relates" })).statusCode,
    ).toBe(400);
  });

  test("дубликат связи — 400 (в любую сторону для relates)", async () => {
    const mgr = await login(app, "mgr1");
    const a = fx.issues.p1issue;
    const b = await secondP1Issue();
    expect((await post(links(a), mgr, { linkedIssueId: b, type: "relates" })).statusCode).toBe(200);
    expect((await post(links(a), mgr, { linkedIssueId: b, type: "relates" })).statusCode).toBe(400);
    // обратное направление той же relates — тоже дубль
    expect((await post(links(b), mgr, { linkedIssueId: a, type: "relates" })).statusCode).toBe(400);
  });

  test("DELETE снимает связь и возвращает обновлённый список", async () => {
    const mgr = await login(app, "mgr1");
    const a = fx.issues.p1issue;
    const b = await secondP1Issue();
    const created = JSON.parse((await post(links(a), mgr, { linkedIssueId: b, type: "relates" })).body);
    const linkId = created.id as string;

    // удалить можно и со стороны b
    const r = await del(`/api/projects/${p1()}/issues/${b}/links/${linkId}`, mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).links).toHaveLength(0);
    // повторное удаление той же связи (с любого конца) — 404
    expect((await del(`/api/projects/${p1()}/issues/${a}/links/${linkId}`, mgr)).statusCode).toBe(404);
  });

  test("не участник проекта — 403", async () => {
    const out = await login(app, "outsider");
    const b = await secondP1Issue();
    expect((await post(links(fx.issues.p1issue), out, { linkedIssueId: b, type: "relates" })).statusCode).toBe(403);
  });

  test("GET /:id всегда содержит массив links", async () => {
    const mgr = await login(app, "mgr1");
    const detail = JSON.parse((await g(`/api/projects/${p1()}/issues/${fx.issues.p1issue}`, mgr)).body);
    expect(Array.isArray(detail.links)).toBe(true);
  });
});
