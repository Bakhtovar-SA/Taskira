/** Дашборды (ADR-0022): личные, общие, обзор проекта и данные виджетов под видимостью смотрящего. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { LIMITS } from "../src/contract.js";
import { DATA_IN_FLIGHT_PER_USER, acquireDataSlot, releaseDataSlot } from "../src/routes/dashboards.js";
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

const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), payload: payload as never });
const body = <T = Record<string, unknown>>(r: { body: string }): T => JSON.parse(r.body) as T;

const count = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "count", metric: "open", x: 0, y: 0, w: 3, h: 2, ...over });

describe("личные и общие дашборды", () => {
  test("личный видит и правит только владелец; для остальных он не существует", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const created = await req("POST", "/api/dashboards", mgr, { name: "Мой", widgets: [count("a")] });
    expect(created.statusCode).toBe(201);
    const d = body<{ id: string; kind: string; canEdit: boolean }>(created);
    expect(d.kind).toBe("personal");
    expect(d.canEdit).toBe(true);

    expect(body<unknown[]>(await req("GET", "/api/dashboards", mgr))).toHaveLength(1);
    expect(body<unknown[]>(await req("GET", "/api/dashboards", emp))).toHaveLength(0);
    expect((await req("GET", `/api/dashboards/${d.id}`, emp)).statusCode).toBe(404);
    expect((await req("PATCH", `/api/dashboards/${d.id}`, emp, { name: "Чужой" })).statusCode).toBe(404);
    expect((await req("DELETE", `/api/dashboards/${d.id}`, emp)).statusCode).toBe(404);

    const renamed = await req("PATCH", `/api/dashboards/${d.id}`, mgr, { name: "Переименован" });
    expect(body<{ name: string }>(renamed).name).toBe("Переименован");
    expect((await req("DELETE", `/api/dashboards/${d.id}`, mgr)).statusCode).toBe(204);
  });

  test("общий создаёт только администратор; остальные видят его без права правки", async () => {
    const mgr = await login(app, "mgr1");
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    expect((await req("POST", "/api/dashboards", mgr, { name: "Для всех", shared: true })).statusCode).toBe(403);

    const d = body<{ id: string; kind: string }>(await req("POST", "/api/dashboards", adm, { name: "Для всех", shared: true, widgets: [count("a")] }));
    expect(d.kind).toBe("org");
    const list = body<{ id: string; canEdit: boolean }[]>(await req("GET", "/api/dashboards", emp));
    expect(list.map((x) => x.id)).toEqual([d.id]);
    expect(list[0].canEdit).toBe(false);
    expect((await req("PATCH", `/api/dashboards/${d.id}`, emp, { name: "Моё" })).statusCode).toBe(403);
    expect((await req("DELETE", `/api/dashboards/${d.id}`, emp)).statusCode).toBe(403);
  });

  test("сетку и состав виджетов проверяет сервер", async () => {
    const mgr = await login(app, "mgr1");
    const post = (widgets: unknown[]) => req("POST", "/api/dashboards", mgr, { name: "Д", widgets });
    expect((await post([count("a", { x: 10, w: 4 })])).statusCode).toBe(400); // за 12 колонок
    expect((await post([count("a"), count("a", { y: 2 })])).statusCode).toBe(400); // повтор id
    expect((await post([{ ...count("a"), type: "pie" }])).statusCode).toBe(400); // неизвестный тип
    expect((await post([count("a", { metric: "всё" })])).statusCode).toBe(400);
    const many = Array.from({ length: LIMITS.widgetsPerDashboard + 1 }, (_, i) => count(`w${i}`, { y: i }));
    expect((await post(many)).statusCode).toBe(400);
  });

  test("личных дашбордов не больше лимита", async () => {
    const mgr = await login(app, "mgr1");
    for (let i = 0; i < LIMITS.dashboardsPerUser; i++) {
      expect((await req("POST", "/api/dashboards", mgr, { name: `Д${i}` })).statusCode).toBe(201);
    }
    const over = await req("POST", "/api/dashboards", mgr, { name: "Лишний" });
    expect(over.statusCode).toBe(409);
    expect(body<{ error: { code: string } }>(over).error.code).toBe("LIMIT");
  });

  test("одновременные запросы не обходят лимит личных дашбордов", async () => {
    const mgr = await login(app, "mgr1");
    const rs = await Promise.all(Array.from({ length: LIMITS.dashboardsPerUser + 5 }, (_, i) => req("POST", "/api/dashboards", mgr, { name: `Д${i}` })));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(LIMITS.dashboardsPerUser);
    expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(5);
  });

  test("вернуть общий дашборд в личные нельзя сверх лимита личных", async () => {
    const adm = await login(app, "admin");
    const shared = body<{ id: string }>(await req("POST", "/api/dashboards", adm, { name: "Общий", shared: true }));
    for (let i = 0; i < LIMITS.dashboardsPerUser; i++) await req("POST", "/api/dashboards", adm, { name: `Д${i}` });
    const r = await req("PATCH", `/api/dashboards/${shared.id}`, adm, { shared: false });
    expect(r.statusCode).toBe(409);
  });

  test("два общих дашборда переводятся в личные одновременно — лимит личных соблюдается", async () => {
    const adm = await login(app, "admin");
    for (let i = 0; i < LIMITS.dashboardsPerUser - 1; i++) await req("POST", "/api/dashboards", adm, { name: `Д${i}` });
    const a = body<{ id: string }>(await req("POST", "/api/dashboards", adm, { name: "А", shared: true }));
    const b = body<{ id: string }>(await req("POST", "/api/dashboards", adm, { name: "Б", shared: true }));
    const rs = await Promise.all([a.id, b.id].map((id) => req("PATCH", `/api/dashboards/${id}`, adm, { shared: false })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM dashboards WHERE NOT shared AND project_id IS NULL`);
    expect(n).toBe(LIMITS.dashboardsPerUser);
  });

  test("виджет неизвестного типа в сохранённой строке отбрасывается, а не ломает дашборд", async () => {
    const mgr = await login(app, "mgr1");
    const d = body<{ id: string }>(await req("POST", "/api/dashboards", mgr, { name: "Д", widgets: [count("a")] }));
    await q(`UPDATE dashboards SET widgets = widgets || '[{"id":"z","type":"future","x":0,"y":5,"w":2,"h":2}]'::jsonb WHERE id = $1`, [d.id]);
    const got = body<{ widgets: { id: string }[] }>(await req("GET", `/api/dashboards/${d.id}`, mgr));
    expect(got.widgets.map((w) => w.id)).toEqual(["a"]);
    // Сохранение набора — полная замена: виджет, которого клиент не видел, после него пропадает (ADR-0022, откат).
    await req("PATCH", `/api/dashboards/${d.id}`, mgr, { widgets: got.widgets });
    const [row] = await q<{ widgets: { id: string }[] }>(`SELECT widgets FROM dashboards WHERE id = $1`, [d.id]);
    expect(row.widgets.map((w) => w.id)).toEqual(["a"]);
  });
});

describe("данные виджетов — только видимые проекты", () => {
  const data = (token: string, widgets: unknown[], projectId?: string) => req("POST", "/api/dashboards/data", token, { widgets, projectId });

  test("чужой проект в настройках виджета даёт пустые данные, а не чужие цифры", async () => {
    const emp = await login(app, "emp1");
    const adm = await login(app, "admin");
    const widgets = [count("all"), count("sec", { projectId: fx.projects.p2 })];
    const mine = body<{ results: Record<string, { value: number }> }>(await data(emp, widgets)).results;
    expect(mine.all.value).toBe(1); // только задача CORP
    expect(mine.sec.value).toBe(0); // SEC ему не виден
    const admins = body<{ results: Record<string, { value: number }> }>(await data(adm, widgets)).results;
    expect(admins.all.value).toBe(2);
    expect(admins.sec.value).toBe(1);
  });

  test("обзор проекта: область всех виджетов — этот проект; невидимый проект — 404", async () => {
    const emp = await login(app, "emp1");
    const r = body<{ results: Record<string, { value: number }> }>(await data(emp, [count("x", { projectId: fx.projects.p2 })], fx.projects.p1)).results;
    expect(r.x.value).toBe(1);
    expect((await data(emp, [count("x")], fx.projects.p2)).statusCode).toBe(404);
  });

  test("расчёт, упавший с ошибкой, освобождает слот: следующий запрос не получает 429", async () => {
    const emp = await login(app, "emp1");
    for (let i = 0; i < DATA_IN_FLIGHT_PER_USER + 1; i++) expect((await data(emp, [count("x")], fx.projects.p2)).statusCode).toBe(404);
    expect((await data(emp, [count("x")])).statusCode).toBe(200);
  });

  test("тренд: по неделям, пустые недели — нули, создание и закрытие считаются в свою неделю", async () => {
    const adm = await login(app, "admin");
    // CORP-1 создана 3 недели назад и закрыта неделю назад; задача SEC создана на этой неделе.
    await q(`UPDATE issues SET created_at = date_trunc('week', now()) - interval '21 days' + interval '1 hour',
                                done_at = date_trunc('week', now()) - interval '7 days' + interval '2 hours' WHERE id = $1`, [fx.issues.p1issue]);
    await q(`UPDATE issues SET created_at = date_trunc('week', now()) + interval '1 minute', done_at = NULL WHERE project_id = $1`, [fx.projects.p2]);
    const r = body<{ results: Record<string, { weeks: { week: string; created: number; closed: number }[] }> }>(
      await req("POST", "/api/dashboards/data", adm, { widgets: [{ id: "t", type: "trend", periodDays: 30, x: 0, y: 0, w: 8, h: 4 }] }),
    ).results.t.weeks;
    expect(r.length).toBeGreaterThanOrEqual(5);
    const last = r.length - 1;
    expect(r[last]).toMatchObject({ created: 1, closed: 0 });
    expect(r[last - 1]).toMatchObject({ created: 0, closed: 1 });
    expect(r[last - 2]).toMatchObject({ created: 0, closed: 0 });
    expect(r[last - 3]).toMatchObject({ created: 1, closed: 0 });
    expect(r.reduce((s, w) => s + w.created, 0)).toBe(2);
  });

  test("каждый тип виджета отдаёт данные своей формы", async () => {
    const emp = await login(app, "emp1");
    await q(`INSERT INTO activity (issue_id, actor_id, text) VALUES ($1, $2, 'создал(а) задачу')`, [fx.issues.p1issue, fx.users.emp1]);
    await q(`UPDATE issues SET due_date = CURRENT_DATE - 1 WHERE id = $1`, [fx.issues.p1issue]);
    const widgets = [
      count("c", { metric: "overdue" }),
      { id: "b", type: "breakdown", groupBy: "status", x: 0, y: 2, w: 4, h: 3 },
      { id: "t", type: "trend", periodDays: 30, x: 4, y: 2, w: 8, h: 3 },
      { id: "i", type: "issues", preset: "mine", x: 0, y: 5, w: 6, h: 3 },
      { id: "wl", type: "workload", x: 6, y: 5, w: 6, h: 3 },
      { id: "p", type: "progress", x: 0, y: 8, w: 6, h: 3 },
      { id: "a", type: "activity", x: 6, y: 8, w: 6, h: 3 },
    ];
    const r = body<{ results: Record<string, Record<string, unknown>> }>(await data(emp, widgets)).results;
    expect(r.c).toEqual({ type: "count", value: 1 });
    expect(r.b).toMatchObject({ type: "breakdown", total: 1, items: [{ category: "todo", count: 1 }] });
    expect((r.t.weeks as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect(r.i).toMatchObject({ type: "issues", truncated: false, items: [{ key: "CORP-1", statusCategory: "todo" }] });
    expect(r.wl).toMatchObject({ type: "workload", items: [{ name: "Employee One", overdue: 1, dueSoon: 0, other: 0 }] });
    expect(r.p).toMatchObject({ type: "progress", items: [{ key: "CORP", done: 0, total: 1, overdue: 1 }] });
    expect(r.a).toMatchObject({ type: "activity", items: [{ issueKey: "CORP-1", actorName: "Employee One" }] });
  });
});

describe("обзор проекта", () => {
  const url = () => `/api/projects/${fx.projects.p1}/overview`;
  const widgets = [count("a")];

  test("смотрят все участники, собирают менеджер и администратор; сброс возвращает встроенный", async () => {
    const viw = await login(app, "viw1");
    const mgr = await login(app, "mgr1");
    const out = await login(app, "outsider");

    expect(body(await req("GET", url(), viw))).toEqual({ dashboard: null, canEdit: false });
    expect((await req("GET", url(), out)).statusCode).toBe(403);
    expect((await req("PUT", url(), viw, { widgets })).statusCode).toBe(403);

    const saved = await req("PUT", url(), mgr, { widgets });
    expect(saved.statusCode).toBe(200);
    expect(body<{ kind: string }>(saved).kind).toBe("project");
    // Повторное сохранение обновляет ту же строку, а не создаёт вторую.
    await req("PUT", url(), mgr, { widgets: [count("a"), count("b", { x: 3 })] });
    const seen = body<{ dashboard: { widgets: unknown[]; canEdit: boolean }; canEdit: boolean }>(await req("GET", url(), viw));
    expect(seen.dashboard.widgets).toHaveLength(2);
    expect(seen.canEdit).toBe(false);
    expect((await q(`SELECT 1 FROM dashboards WHERE project_id = $1`, [fx.projects.p1])).length).toBe(1);

    expect((await req("DELETE", url(), mgr)).statusCode).toBe(204);
    expect(body<{ dashboard: null }>(await req("GET", url(), mgr)).dashboard).toBeNull();
  });

  test("обзор проекта не попадает в список дашбордов организации", async () => {
    const mgr = await login(app, "mgr1");
    await req("PUT", url(), mgr, { widgets });
    expect(body<unknown[]>(await req("GET", "/api/dashboards", mgr))).toHaveLength(0);
  });
});

test("полный экспорт содержит общие дашборды и обзоры проектов, но не личные", async () => {
  const adm = await login(app, "admin");
  const mgr = await login(app, "mgr1");
  await req("POST", "/api/dashboards", adm, { name: "Для всех", shared: true });
  await req("POST", "/api/dashboards", mgr, { name: "Мой" });
  await req("PUT", `/api/projects/${fx.projects.p1}/overview`, mgr, { widgets: [count("a")] });
  const r = await req("GET", "/api/admin/export", adm);
  const names = r.body
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.type === "dashboard")
    .map((l) => l.name);
  expect(names.sort()).toEqual(["Для всех", "Обзор"]);
});

test("одновременных расчётов данных у одного человека не больше предела; освобождённый слот снова доступен", () => {
  for (let i = 0; i < DATA_IN_FLIGHT_PER_USER; i++) expect(acquireDataSlot("u-x")).toBe(true);
  expect(acquireDataSlot("u-x")).toBe(false);
  expect(acquireDataSlot("u-y")).toBe(true); // у другого человека свой счёт
  releaseDataSlot("u-x");
  expect(acquireDataSlot("u-x")).toBe(true);
  for (let i = 0; i < DATA_IN_FLIGHT_PER_USER; i++) releaseDataSlot("u-x");
  releaseDataSlot("u-y");
});
