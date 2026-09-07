/** Права доступа — сценарии из ROLE_MIGRATION.md (роли, гарды, requireGlobalAdmin). */
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
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

describe("глобальный admin", () => {
  test("видит проект и создаёт задачу без строки в project_members", async () => {
    const t = await login(app, "admin");
    expect((await g(`/api/projects/${fx.projects.p1}`, t)).statusCode).toBe(200);
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue());
    expect(r.statusCode).toBe(201);
  });

  test("GET /api/users и POST /api/projects доступны", async () => {
    const t = await login(app, "admin");
    expect((await g("/api/users", t)).statusCode).toBe(200);
    const r = await post("/api/projects", t, { key: "NEW", name: "New", departmentId: fx.depts.d1 });
    expect(r.statusCode).toBe(201);
  });
});

describe("member без членства", () => {
  test("403 на роутах проекта, пустой /api/projects", async () => {
    const t = await login(app, "outsider");
    expect((await g(`/api/projects/${fx.projects.p1}`, t)).statusCode).toBe(403);
    const list = await g("/api/projects", t);
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)).toEqual([]);
  });
});

describe("матрица ролей в проекте", () => {
  test("viewer: browse — ок; create / manageAccess / editWorkflow — 403", async () => {
    const t = await login(app, "viw1");
    expect((await g(`/api/projects/${fx.projects.p1}`, t)).statusCode).toBe(200);
    expect((await post(`/api/projects/${fx.projects.p1}/issues`, t, newIssue())).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: "PUT",
        url: `/api/projects/${fx.projects.p1}/members/${fx.users.outsider}`,
        headers: auth(t),
        payload: { role: "viewer" },
      })).statusCode,
    ).toBe(403);
    expect(
      (await post(`/api/projects/${fx.projects.p1}/workflow/transitions`, t, {
        from: fx.p1status.todo,
        to: fx.p1status.inprogress,
      })).statusCode,
    ).toBe(403);
  });

  test("employee правит только свои задачи", async () => {
    const emp = await login(app, "emp1");
    // p1issue: reporter = emp1 → своя
    expect((await patch(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`, emp, { title: "mine" })).statusCode).toBe(200);
    // задача, где emp1 не автор и не исполнитель — создаём от admin с исполнителем mgr1
    const adm = await login(app, "admin");
    const created = JSON.parse(
      (await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeId: fx.users.mgr1 }))).body,
    );
    expect((await patch(`/api/projects/${fx.projects.p1}/issues/${created.id}`, emp, { title: "hax" })).statusCode).toBe(403);
  });
});

describe("гарды", () => {
  test("последний активный admin: PATCH globalRole=member → 409", async () => {
    const t = await login(app, "admin");
    const r = await patch(`/api/users/${fx.users.admin}`, t, { globalRole: "member" });
    expect(r.statusCode).toBe(409);
    // деактивация тоже
    expect((await patch(`/api/users/${fx.users.admin}`, t, { globalRole: "admin", isActive: false })).statusCode).toBe(409);
  });

  test("последний менеджер проекта: DELETE и PUT-понижение → 409; после второго — ок", async () => {
    const t = await login(app, "admin");
    const m = `/api/projects/${fx.projects.p1}/members`;
    expect((await del(`${m}/${fx.users.mgr1}`, t)).statusCode).toBe(409);
    expect(
      (await app.inject({ method: "PUT", url: `${m}/${fx.users.mgr1}`, headers: auth(t), payload: { role: "employee" } }))
        .statusCode,
    ).toBe(409);
    // назначаем второго менеджера
    expect(
      (await app.inject({ method: "PUT", url: `${m}/${fx.users.emp1}`, headers: auth(t), payload: { role: "manager" } }))
        .statusCode,
    ).toBe(200);
    expect((await del(`${m}/${fx.users.mgr1}`, t)).statusCode).toBe(204);
  });
});

describe("requireGlobalAdmin", () => {
  test("не-admin: POST /api/projects, POST /api/departments, GET /api/users → 403", async () => {
    const t = await login(app, "mgr1"); // manager в P1, но не глобальный admin
    expect((await post("/api/projects", t, { key: "NOPE", name: "n", departmentId: fx.depts.d1 })).statusCode).toBe(403);
    expect((await post("/api/departments", t, { name: "Nope" })).statusCode).toBe(403);
    expect((await g("/api/users", t)).statusCode).toBe(403);
  });
});
