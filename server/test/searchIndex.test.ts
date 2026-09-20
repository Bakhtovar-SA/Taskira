/** SEARCH-01: триграммные индексы для поиска `q`. Индекс — ускорение, а не смена
 *  семантики: результаты должны совпадать с прежним ILIKE, миграция не должна
 *  падать без расширения и должна быть повторяемой. */
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
let adm: string;

const SQL = readFileSync(new URL("../migrations/20260920T1420_trigram_search_indexes.sql", import.meta.url), "utf8");
const INDEXES = ["idx_issues_active_title_trgm", "idx_issues_active_key_trgm"];

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  adm = await login(app, "admin");
});

const base = () => `/api/projects/${fx.projects.p1}/issues`;
const create = async (title: string) => {
  const res = await app.inject({ method: "POST", url: base(), headers: auth(adm), payload: newIssue({ title }) as never });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body) as { id: string; key: string };
};
const search = async (term: string) => {
  const res = await app.inject({ url: `${base()}?q=${encodeURIComponent(term)}&limit=200`, headers: auth(adm) });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.body).items as { title: string }[]).map((i) => i.title).sort();
};
const haveExtension = async () => (await q(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).length > 0;
const existingIndexes = async () =>
  (await q<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`, [INDEXES])).map((r) => r.indexname).sort();

class Rollback extends Error {}
/** Выполняет `fn` в транзакции и откатывает её: миграцию можно проверять, не меняя схему. */
async function rolledBack(fn: (c: import("pg").PoolClient) => Promise<void>): Promise<void> {
  await withTransaction(async (c) => {
    await fn(c);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

describe("триграммные индексы поиска", () => {
  test("индексы созданы миграцией (расширение доступно в тестовой БД)", async () => {
    expect(await haveExtension()).toBe(true);
    expect(await existingIndexes()).toEqual([...INDEXES].sort());
  });

  test("результаты поиска совпадают с семантикой ILIKE: регистр, % и _ как литералы, кириллица, ключ", async () => {
    const a = await create("Отчёт по Продажам");
    await create("100% готово");
    await create("snake_case имя");
    await create("snakeXcase имя");
    await create("Обычная задача");
    expect(await search("продажам")).toEqual(["Отчёт по Продажам"]); // регистр
    expect(await search("ПРОДАЖ")).toEqual(["Отчёт по Продажам"]);
    expect(await search("100%")).toEqual(["100% готово"]); // % — не шаблон
    expect(await search("snake_case")).toEqual(["snake_case имя"]); // _ — не «любой символ»
    expect(await search(a.key.toLowerCase())).toContain("Отчёт по Продажам"); // по ключу
    expect(await search("несуществующее")).toEqual([]);
  });

  test("планировщик использует GIN для селективного ILIKE по названию и ключу (на достаточно большой таблице)", async () => {
    const plan = await new Promise<string>((resolve, reject) => {
      rolledBack(async (c) => {
        // На крошечной таблице планировщик справедливо выбирает другой индекс, поэтому
        // набиваем таблицу (внутри откатываемой транзакции) и собираем статистику.
        const st = (await c.query(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = 'todo'`, [fx.projects.p1])).rows[0].id;
        await c.query(
          `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank)
           SELECT $1, 1000 + n, 'CORP-' || (1000 + n), 'Filler issue ' || n || ' ' || md5(n::text), '', 'task', $2, 'medium', $3, '{}', n
             FROM generate_series(1, 40000) n`,
          [fx.projects.p1, st, fx.users.admin],
        );
        await c.query("ANALYZE issues");
        // Оставляем только bitmap-планы: иначе на тестовой БД (без реальной нагрузки и статистики
        // производственного размера) планировщик выберет Seq Scan независимо от индексов.
        await c.query("SET LOCAL enable_seqscan = off");
        await c.query("SET LOCAL enable_indexscan = off");
        await c.query("SET LOCAL enable_indexonlyscan = off");
        const res = await c.query(
          `EXPLAIN SELECT i.id FROM issues i WHERE i.archived_at IS NULL AND (i.title ILIKE $1 OR i.key ILIKE $1)`,
          ["%qqzxv9k%"],
        );
        resolve(res.rows.map((r) => r["QUERY PLAN"] as string).join(" | "));
      }).catch(reject);
    });
    expect(plan).toContain("idx_issues_active_title_trgm");
    expect(plan).toContain("idx_issues_active_key_trgm");
  });

  test("миграция повторяема: второй запуск ничего не ломает и не дублирует индексы", async () => {
    await q(SQL);
    expect(await existingIndexes()).toEqual([...INDEXES].sort());
  });

  test("без расширения миграция не падает и индексы не создаёт («если возможно»)", async () => {
    await rolledBack(async (c) => {
      await c.query(`DROP INDEX ${INDEXES[0]}`);
      await c.query(`DROP INDEX ${INDEXES[1]}`);
      await c.query(`DROP EXTENSION pg_trgm`);
      // Расширения нет и создать его нельзя: имитируем недоступный contrib.
      const withoutContrib = SQL.replace("CREATE EXTENSION IF NOT EXISTS pg_trgm", "CREATE EXTENSION IF NOT EXISTS pg_trgm_missing_for_test");
      await c.query(withoutContrib); // не должно бросить
      const left = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`, [INDEXES]);
      expect(left.rows).toEqual([]);
    });
    // откат вернул схему: индексы на месте
    expect(await existingIndexes()).toEqual([...INDEXES].sort());
  });
});
