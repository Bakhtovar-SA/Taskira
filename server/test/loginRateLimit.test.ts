/**
 * Лимит попыток входа по IP живёт в БД (RESTART-SAFETY): не умножается на число процессов и не обнуляется
 * перезапуском. Раньше это была `Map` в памяти процесса.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = "true";
  process.env.RATE_LIMIT_LOGIN_MAX = "3";
  process.env.RATE_LIMIT_LOGIN_WINDOW_MS = "60000";
});

import type { FastifyInstance } from "fastify";
import { loginRateLimited } from "../src/services/loginRateLimit.js";
import { getApp, q, resetDb, seedFixture, stopApp } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("loginRateLimited (сервис)", () => {
  test("после `max` попыток лимит исчерпан; другой IP не затронут", async () => {
    expect(await loginRateLimited("203.0.113.1", 3, 60_000)).toBe(false);
    expect(await loginRateLimited("203.0.113.1", 3, 60_000)).toBe(false);
    expect(await loginRateLimited("203.0.113.1", 3, 60_000)).toBe(false);
    expect(await loginRateLimited("203.0.113.1", 3, 60_000)).toBe(true);
    expect(await loginRateLimited("203.0.113.2", 3, 60_000)).toBe(false);
  });

  test("отклонённая попытка не продлевает окно и не пишется", async () => {
    for (let i = 0; i < 3; i++) await loginRateLimited("203.0.113.3", 3, 60_000);
    for (let i = 0; i < 5; i++) expect(await loginRateLimited("203.0.113.3", 3, 60_000)).toBe(true);
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM login_attempts WHERE ip = '203.0.113.3'`);
    expect(n).toBe(3);
  });

  test("окно скользящее: после его истечения вход снова разрешён", async () => {
    for (let i = 0; i < 2; i++) expect(await loginRateLimited("203.0.113.4", 2, 250)).toBe(false);
    expect(await loginRateLimited("203.0.113.4", 2, 250)).toBe(true);
    await sleep(320);
    expect(await loginRateLimited("203.0.113.4", 2, 250)).toBe(false);
  });

  test("одновременные попытки у порога: пропущено ровно `max`", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => loginRateLimited("203.0.113.5", 3, 60_000)));
    expect(results.filter((limited) => !limited)).toHaveLength(3);
    expect(results.filter((limited) => limited)).toHaveLength(9);
  });
});

describe("POST /api/auth/login", () => {
  test("после 3 неверных попыток с IP — 429 RATE_LIMITED; состояние лежит в БД, а не в памяти", async () => {
    await seedFixture();
    const attempt = () =>
      app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "198.51.100.7", payload: { username: "nobody", password: "wrong-password-1" } });
    for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM login_attempts WHERE ip = '198.51.100.7'`);
    expect(n).toBe(3);
    // другой адрес не блокируется
    const other = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "198.51.100.8", payload: { username: "nobody", password: "wrong-password-1" } });
    expect(other.statusCode).toBe(401);
  });
});
