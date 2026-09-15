/** Главный экран: GET /api/issues/assigned-to-me (UI_RESTRUCTURE.md D4).
 *  Отдаёт только МОИ открытые задачи по ВИДИМЫМ проектам; чужие / закрытые /
 *  из недоступных проектов — нет. */
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
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
// Ответ — объект { items, truncated, limit }, а не голый массив: клиент должен
// знать, что список урезан потолком в 100 задач (аудит PERF-04).
const mine = (body: string) => JSON.parse(body).items.map((r: { key: string }) => r.key).sort();

const doneStatus = async (projectId: string) =>
  (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND category = 'done'`, [projectId]))[0].id;

describe("GET /api/issues/assigned-to-me", () => {
  test("emp1 видит свою открытую задачу в P1, но не чужую задачу P2", async () => {
    const emp = await login(app, "emp1");
    // fixture: CORP-1 назначена emp1 (todo); SEC-1 назначена mgr2.
    const res = await g("/api/issues/assigned-to-me", emp);
    expect(res.statusCode).toBe(200);
    expect(mine(res.body)).toEqual(["CORP-1"]);
  });

  test("закрытая задача (категория статуса done) в выдачу не попадает", async () => {
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    const done = await doneStatus(fx.projects.p1);
    await post(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, adm, { to: done });
    expect(mine((await g("/api/issues/assigned-to-me", emp)).body)).toEqual([]);
  });

  test("задача, назначенная мне в НЕвидимом проекте, не показывается", async () => {
    const emp = await login(app, "emp1");
    // emp1 не участник P2 и не в его департаменте. Назначаем напрямую в БД
    // (через API нельзя — assignee обязан быть участником проекта). DELETE
    // сначала — p2issue уже назначена на mgr2 в фикстуре, а тест хочет
    // ровно emp1, не emp1 вдобавок к mgr2 (issue_assignees, миграция 025).
    await q(`DELETE FROM issue_assignees WHERE issue_id = $1`, [fx.issues.p2issue]);
    await q(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p2issue, fx.users.emp1]);
    expect(mine((await g("/api/issues/assigned-to-me", emp)).body)).toEqual(["CORP-1"]);
  });

  test("is_shared делает проект видимым — моя задача из него появляется", async () => {
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    await q(`DELETE FROM issue_assignees WHERE issue_id = $1`, [fx.issues.p2issue]);
    await q(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p2issue, fx.users.emp1]);
    await patch(`/api/projects/${fx.projects.p2}`, adm, { isShared: true });
    expect(mine((await g("/api/issues/assigned-to-me", emp)).body)).toEqual(["CORP-1", "SEC-1"]);
  });

  test("глобальный admin видит назначенные ему задачи в любом проекте без членства", async () => {
    const adm = await login(app, "admin");
    await q(`DELETE FROM issue_assignees WHERE issue_id = $1`, [fx.issues.p2issue]);
    await q(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p2issue, fx.users.admin]);
    expect(mine((await g("/api/issues/assigned-to-me", adm)).body)).toEqual(["SEC-1"]);
  });

  test("ответ несёт флаг truncated и лимит", async () => {
    const emp = await login(app, "emp1");
    const body = JSON.parse((await g("/api/issues/assigned-to-me", emp)).body);
    expect(body.truncated).toBe(false);
    expect(body.limit).toBe(100);
  });

  test("сортировка: critical раньше low, затем по updated_at", async () => {
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    const a = JSON.parse(
      (await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeIds: [fx.users.emp1], priorityId: "low" }))).body,
    );
    const b = JSON.parse(
      (await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeIds: [fx.users.emp1], priorityId: "critical" }))).body,
    );
    const order = JSON.parse((await g("/api/issues/assigned-to-me", emp)).body).items.map((r: { key: string }) => r.key);
    // CORP-1 (medium, fixture) между critical и low
    expect(order.indexOf(b.key)).toBeLessThan(order.indexOf("CORP-1"));
    expect(order.indexOf("CORP-1")).toBeLessThan(order.indexOf(a.key));
  });
});
