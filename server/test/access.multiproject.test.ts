/** Multi-project — сценарии из DEPT_MIGRATION.md (видимость, IDOR, cross-project, департаменты). */
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
const keys = (body: string) => JSON.parse(body).map((p: { key: string }) => p.key).sort();

describe("видимость проектов", () => {
  test("admin — все; участник — только свои; is_shared открывает проект всем", async () => {
    const adm = await login(app, "admin");
    expect(keys((await g("/api/projects", adm)).body)).toEqual(["CORP", "SEC"]);

    const m1 = await login(app, "mgr1");
    expect(keys((await g("/api/projects", m1)).body)).toEqual(["CORP"]);

    const m2 = await login(app, "mgr2");
    expect(keys((await g("/api/projects", m2)).body)).toEqual(["SEC"]);

    // делаем P2 общим — mgr1 теперь его видит
    expect((await patch(`/api/projects/${fx.projects.p2}`, adm, { isShared: true })).statusCode).toBe(200);
    expect(keys((await g("/api/projects", m1)).body)).toEqual(["CORP", "SEC"]);
  });

  test("участник P1 не имеет доступа к P2", async () => {
    const emp = await login(app, "emp1");
    expect((await g(`/api/projects/${fx.projects.p2}`, emp)).statusCode).toBe(403);
  });
});

describe("IDOR — задача из чужого проекта по пути этого проекта", () => {
  test("GET / PATCH / DELETE /api/projects/P1/issues/<из P2> → 404, задача цела", async () => {
    const adm = await login(app, "admin");
    const wrong = `/api/projects/${fx.projects.p1}/issues/${fx.issues.p2issue}`;

    expect((await g(wrong, adm)).statusCode).toBe(404);
    expect((await patch(wrong, adm, { title: "hax" })).statusCode).toBe(404);
    expect((await del(wrong, adm)).statusCode).toBe(404);
    expect((await g(`${wrong}/comments`, adm)).statusCode).toBe(404);

    // по правильному пути задача на месте
    const ok = await g(`/api/projects/${fx.projects.p2}/issues/${fx.issues.p2issue}`, adm);
    expect(ok.statusCode).toBe(200);
  });
});

describe("исполнитель — только участник проекта (§3.6)", () => {
  test("assigneeId из другого проекта → 400", async () => {
    const adm = await login(app, "admin");
    // mgr2 — участник P2, не P1
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeId: fx.users.mgr2 }));
    expect(r.statusCode).toBe(400);
    // участник P1 — ок
    const ok = await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeId: fx.users.emp1 }));
    expect(ok.statusCode).toBe(201);
  });
});

describe("департаменты и проекты (global admin)", () => {
  test("DELETE департамента с проектами → 409; пустого — 204", async () => {
    const adm = await login(app, "admin");
    expect((await del(`/api/departments/${fx.depts.d1}`, adm)).statusCode).toBe(409);
    // убираем проект P1 — департамент D1 пустеет
    expect((await del(`/api/projects/${fx.projects.p1}`, adm)).statusCode).toBe(204);
    expect((await del(`/api/departments/${fx.depts.d1}`, adm)).statusCode).toBe(204);
  });

  test("POST /api/projects с занятым ключом → 409; свежий проект получает workflow", async () => {
    const adm = await login(app, "admin");
    expect((await post("/api/projects", adm, { key: "CORP", name: "dup", departmentId: fx.depts.d1 })).statusCode).toBe(409);

    const created = JSON.parse((await post("/api/projects", adm, { key: "NEW", name: "New", departmentId: fx.depts.d1 })).body);
    const wf = JSON.parse((await g(`/api/projects/${created.id}/workflow`, adm)).body);
    expect(wf.statuses.length).toBe(4);
    expect(wf.transitions.length).toBe(8);
  });

  test("нумерация задач независима по проектам", async () => {
    const adm = await login(app, "admin");
    const a = JSON.parse((await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue())).body);
    const b = JSON.parse((await post(`/api/projects/${fx.projects.p2}/issues`, adm, newIssue())).body);
    expect(a.key).toBe("CORP-2"); // CORP-1 уже в фикстуре
    expect(b.key).toBe("SEC-2");
  });
});
