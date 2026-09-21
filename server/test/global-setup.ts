/**
 * Один раз на прогон: гарантирует отдельную БД `taskira_test`, пересоздаёт в ней схему `public` и
 * применяет все миграции.
 *
 * Тесты никогда не трогают рабочую БД: расширения (`pg_trgm`, …) принадлежат базе, и сброс схемы внутри
 * общей БД молча удалял их вместе с индексами чужих схем (TEST-01). Сбрасывать `public` внутри
 * собственной БД тестов безопасно — вместе с ней уходят и расширения этой БД, и только они.
 *
 * БД создаётся при отсутствии (нужно право CREATEDB у роли; в CI её создаёт docker-сервис Postgres).
 */
import { rm } from "node:fs/promises";
import pg from "pg";
import { TEST_DB_NAME, TEST_DB_URL, TEST_STORAGE_DIR } from "./env.js";
import { initPool, migrate, closePool } from "../src/db.js";

async function ensureTestDatabase(): Promise<void> {
  const probe = new pg.Client({ connectionString: TEST_DB_URL });
  try {
    await probe.connect();
    await probe.end();
    return; // БД уже есть
  } catch (err) {
    await probe.end().catch(() => undefined);
    if ((err as { code?: string }).code !== "3D000") throw err; // 3D000 — база не существует
  }

  const adminUrl = new URL(TEST_DB_URL);
  adminUrl.pathname = "/postgres"; // служебная БД, чтобы создать taskira_test
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${JSON.stringify(TEST_DB_NAME)}`);
  } catch (err) {
    if ((err as { code?: string }).code === "42501") {
      throw new Error(
        `Нет права создать тестовую БД «${TEST_DB_NAME}». Один раз, от суперпользователя: ` +
          `ALTER ROLE <роль из DATABASE_URL_TEST> CREATEDB;  либо создайте БД вручную: ` +
          `CREATE DATABASE ${TEST_DB_NAME} OWNER <роль>;`,
      );
    }
    throw err;
  } finally {
    await admin.end();
  }
}

export async function setup(): Promise<void> {
  await rm(TEST_STORAGE_DIR, { recursive: true, force: true }); // чистое хранилище вложений

  await ensureTestDatabase();
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  initPool(TEST_DB_URL);
  await migrate();
  await closePool();
}
