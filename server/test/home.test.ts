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
  test("stable status identity and project role survive a renamed review; returning from review is explicit", async () => {
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    const statuses = await q<{ id: string; sid: string }>("SELECT id, sid FROM workflow_statuses WHERE project_id = $1", [fx.projects.p1]);
    const review = statuses.find(s => s.sid === "review")!;
    const work = statuses.find(s => s.sid === "inprogress")!;
    expect((await post(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, adm, { to: work.id })).statusCode).toBe(200);
    await q("UPDATE workflow_statuses SET name = 'Проверить результат' WHERE id = $1", [review.id]);
    expect((await post(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, adm, { to: review.id })).statusCode).toBe(200);
    const reviewed = (await g("/api/issues/assigned-to-me", emp)).json().items[0];
    expect(reviewed).toMatchObject({ statusSid: "review", statusName: "Проверить результат", projectRole: "employee", returnedForRework: false });
    expect((await post(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, adm, { to: work.id })).statusCode).toBe(200);
    expect((await g("/api/issues/assigned-to-me", emp)).json().items[0]).toMatchObject({ statusSid: "inprogress", returnedForRework: true });
    const todo = statuses.find(s => s.sid === "todo")!;
    expect((await post(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, adm, { to: todo.id })).statusCode).toBe(200);
    expect((await g("/api/issues/assigned-to-me", emp)).json().items[0].returnedForRework).toBe(false);
  });
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

  test("bounded history lookup preserves the top 100, truncation and legacy status payloads", async () => {
    const emp = await login(app, "emp1");
    const inserted = await q<{ id: string; key: string }>(
      `INSERT INTO issues (project_id, num, key, title, type_id, status_id, priority_id, reporter_id, updated_at)
       SELECT project_id, 1000 + n, 'CORP-' || (1000 + n), 'Window test', type_id, status_id,
              CASE WHEN n = 110 THEN 'critical' ELSE 'low' END, reporter_id,
              '2026-10-01'::timestamptz + n * interval '1 second'
         FROM issues CROSS JOIN generate_series(1, 110) n WHERE id = $1
       RETURNING id, key`, [fx.issues.p1issue],
    );
    await q(`INSERT INTO issue_assignees (issue_id, user_id) SELECT id, $1 FROM issues WHERE num >= 1000`, [fx.users.emp1]);
    const critical = inserted.find(i => i.key === "CORP-1110")!;
    await q(`INSERT INTO activity (issue_id, actor_id, text, kind, payload)
             VALUES ($1, $2, 'Legacy transition', 'status', '{"from":"На ревью","to":"К выполнению"}')`, [critical.id, fx.users.admin]);
    const body = (await g("/api/issues/assigned-to-me", emp)).json();
    expect(body).toMatchObject({ truncated: true, limit: 100 });
    expect(body.items).toHaveLength(100);
    expect(body.items[0]).toMatchObject({ key: critical.key, returnedForRework: false });
    expect(body.items[1].key).toBe("CORP-1");
    expect(body.items[2].key).toBe("CORP-1109");
    expect(body.items.some((i: { key: string }) => i.key === "CORP-1001")).toBe(false);
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
