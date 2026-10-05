/** Отчёты и выгрузка: агрегаты, границы периода и — главное — ВИДИМОСТЬ.
 *
 *  Отчёт не имеет права показать больше, чем пользователю доступно в интерфейсе.
 *  Это здесь основной предмет проверки: агрегат по чужому проекту утекал бы
 *  тише, чем сама задача, и заметить это было бы некому.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
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

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_AGO = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const period = `from=${YEAR_AGO}&to=${TODAY}`;

/** Закрыть задачу напрямую в БД: нас интересуют агрегаты, а не путь перехода. */
const closeIssue = (issueId: string, daysAgo = 1) =>
  q(
    `UPDATE issues
        SET done_at = now() - make_interval(days => $2::int),
            status_id = (SELECT id FROM workflow_statuses
                          WHERE project_id = (SELECT project_id FROM issues WHERE id = $1)
                            AND category = 'done' LIMIT 1)
      WHERE id = $1`,
    [issueId, daysAgo],
  );

describe("GET /api/reports/summary — видимость", () => {
  test("сотрудник видит агрегат только по своим проектам", async () => {
    const emp = await login(app, "emp1"); // участник P1, не участник P2
    await closeIssue(fx.issues.p1issue);
    await closeIssue(fx.issues.p2issue);

    const body = JSON.parse((await g(`/api/reports/summary?${period}`, emp)).body);
    expect(body.projectCount).toBe(1);
    expect(body.totals.closed).toBe(1); // только CORP-1, не SEC-1
    expect(body.rows.map((r: { label: string }) => r.label)).toEqual(["Corp"]);
  });

  test("глобальный admin видит свод по всем проектам", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue);
    await closeIssue(fx.issues.p2issue);

    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.projectCount).toBe(2);
    expect(body.totals.closed).toBe(2);
  });

  test("запрос чужого проекта по id не раскрывает его данные", async () => {
    const emp = await login(app, "emp1");
    await closeIssue(fx.issues.p2issue);
    const body = JSON.parse((await g(`/api/reports/summary?${period}&projectId=${fx.projects.p2}`, emp)).body);
    // Не 403, а честный пустой отчёт: существование проекта не подтверждаем.
    expect(body.projectCount).toBe(0);
    expect(body.totals.closed).toBe(0);
    expect(body.rows).toEqual([]);
  });

  test("пользователь без единого проекта получает пустой отчёт, а не ошибку", async () => {
    const out = await login(app, "outsider");
    const res = await g(`/api/reports/summary?${period}`, out);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).totals.closed).toBe(0);
  });

  test("без авторизации — 401", async () => {
    expect((await app.inject({ url: `/api/reports/summary?${period}` })).statusCode).toBe(401);
  });
});

describe("GET /api/reports/summary — счёт", () => {
  test("закрытое вне периода в closed не попадает", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue, 200); // 200 дней назад

    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const body = JSON.parse((await g(`/api/reports/summary?from=${recent}&to=${TODAY}`, adm)).body);
    expect(body.totals.closed).toBe(0);

    const wide = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(wide.totals.closed).toBe(1);
  });

  test("open считает незакрытые независимо от периода", async () => {
    const adm = await login(app, "admin");
    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.totals.open).toBe(2); // обе фикстурные задачи ещё в todo
    expect(body.totals.closed).toBe(0);
  });

  test("считает время жизни задачи", async () => {
    const adm = await login(app, "admin");
    await q(`UPDATE issues SET created_at = now() - interval '11 days' WHERE id = $1`, [fx.issues.p1issue]);
    await closeIssue(fx.issues.p1issue, 1); // закрыта вчера => ~10 дней в работе

    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.totals.avgLeadDays).toBeGreaterThan(9);
    expect(body.totals.avgLeadDays).toBeLessThan(11);
    expect(body.totals.medianLeadDays).toBeGreaterThan(9);
  });

  test("groupBy=assignee разбивает по исполнителям", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue);
    const body = JSON.parse((await g(`/api/reports/summary?${period}&groupBy=assignee`, adm)).body);
    const row = body.rows.find((r: { label: string }) => r.label === "Employee One");
    expect(row?.closed).toBe(1);
  });

  test("архивные задачи из отчёта не выпадают — архив не переписывает историю", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue, 40);
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [fx.issues.p1issue]);
    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.totals.closed).toBe(1);
  });
});

describe("период", () => {
  test("вывернутый период — 400", async () => {
    const adm = await login(app, "admin");
    const res = await g(`/api/reports/summary?from=${TODAY}&to=${YEAR_AGO}`, adm);
    expect(res.statusCode).toBe(400);
  });

  test("кривая дата — 400", async () => {
    const adm = await login(app, "admin");
    expect((await g(`/api/reports/summary?from=вчера&to=${TODAY}`, adm)).statusCode).toBe(400);
  });

  test("слишком длинный период — 400", async () => {
    const adm = await login(app, "admin");
    expect((await g(`/api/reports/summary?from=2000-01-01&to=${TODAY}`, adm)).statusCode).toBe(400);
  });
});

