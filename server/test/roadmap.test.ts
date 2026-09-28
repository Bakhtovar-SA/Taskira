/** ТЗ 5.15 — роадмап проектов: даты, вехи, зависимости. Права (editRoadmap) проверяет сервер, цикл зависимостей
 *  отклоняется, роадмап показывает только видимые проекты, экспорт содержит вехи и зависимости. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import type { RoadmapDto } from "../src/contract.js";

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

const as = async (user: string) => auth(await login(app, user));
const roadmap = async (user: string) => (await app.inject({ url: "/api/roadmap", headers: await as(user) })).json() as RoadmapDto;
const dates = (user: string, payload: Record<string, unknown>, projectId = fx.projects.p1) =>
  as(user).then((headers) => app.inject({ method: "PATCH", url: `/api/projects/${projectId}/roadmap`, headers, payload }));
const depend = (user: string, dependent: string, source: string) =>
  as(user).then((headers) => app.inject({ method: "POST", url: `/api/projects/${dependent}/dependencies`, headers, payload: { sourceProjectId: source } }));
const mkProject = async (key: string, deptId = fx.depts.d1) =>
  (await q<{ id: string }>(`INSERT INTO projects (key, name, description, department_id) VALUES ($1, $1, '', $2) RETURNING id`, [key, deptId]))[0].id;
const auditRows = async (action: string) => {
  // audit() — fire-and-forget: ждём строку до секунды.
  for (let i = 0; i < 20; i++) {
    const n = (await q(`SELECT 1 FROM audit_log WHERE action = $1`, [action])).length;
    if (n) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 0;
};

describe("даты проекта", () => {
  test("менеджер задаёт начало и цель; в роадмапе они и canEdit; в audit_log — project.roadmap", async () => {
    expect((await dates("mgr1", { startDate: "2026-10-01", targetDate: "2026-12-15" })).statusCode).toBe(204);
    const p = (await roadmap("mgr1")).projects.find((x) => x.id === fx.projects.p1)!;
    expect(p).toMatchObject({ startDate: "2026-10-01", targetDate: "2026-12-15", canEdit: true, total: 1, done: 0 });
    expect(await auditRows("project.roadmap")).toBe(1);
  });

  test("сотрудник и наблюдатель — 403, canEdit false; не участник — 403/404", async () => {
    for (const u of ["emp1", "viw1"]) expect((await dates(u, { startDate: "2026-10-01" })).statusCode).toBe(403);
    expect([403, 404]).toContain((await dates("mgr2", { startDate: "2026-10-01" })).statusCode);
    expect((await roadmap("emp1")).projects.find((x) => x.id === fx.projects.p1)?.canEdit).toBe(false);
  });

  test("цель раньше начала — 400 (и когда вторая дата уже сохранена); null снимает дату", async () => {
    expect((await dates("admin", { startDate: "2026-12-01", targetDate: "2026-11-01" })).statusCode).toBe(400);
    expect((await dates("admin", { startDate: "2026-12-01" })).statusCode).toBe(204);
    expect((await dates("admin", { targetDate: "2026-11-01" })).statusCode).toBe(400);
    expect((await dates("admin", { startDate: null, targetDate: "2026-11-01" })).statusCode).toBe(204);
    const p = (await roadmap("admin")).projects.find((x) => x.id === fx.projects.p1)!;
    expect([p.startDate, p.targetDate]).toEqual([null, "2026-11-01"]);
  });
});

describe("вехи", () => {
  test("добавить, переименовать, удалить; сортировка по дате; чужой проект — 404", async () => {
    const h = await as("mgr1");
    const url = `/api/projects/${fx.projects.p1}/milestones`;
    const a = await app.inject({ method: "POST", url, headers: h, payload: { name: "Бета", date: "2026-11-20" } });
    const b = await app.inject({ method: "POST", url, headers: h, payload: { name: "Альфа", date: "2026-10-20" } });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect((await app.inject({ method: "POST", url, headers: h, payload: { name: " ", date: "2026-10-20" } })).statusCode).toBe(400);
    let ms = (await roadmap("mgr1")).projects.find((x) => x.id === fx.projects.p1)!.milestones;
    expect(ms.map((m) => m.name)).toEqual(["Альфа", "Бета"]);

    const id = a.json().id as string;
    const r = await app.inject({ method: "PATCH", url: `${url}/${id}`, headers: h, payload: { name: "Релиз", date: "2026-09-30" } });
    expect(r.json()).toMatchObject({ name: "Релиз", date: "2026-09-30" });
    // Веху проекта P1 нельзя тронуть через адрес P2 (менеджер P2) — 404, а не правка чужой вехи.
    const other = await app.inject({ method: "DELETE", url: `/api/projects/${fx.projects.p2}/milestones/${id}`, headers: await as("mgr2") });
    expect(other.statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `${url}/${id}`, headers: h })).statusCode).toBe(204);
    ms = (await roadmap("mgr1")).projects.find((x) => x.id === fx.projects.p1)!.milestones;
    expect(ms.map((m) => m.name)).toEqual(["Альфа"]);
    expect((await app.inject({ method: "POST", url, headers: await as("emp1"), payload: { name: "x", date: "2026-10-20" } })).statusCode).toBe(403);
  });
});

describe("зависимости", () => {
  test("цикл отклоняется — прямой и через третий проект", async () => {
    const p3 = await mkProject("OPS");
    const { p1, p2 } = fx.projects;
    expect((await depend("admin", p2, p1)).statusCode).toBe(201); // P2 ждёт P1
    expect((await depend("admin", p2, p1)).statusCode).toBe(200); // повтор — без дубля
    const direct = await depend("admin", p1, p2); // P1 ждёт P2 → цикл
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error.code).toBe("DEPENDENCY_CYCLE");
    expect((await depend("admin", p3, p2)).statusCode).toBe(201); // OPS ждёт P2
    expect((await depend("admin", p1, p3)).statusCode).toBe(409); // P1 ждёт OPS → P1→P2→OPS→P1
    expect((await depend("admin", p1, p1)).statusCode).toBe(400);
    expect((await q(`SELECT 1 FROM project_dependencies`)).length).toBe(2);
    expect(await auditRows("project.dependency.add")).toBe(2);
  });

  test("право — в зависимом проекте; источник должен быть виден; роадмап скрывает невидимые", async () => {
    const { p1, p2 } = fx.projects;
    // mgr1 — менеджер P1, P2 ему не виден: ссылаться на него нельзя (404, неотличимо от несуществующего).
    expect((await depend("mgr1", p1, p2)).statusCode).toBe(404);
    // emp1 — сотрудник P1: права editRoadmap нет.
    expect((await depend("emp1", p1, p2)).statusCode).toBe(403);
    expect((await depend("admin", p1, p2)).statusCode).toBe(201);
    const mine = await roadmap("mgr1");
    expect(mine.projects.map((x) => x.id)).toEqual([p1]);
    expect(mine.dependencies).toEqual([]); // вторая сторона не видна — связь не показывается
    const all = await roadmap("admin");
    expect(all.dependencies).toEqual([{ sourceId: p2, dependentId: p1 }]);
    const del = await as("mgr1").then((headers) => app.inject({ method: "DELETE", url: `/api/projects/${p1}/dependencies/${p2}`, headers }));
    expect(del.statusCode).toBe(204);
  });

  test("удаление проекта убирает его вехи и зависимости", async () => {
    const { p1, p2 } = fx.projects;
    await depend("admin", p1, p2);
    await as("admin").then((headers) => app.inject({ method: "POST", url: `/api/projects/${p2}/milestones`, headers, payload: { name: "m", date: "2026-10-01" } }));
    const r = await as("admin").then((headers) => app.inject({ method: "DELETE", url: `/api/projects/${p2}`, headers }));
    expect(r.statusCode).toBeLessThan(300);
    expect((await q(`SELECT 1 FROM project_dependencies`)).length).toBe(0);
    expect((await q(`SELECT 1 FROM project_milestones`)).length).toBe(0);
  });
});

test("экспорт содержит даты проекта, вехи и зависимости", async () => {
  const { p1, p2 } = fx.projects;
  await dates("admin", { startDate: "2026-10-01" });
  await depend("admin", p1, p2);
  await as("admin").then((headers) => app.inject({ method: "POST", url: `/api/projects/${p1}/milestones`, headers, payload: { name: "Запуск", date: "2026-10-15" } }));
  const r = await app.inject({ url: "/api/admin/export", headers: await as("admin") });
  const lines = r.body.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(lines.find((l) => l.type === "project" && l.id === p1)).toHaveProperty("startDate");
  expect(lines.find((l) => l.type === "projectMilestone")).toMatchObject({ projectId: p1, name: "Запуск" });
  expect(lines.find((l) => l.type === "projectDependency")).toMatchObject({ sourceProjectId: p2, dependentProjectId: p1 });
});
