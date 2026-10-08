/**
 * SEC-IDOR-01, часть 1: манифест маршрутов не расходится с приложением.
 *
 * Новый маршрут без записи в routes.manifest.ts валит этот тест — это и есть гарантия «матрица доступа
 * покрывает каждый маршрут». Саму матрицу гоняет accessMatrix.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getApp, stopApp } from "../helpers.js";
import { listRoutes } from "./listRoutes.js";
import { BODIES, QUERIES, ROUTES, SCENARIOS } from "./routes.manifest.js";

let actual: string[];

beforeAll(async () => {
  actual = listRoutes(await getApp());
});
afterAll(async () => {
  await stopApp();
});

describe("routes.manifest.ts ↔ зарегистрированные маршруты", () => {
  test("разбор дерева роутера нашёл маршруты (защита от смены формата printRoutes)", () => {
    expect(actual.length).toBeGreaterThan(100);
    expect(actual).toContain("POST /api/auth/login");
    expect(actual).toContain("GET /health");
    expect(actual).toContain("GET /api/projects/:projectId/issues/:id");
  });

  test("каждый маршрут приложения есть в манифесте", () => {
    const missing = actual.filter((route) => !(route in ROUTES));
    expect(
      missing,
      missing.map((r) => `Добавьте маршрут «${r}» в server/test/access/routes.manifest.ts (одна строка в ROUTES, ` +
        `политика из P; если нужно тело/query — ещё BODIES/QUERIES). Правило: docs/SECURITY_OVERVIEW.md, «Матрица доступа».`).join("\n"),
    ).toEqual([]);
  });

  test("в манифесте нет маршрутов, которых больше нет в приложении", () => {
    const known = new Set(actual);
    const stale = Object.keys(ROUTES).filter((route) => !known.has(route));
    expect(stale, stale.map((r) => `Удалите «${r}» из routes.manifest.ts: такого маршрута больше нет.`).join("\n")).toEqual([]);
  });

  test("ключи ROUTES, BODIES и QUERIES отсортированы (иначе параллельные PR конфликтуют)", () => {
    for (const [name, table] of Object.entries({ ROUTES, BODIES, QUERIES })) {
      const keys = Object.keys(table);
      const sorted = [...keys].sort();
      const bad = keys.findIndex((key, i) => key !== sorted[i]);
      expect(bad, bad < 0 ? "" : `${name}: «${keys[bad]}» не на своём месте — ожидалось «${sorted[bad]}». Отсортируйте ключи.`).toBe(-1);
    }
  });

  test("BODIES и QUERIES относятся к существующим записям ROUTES", () => {
    for (const key of [...Object.keys(BODIES), ...Object.keys(QUERIES)]) {
      expect(key in ROUTES, `«${key}» есть в BODIES/QUERIES, но не в ROUTES`).toBe(true);
    }
  });

  test("у каждой записи заданы все шесть сценариев; ожидания — 401/403/404, ALLOW или N/A", () => {
    for (const [route, policy] of Object.entries(ROUTES)) {
      for (const scenario of SCENARIOS) {
        const expected = policy[scenario];
        const ok = expected === "ALLOW" || expected === "N/A" || expected === 401 || expected === 403 || expected === 404;
        expect(ok, `${route}: сценарий ${scenario} = ${String(expected)} (допустимо 401/403/404/ALLOW/N/A)`).toBe(true);
      }
    }
  });

  test("N/A допустим только для всей записи целиком (WebSocket), а не для отдельных сценариев", () => {
    for (const [route, policy] of Object.entries(ROUTES)) {
      const na = SCENARIOS.filter((s) => policy[s] === "N/A");
      expect(na.length === 0 || na.length === SCENARIOS.length, `${route}: N/A только у части сценариев`).toBe(true);
    }
  });
});
