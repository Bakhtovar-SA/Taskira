/**
 * Один раз на прогон: пересоздаёт схему `taskira_test` и применяет все миграции.
 * dev-схема `public` не затрагивается.
 */
import pg from "pg";
import { TEST_DB_URL } from "./env.js";
import { initPool, migrate, closePool } from "../src/db.js";

export async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS taskira_test CASCADE");
  await client.query("CREATE SCHEMA taskira_test");
  await client.end();

  initPool(TEST_DB_URL);
  await migrate();
  await closePool();
}

export async function teardown(): Promise<void> {
  // Схему оставляем — для «посмотреть после падения». Следующий прогон её дропнет.
}
