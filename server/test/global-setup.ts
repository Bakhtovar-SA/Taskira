/**
 * Один раз на прогон: пересоздаёт целевую схему и применяет все миграции.
 *
 * Целевая схема = первая в search_path подключения (кроме "$user"):
 *   - локально URL c `options=-csearch_path=taskira_test,public` → схема `taskira_test`
 *     (dev-схема `public` не трогается, отдельная БД/CREATEDB не нужны);
 *   - в CI отдельная БД `taskira_test` без options → схема `public`.
 */
import pg from "pg";
import { TEST_DB_URL } from "./env.js";
import { initPool, migrate, closePool } from "../src/db.js";

export async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  const searchPath = (await client.query("SHOW search_path")).rows[0].search_path as string;
  const target =
    searchPath
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .find((s) => s && s !== "$user") ?? "public";
  await client.query(`DROP SCHEMA IF EXISTS ${JSON.stringify(target)} CASCADE`);
  await client.query(`CREATE SCHEMA ${JSON.stringify(target)}`);
  await client.end();

  initPool(TEST_DB_URL);
  await migrate();
  await closePool();
}
