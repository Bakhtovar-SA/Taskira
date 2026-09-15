/** Кросс-проектный поиск (GET /api/issues/search, миграция 024) — по ВСЕМ
 *  видимым пользователю проектам, не только текущему. Предикат видимости
 *  должен совпадать с services/projects.ts listVisibleProjects (см. и
 *  home.test.ts для того же инварианта на assigned-to-me). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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

const p1 = () => fx.projects.p1;
const p2 = () => fx.projects.p2;
const search = (q: string, token: string) => g(`/api/issues/search?q=${encodeURIComponent(q)}`, token);

async function createIssue(projectId: string, token: string, over: Record<string, unknown> = {}) {
  const r = await post(`/api/projects/${projectId}/issues`, token, newIssue(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("кросс-проектный поиск", () => {
  test("находит задачу в проекте, который сейчас не открыт (global admin видит оба)", async () => {
    const admin = await login(app, "admin");
    const mgr2 = await login(app, "mgr2");
    const issue = await createIssue(p2(), mgr2, { title: "Уникальная задача в SEC" });

    const r = await search("Уникальная задача", admin);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(true);
    expect(body.items.find((i: { id: string }) => i.id === issue.id)).toMatchObject({
      projectId: p2(),
      projectKey: "SEC",
    });
  });

  test("не показывает задачи из проекта, к которому нет доступа", async () => {
    const outsider = await login(app, "outsider");
    const mgr2 = await login(app, "mgr2");
    const issue = await createIssue(p2(), mgr2, { title: "Секретная для outsider задача" });

    const r = await search("Секретная для outsider", outsider);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(false);
  });

  test("находит по ключу задачи, не только по названию", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т" });

    const r = await search(issue.key, mgr);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(true);
  });

  test("не находит заархивированные задачи", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "Архивная находка" });
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [issue.id]);

    const r = await search("Архивная находка", mgr);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(false);
  });

  test("пустой q отклоняется валидацией — 400", async () => {
    const mgr = await login(app, "mgr1");
    const r = await g("/api/issues/search?q=", mgr);
    expect(r.statusCode).toBe(400);
  });
});
