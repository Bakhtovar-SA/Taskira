/**
 * SEC-RATE-01: лимиты чувствительных маршрутов (routeLimits.ts поверх @fastify/rate-limit из app.ts).
 * Изоляция: каждый тест поднимает собственный экземпляр приложения — хранилище лимитера у него своё (в памяти
 * процесса), поэтому счётчики не текут между тестами; `loadConfig().rateLimit` возвращается в исходное состояние.
 */
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { auth, getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let fx: Fixture, admin: string, employee: string;
const cfg = () => loadConfig().rateLimit;
let saved = { ...cfg() };
const opened: FastifyInstance[] = [];

beforeAll(async () => {
  await getApp();
  saved = { ...cfg() };
});
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  const base = await getApp();
  admin = await login(base, "admin");
  employee = await login(base, "emp1");
});
afterEach(async () => {
  for (const a of opened.splice(0)) await a.close();
  Object.assign(cfg(), saved);
});

/** Новый экземпляр с включённым лимитером и малыми порогами. */
async function limited(over: Partial<typeof saved> = {}): Promise<FastifyInstance> {
  Object.assign(cfg(), { enabled: true, max: 1000, windowMs: 60_000, actionWindowMs: 60_000, sensitiveMax: 2, exportMax: 2, searchMax: 2, dashboardDataMax: 2 }, over);
  const a = buildApp();
  opened.push(a);
  await a.ready();
  return a;
}
const hit = (a: FastifyInstance, token: string, method: InjectOptions["method"], url: string, payload?: object) =>
  a.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload }) });

/** Первые `max` запросов не получают 429, следующий — получает RATE_LIMITED. */
async function expectLimit(a: FastifyInstance, token: string, max: number, method: InjectOptions["method"], url: string, payload?: object) {
  for (let i = 0; i < max; i++) expect((await hit(a, token, method, url, payload)).statusCode, `запрос ${i + 1}`).not.toBe(429);
  const blocked = await hit(a, token, method, url, payload);
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().error.code).toBe("RATE_LIMITED");
}

const nobody = "00000000-0000-4000-8000-000000000000";
const wh = `/api/projects/${nobody}/webhooks/${nobody}`;

describe("SEC-RATE-01", () => {
  test("создание личного API-токена", async () => {
    const a = await limited();
    const body = { name: "T", scope: "read", expiresInDays: 30 };
    for (let i = 0; i < 2; i++) expect((await hit(a, employee, "POST", "/api/me/tokens", body)).statusCode).toBe(201);
    const r = await hit(a, employee, "POST", "/api/me/tokens", body);
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("RATE_LIMITED");
    // ключ — пользователь: другой человек не затронут
    expect((await hit(a, admin, "POST", "/api/me/tokens", body)).statusCode).toBe(201);
  });

  test("создание токена служебной учётной записи", async () => {
    const a = await limited();
    await expectLimit(a, admin, 2, "POST", `/api/admin/service-accounts/${nobody}/tokens`, { name: "T", scope: "read", expiresInDays: 30 });
  });

  test.each([
    ["ping", `${wh}/ping`, undefined],
    ["rotate-secret", `${wh}/rotate-secret`, undefined],
    ["redeliver", `${wh}/deliveries/${nobody}/redeliver`, undefined],
    ["redeliver-failed", `${wh}/redeliver-failed`, { since: new Date().toISOString() }],
  ])("вебхук: %s", async (_n, url, payload) => {
    const a = await limited();
    await expectLimit(a, admin, 2, "POST", url, payload);
  });

  test("корзины маршрутов раздельны", async () => {
    const a = await limited();
    await expectLimit(a, admin, 2, "POST", `${wh}/ping`);
    expect((await hit(a, admin, "POST", `${wh}/rotate-secret`)).statusCode).not.toBe(429);
  });

  test("выдача личных и служебных токенов имеет независимые sensitive-корзины для одного админа", async () => {
    const a = await limited();
    const created = await hit(a, admin, "POST", "/api/admin/service-accounts", { username: "rate.bot", name: "Rate test" });
    expect(created.statusCode).toBe(201);
    const paths = ["/api/me/tokens", `/api/admin/service-accounts/${created.json().id}/tokens`];
    const body = { name: "Independent bucket", scope: "read", expiresInDays: 30 };
    for (const path of paths) {
      for (let i = 0; i < 2; i++) expect((await hit(a, admin, "POST", path, body)).statusCode).toBe(201);
      expect((await hit(a, admin, "POST", path, body)).statusCode).toBe(429);
    }
  });

  test.each([false, true])("search и recurring preview не расходуют квоту друг друга (preview первым: %s)", async previewFirst => {
    const a = await limited();
    const previewBody = { schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: "2024-01-01" };
    const search = () => hit(a, admin, "GET", "/api/issues/search?q=test");
    const preview = () => hit(a, admin, "POST", `/api/projects/${fx.projects.p1}/recurring/preview`, previewBody);
    for (const request of previewFirst ? [preview, search] : [search, preview]) {
      for (let i = 0; i < 2; i++) expect((await request()).statusCode).toBe(200);
      expect((await request()).statusCode).toBe(429);
    }
  });

  test.each([
    ["полный экспорт", "/api/admin/export"],
    ["экспорт аудита", "/api/admin/audit-log/export?format=csv"],
    ["CSV-отчёт", "/api/reports/issues.csv"],
  ])("%s", async (_n, url) => {
    const a = await limited();
    await expectLimit(a, admin, 2, "GET", url);
  });

  test("поиск", async () => {
    const a = await limited();
    await expectLimit(a, employee, 2, "GET", "/api/issues/search?q=test");
  });

  test("POST /dashboards/data", async () => {
    const a = await limited();
    await expectLimit(a, employee, 2, "POST", "/api/dashboards/data", { widgets: [] });
  });

  test("recurring: run-now — корзина sensitive, preview — корзина search", async () => {
    // Пороги разные (sensitive=2, search=3): по числу пропущенных запросов видно, какая корзина у маршрута.
    const a = await limited({ sensitiveMax: 2, searchMax: 3 });
    const base = `/api/projects/${nobody}/recurring`;
    await expectLimit(a, admin, 2, "POST", `${base}/${nobody}/run-now`);
    // preview в корзине search (3), а не sensitive (2); тело невалидно, но лимит срабатывает раньше
    await expectLimit(a, admin, 3, "POST", `${base}/preview`, {});
  });

  test("окно истекает: после него запросы снова проходят", async () => {
    const a = await limited({ actionWindowMs: 300, searchMax: 1 });
    expect((await hit(a, employee, "GET", "/api/issues/search?q=test")).statusCode).not.toBe(429);
    expect((await hit(a, employee, "GET", "/api/issues/search?q=test")).statusCode).toBe(429);
    await new Promise((r) => setTimeout(r, 450));
    expect((await hit(a, employee, "GET", "/api/issues/search?q=test")).statusCode).not.toBe(429);
  });

  test("RATE_LIMIT_ENABLED=false отключает и маршрутные лимиты", async () => {
    const a = await limited({ enabled: false });
    for (let i = 0; i < 5; i++) expect((await hit(a, employee, "GET", "/api/issues/search?q=test")).statusCode).not.toBe(429);
  });

  test("пароль: маршрутов смены/сброса нет (нечего ограничивать)", async () => {
    const a = await limited();
    for (const [m, u] of [["POST", "/api/auth/password"], ["POST", "/api/auth/reset-password"], ["POST", "/api/me/password"]] as const)
      expect((await hit(a, employee, m, u, {})).statusCode).toBe(404);
    void fx;
  });
});
