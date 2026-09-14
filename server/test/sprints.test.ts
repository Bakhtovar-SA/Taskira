/** Спринты (sprints, миграция 023) — опциональный модуль. Вне проектов с
 *  sprints_enabled=true все роуты /sprints* и PATCH /issues/:id/sprint
 *  отвечают 404 независимо от роли — не просто спрятаны в UI. */
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
const post = (url: string, token: string, payload: unknown = {}) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });

const p1 = () => fx.projects.p1;
const sprintsUrl = () => `/api/projects/${p1()}/sprints`;
const issuesUrl = () => `/api/projects/${p1()}/issues`;

async function enableSprints(projectId: string): Promise<void> {
  await q(`UPDATE projects SET sprints_enabled = true WHERE id = $1`, [projectId]);
}

async function createIssue(token: string, over: Record<string, unknown> = {}): Promise<{ id: string; key: string }> {
  const r = await post(issuesUrl(), token, newIssue(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

async function createSprint(token: string, over: Record<string, unknown> = {}) {
  const r = await post(sprintsUrl(), token, { name: "Sprint 1", goal: "", ...over });
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("модуль спринтов выключен по умолчанию", () => {
  test("GET/POST /sprints* и PATCH /issues/:id/sprint — 404 без sprints_enabled, даже для admin", async () => {
    const admin = await login(app, "admin");
    const issue = await createIssue(admin);

    expect((await g(sprintsUrl(), admin)).statusCode).toBe(404);
    expect((await post(sprintsUrl(), admin, { name: "X" })).statusCode).toBe(404);
    expect((await post(`${sprintsUrl()}/00000000-0000-0000-0000-000000000000/start`, admin)).statusCode).toBe(404);
    expect((await patch(`${issuesUrl()}/${issue.id}/sprint`, admin, { sprintId: null })).statusCode).toBe(404);
  });

  test("404 не зависит от роли — employee (без manageSprints) тоже 404, не 403 (ревью PR #49)", async () => {
    // Гейт (assertSprintsEnabled) обязан выполниться ДО проверки права —
    // иначе requirePerm("manageSprints") отдал бы 403 раньше, чем модуль
    // вообще проверился бы на существование для этого проекта.
    const emp = await login(app, "emp1");
    const issue = await createIssue(await login(app, "admin"));

    expect((await g(sprintsUrl(), emp)).statusCode).toBe(404);
    expect((await post(sprintsUrl(), emp, { name: "X" })).statusCode).toBe(404);
    expect((await post(`${sprintsUrl()}/00000000-0000-0000-0000-000000000000/start`, emp)).statusCode).toBe(404);
    expect((await post(`${sprintsUrl()}/00000000-0000-0000-0000-000000000000/complete`, emp)).statusCode).toBe(404);
    expect((await patch(`${issuesUrl()}/${issue.id}/sprint`, emp, { sprintId: null })).statusCode).toBe(404);
  });

  test("bootstrap проекта возвращает sprints:[] и project.sprintsEnabled:false", async () => {
    const admin = await login(app, "admin");
    const boot = JSON.parse((await g(`/api/projects/${p1()}`, admin)).body);
    expect(boot.sprints).toEqual([]);
    expect(boot.project.sprintsEnabled).toBe(false);
  });

  test("выключение модуля ПОСЛЕ использования не оставляет спринты в bootstrap (ревью PR #49)", async () => {
    // Сценарий из ревью: включили → создали спринт (с текстом goal) →
    // выключили обратно — /sprints* уже 404-ят, но bootstrap раньше отдавал
    // их безусловно любому участнику с одним browse. Выключаем через
    // настоящий PATCH /api/projects/:id (не raw SQL) — он же инвалидирует
    // 30-секундный кэш projectById(), как в реальном сценарии через AdminView;
    // raw SQL здесь дал бы ложноположительный провал теста на самом кэше,
    // а не на проверяемой логике.
    const admin = await login(app, "admin");
    await enableSprints(p1());
    const sprint = await createSprint(admin, { name: "Конфиденциальный", goal: "секретные планы" });
    const off = await patch(`/api/projects/${p1()}`, admin, { sprintsEnabled: false });
    expect(off.statusCode).toBe(200);

    const viw = await login(app, "viw1");
    const boot = JSON.parse((await g(`/api/projects/${p1()}`, viw)).body);
    expect(boot.sprints).toEqual([]);
    expect(JSON.stringify(boot)).not.toContain(sprint.id);
  });
});

describe("права: manageSprints (admin/manager), не edit", () => {
  beforeEach(async () => {
    await enableSprints(p1());
  });

  test("manager создаёт спринт; employee/viewer/outsider — 403", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const viw = await login(app, "viw1");
    const out = await login(app, "outsider");

    expect((await post(sprintsUrl(), mgr, { name: "Sprint 1" })).statusCode).toBe(201);
    for (const token of [emp, viw, out]) {
      expect((await post(sprintsUrl(), token, { name: "X" })).statusCode).toBe(403);
    }
  });

  test("любой участник проекта видит список спринтов (browse), не только manageSprints", async () => {
    const mgr = await login(app, "mgr1");
    await createSprint(mgr);
    const viw = await login(app, "viw1");
    const list = JSON.parse((await g(sprintsUrl(), viw)).body);
    expect(list).toHaveLength(1);
  });

  test("employee не может назначить задачу в спринт, даже свою собственную", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const sprint = await createSprint(mgr);
    const issue = await createIssue(emp);
    expect((await patch(`${issuesUrl()}/${issue.id}/sprint`, emp, { sprintId: sprint.id })).statusCode).toBe(403);
  });
});

describe("создание и назначение задач", () => {
  beforeEach(async () => {
    await enableSprints(p1());
  });

  test("создание спринта → перенос задачи в него → видна в bootstrap.sprints и на задаче", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr, { name: "Sprint 1", goal: "Закрыть баги" });
    const issue = await createIssue(mgr);

    const r = await patch(`${issuesUrl()}/${issue.id}/sprint`, mgr, { sprintId: sprint.id });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).sprintId).toBe(sprint.id);

    const boot = JSON.parse((await g(`/api/projects/${p1()}`, mgr)).body);
    expect(boot.sprints).toHaveLength(1);
    expect(boot.sprints[0]).toMatchObject({ id: sprint.id, name: "Sprint 1", goal: "Закрыть баги", status: "future" });
  });

  test("sprintId: null снимает задачу обратно в бэклог", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    const issue = await createIssue(mgr);
    await patch(`${issuesUrl()}/${issue.id}/sprint`, mgr, { sprintId: sprint.id });

    const r = await patch(`${issuesUrl()}/${issue.id}/sprint`, mgr, { sprintId: null });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).sprintId).toBeNull();
  });

  test("нельзя назначить задачу в завершённый спринт", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    await post(`${sprintsUrl()}/${sprint.id}/start`, mgr);
    await post(`${sprintsUrl()}/${sprint.id}/complete`, mgr);
    const issue = await createIssue(mgr);

    const r = await patch(`${issuesUrl()}/${issue.id}/sprint`, mgr, { sprintId: sprint.id });
    expect(r.statusCode).toBe(400);
  });

  test("несуществующий/чужого проекта sprintId — 404", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(mgr);
    const r = await patch(`${issuesUrl()}/${issue.id}/sprint`, mgr, { sprintId: "00000000-0000-0000-0000-000000000000" });
    expect(r.statusCode).toBe(404);
  });
});

