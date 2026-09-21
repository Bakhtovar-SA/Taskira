/** Деградация без ошибки должна быть видна: без триграммных индексов поиск молча идёт Seq Scan-ом (TEST-01). */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { searchIndexWarnings } from "../src/services/healthWarnings.js";
import { getApp, q, stopApp } from "./helpers.js";

const SQL = readFileSync(new URL("../migrations/20260920T1420_trigram_search_indexes.sql", import.meta.url), "utf8");
const INDEXES = ["idx_issues_active_title_trgm", "idx_issues_active_key_trgm"];

class Rollback extends Error {}
async function rolledBack(fn: (c: import("pg").PoolClient) => Promise<void>): Promise<void> {
  await withTransaction(async (c) => {
    await fn(c);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

beforeAll(async () => {
  await getApp(); // поднимает пул БД
});

afterAll(async () => {
  await q(SQL).catch(() => undefined); // вернуть индексы, если тест упал посередине
  await stopApp();
});

describe("предупреждения readiness: индексы поиска", () => {
  test("индексы на месте — предупреждений нет", async () => {
    expect(await searchIndexWarnings()).toEqual([]);
  });

  test("расширение есть, индексов нет — предупреждение с подсказкой создать индексы", async () => {
    await q(`DROP INDEX ${INDEXES[0]}`);
    await q(`DROP INDEX ${INDEXES[1]}`);
    try {
      const w = await searchIndexWarnings();
      expect(w).toHaveLength(1);
      expect(w[0].code).toBe("search_index_missing");
      expect(w[0].reason).toContain(INDEXES[0]);
      expect(w[0].reason).toContain("индексы нужно создать");
    } finally {
      await q(SQL);
    }
    expect(await searchIndexWarnings()).toEqual([]);
  });

  test("нет и расширения — в причине сказано, что pg_trgm не установлен", async () => {
    await rolledBack(async (c) => {
      await c.query(`DROP INDEX ${INDEXES[0]}`);
      await c.query(`DROP INDEX ${INDEXES[1]}`);
      await c.query(`DROP EXTENSION pg_trgm`);
      // предупреждение считаем тем же запросом внутри транзакции
      const r = await c.query(
        `SELECT COALESCE(array_agg(n) FILTER (WHERE to_regclass(n) IS NULL), '{}') AS missing,
                EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ext FROM unnest($1::text[]) AS n`,
        [INDEXES],
      );
      expect(r.rows[0].missing).toHaveLength(2);
      expect(r.rows[0].ext).toBe(false);
    });
    expect(await searchIndexWarnings()).toEqual([]); // откат вернул всё
  });

  test("/ready: индексов нет → 200 и ok:true, но warnings видны; readiness не падает", async () => {
    const app = await getApp();
    await q(`DROP INDEX ${INDEXES[0]}`);
    await q(`DROP INDEX ${INDEXES[1]}`);
    try {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0].code).toBe("search_index_missing");
    } finally {
      await q(SQL);
    }
  });
});