describe("GET /api/reports/issues.csv", () => {
  test("отдаёт CSV с BOM, заголовком и вложением", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue);
    const res = await g(`/api/reports/issues.csv?${period}`, adm);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("attachment");
    expect(res.body.startsWith("﻿")).toBe(true); // без BOM Excel читает как cp1251
    expect(res.body).toContain("Ключ;Название;Проект");
    expect(res.body).toContain("CORP-1");
  });

  test("выгрузка ограничена видимыми проектами", async () => {
    const emp = await login(app, "emp1");
    await closeIssue(fx.issues.p1issue);
    await closeIssue(fx.issues.p2issue);
    const body = (await g(`/api/reports/issues.csv?${period}`, emp)).body;
    expect(body).toContain("CORP-1");
    expect(body).not.toContain("SEC-1");
  });

  test("scope=open отдаёт открытые задачи", async () => {
    const adm = await login(app, "admin");
    const body = (await g(`/api/reports/issues.csv?${period}&scope=open`, adm)).body;
    expect(body).toContain("CORP-1");
    expect(body).toContain("SEC-1");
  });

  test("формулы в названии задачи обезвреживаются", async () => {
    const adm = await login(app, "admin");
    await q(`UPDATE issues SET title = $2 WHERE id = $1`, [fx.issues.p1issue, "=1+1"]);
    await closeIssue(fx.issues.p1issue);
    const body = (await g(`/api/reports/issues.csv?${period}`, adm)).body;
    expect(body).toContain("'=1+1"); // апостроф — Excel покажет текст, а не посчитает
  });

  test("разделитель и кавычки экранируются по RFC 4180", async () => {
    const adm = await login(app, "admin");
    await q(`UPDATE issues SET title = $2 WHERE id = $1`, [fx.issues.p1issue, 'от; и "кавычка"']);
    await closeIssue(fx.issues.p1issue);
    const body = (await g(`/api/reports/issues.csv?${period}`, adm)).body;
    expect(body).toContain('"от; и ""кавычка"""');
  });
});

describe("UI refresh report data", () => {
  test("weekly created and closed series agree with totals and include zero weeks", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue);
    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.trend.reduce((sum: number, p: { created: number }) => sum + p.created, 0)).toBe(body.totals.created);
    expect(body.trend.reduce((sum: number, p: { closed: number }) => sum + p.closed, 0)).toBe(body.totals.closed);
    expect(body.trend.some((p: { created: number; closed: number }) => p.created === 0 && p.closed === 0)).toBe(true);
    expect(body.trend.map((p: { week: string }) => p.week)).toEqual([...body.trend.map((p: { week: string }) => p.week)].sort());
  });
  test("a created-only closed project remains in the breakdown", async () => {
    const adm = await login(app, "admin");
    await closeIssue(fx.issues.p1issue, 200);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const body = JSON.parse((await g(`/api/reports/summary?from=${from}&to=${TODAY}&projectId=${fx.projects.p1}`, adm)).body);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ created: 1, closed: 0, open: 0, overdue: 0 });
  });
  test("overdue project counts equal the current total", async () => {
    const adm = await login(app, "admin");
    await q(`UPDATE issues SET due_date = CURRENT_DATE - 1 WHERE id = $1`, [fx.issues.p1issue]);
    const body = JSON.parse((await g(`/api/reports/summary?${period}`, adm)).body);
    expect(body.rows.find((r: { key: string }) => r.key === fx.projects.p1).overdue).toBe(1);
    expect(body.rows.reduce((sum: number, r: { overdue: number }) => sum + r.overdue, 0)).toBe(body.totals.overdue);
  });
  test("multiple project selection is intersected with visibility in JSON and CSV", async () => {
    const emp = await login(app, "emp1");
    const adm = await login(app, "admin");
    const filter = `projectIds=${fx.projects.p1},${fx.projects.p2},${fx.projects.p1}`;
    const body = JSON.parse((await g(`/api/reports/summary?${period}&${filter}`, emp)).body);
    expect(body.projectCount).toBe(1);
    expect(body.rows.map((r: { label: string }) => r.label)).toEqual(["Corp"]);
    const csv = await g(`/api/reports/issues.csv?${period}&scope=open&${filter}`, emp);
    expect(csv.statusCode).toBe(200); expect(csv.body).toContain("CORP-1"); expect(csv.body).not.toContain("SEC-1");
    const filtered = JSON.parse((await g(`/api/reports/summary?${period}&projectIds=${fx.projects.p2}`, adm)).body);
    expect(filtered.projectCount).toBe(1); expect(filtered.rows.map((r: { key: string }) => r.key)).toEqual([fx.projects.p2]);
  });
  test("invalid comma-separated project ids are rejected", async () => {
    const adm = await login(app, "admin");
    for (const ids of ["", "bad-id", `${fx.projects.p1},`]) {
      expect((await g(`/api/reports/summary?${period}&projectIds=${ids}`, adm)).statusCode).toBe(400);
    }
  });
});