describe("старт спринта", () => {
  beforeEach(async () => {
    await enableSprints(p1());
  });

  test("future → active", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    const r = await post(`${sprintsUrl()}/${sprint.id}/start`, mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).status).toBe("active");
  });

  test("второй активный спринт в одном проекте — отклонён (409)", async () => {
    const mgr = await login(app, "mgr1");
    const s1 = await createSprint(mgr, { name: "Sprint 1" });
    const s2 = await createSprint(mgr, { name: "Sprint 2" });
    expect((await post(`${sprintsUrl()}/${s1.id}/start`, mgr)).statusCode).toBe(200);

    const r = await post(`${sprintsUrl()}/${s2.id}/start`, mgr);
    expect(r.statusCode).toBe(409);
  });

  test("повторный старт уже активного спринта — 400 (не future)", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    await post(`${sprintsUrl()}/${sprint.id}/start`, mgr);
    const r = await post(`${sprintsUrl()}/${sprint.id}/start`, mgr);
    expect(r.statusCode).toBe(400);
  });
});

describe("завершение спринта", () => {
  beforeEach(async () => {
    await enableSprints(p1());
  });

  test("active → completed; незакрытые задачи уходят в бэклог (sprintId: null), закрытые остаются на спринте", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    await post(`${sprintsUrl()}/${sprint.id}/start`, mgr);

    const open = await createIssue(mgr, { title: "не закрыта" });
    const done = await createIssue(mgr, { title: "закрыта" });
    await patch(`${issuesUrl()}/${open.id}/sprint`, mgr, { sprintId: sprint.id });
    await patch(`${issuesUrl()}/${done.id}/sprint`, mgr, { sprintId: sprint.id });
    // done_at выставляем напрямую — переход по workflow не тема этого теста.
    await q(`UPDATE issues SET done_at = now() WHERE id = $1`, [done.id]);

    const r = await post(`${sprintsUrl()}/${sprint.id}/complete`, mgr);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.sprint.status).toBe("completed");
    expect(body.movedToBacklog).toBe(1);

    const list = JSON.parse((await g(issuesUrl(), mgr)).body).items as { id: string; sprintId: string | null }[];
    expect(list.find((i) => i.id === open.id)!.sprintId).toBeNull();
    expect(list.find((i) => i.id === done.id)!.sprintId).toBe(sprint.id);
  });

  test("нельзя завершить спринт в статусе «будущий»", async () => {
    const mgr = await login(app, "mgr1");
    const sprint = await createSprint(mgr);
    const r = await post(`${sprintsUrl()}/${sprint.id}/complete`, mgr);
    expect(r.statusCode).toBe(400);
  });

  test("после завершения можно сразу стартовать другой спринт", async () => {
    const mgr = await login(app, "mgr1");
    const s1 = await createSprint(mgr, { name: "Sprint 1" });
    const s2 = await createSprint(mgr, { name: "Sprint 2" });
    await post(`${sprintsUrl()}/${s1.id}/start`, mgr);
    await post(`${sprintsUrl()}/${s1.id}/complete`, mgr);
    const r = await post(`${sprintsUrl()}/${s2.id}/start`, mgr);
    expect(r.statusCode).toBe(200);
  });
});
