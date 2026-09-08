/** Валидация меток задачи (contract.ts `label()`): пустая / из одних пробелов
 *  метка должна отклоняться 400 — регрессия на taskira-review-3 §2.2. */
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

const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });

describe("метки задачи — валидация", () => {
  test("POST /issues с labels: [\"\"] → 400", async () => {
    const t = await login(app, "mgr1");
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue({ labels: [""] }));
    expect(r.statusCode).toBe(400);
  });

  test("POST /issues с labels из одних пробелов → 400", async () => {
    const t = await login(app, "mgr1");
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue({ labels: ["   "] }));
    expect(r.statusCode).toBe(400);
  });

  test("POST /issues с нормальной меткой → 201, нормализована (trim + lowercase)", async () => {
    const t = await login(app, "mgr1");
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue({ labels: ["  Backend  "] }));
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).labels).toEqual(["backend"]);
  });

  test("PATCH /issues с labels: [\" \"] → 400", async () => {
    const t = await login(app, "mgr1");
    const created = JSON.parse((await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue())).body);
    const r = await patch(`/api/projects/${fx.projects.p1}/issues/${created.id}`, t, { labels: [" "] });
    expect(r.statusCode).toBe(400);
  });
});
