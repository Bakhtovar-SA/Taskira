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

/**
 * Межпроцессный лок против ДВУХ одновременных `vitest run` (сам раннер, не файлы внутри одного
 * прогона — `fileParallelism: false` в vitest.config.ts защищает только от этого). Без него второй
 * прогон, стартовавший, пока первый ещё выполняет тесты, доходит здесь до `DROP SCHEMA public CASCADE`
 * и вырывает таблицы из-под первого прогона — "отношение users не существует" посреди случайного
 * файла, который приходится каждый раз заново диагностировать как "это не регрессия, это я сам себе
 * помешал" (воспроизводилось на практике трижды за одну сессию работы над Треком 4).
 *
 * Session-level advisory lock на ВЫДЕЛЕННОМ соединении, которое живёт до teardown(): второй прогон
 * получает `pg_try_advisory_lock() = false` сразу, с понятным сообщением, вместо того чтобы молча
 * продолжить и дать ложные failures. Postgres снимает лок сам при обрыве соединения — упавший/убитый
 * прогон (Ctrl+C, OOM) не оставляет вечный лок, в отличие от lock-файла на диске, который пришлось бы
 * чистить вручную.
 */
const LOCK_KEY = "taskira:test-global-setup";
let lockClient: pg.Client | null = null;

export async function setup(): Promise<void> {
  await rm(TEST_STORAGE_DIR, { recursive: true, force: true }); // чистое хранилище вложений

  await ensureTestDatabase();

  lockClient = new pg.Client({ connectionString: TEST_DB_URL });
  await lockClient.connect();
  const { rows } = await lockClient.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY]);
  if (!rows[0]?.ok) {
    await lockClient.end();
    lockClient = null;
    throw new Error(
      "Другой `vitest run` уже выполняет global-setup (DROP/CREATE SCHEMA + миграции) против той же " +
        `тестовой БД (${TEST_DB_NAME}). Дождитесь его завершения и запустите заново — параллельный ` +
        "запуск второго раннера не даёт параллельность, а рвёт схему из-под первого (ложные failures " +
        '"relation ... does not exist").',
    );
  }

  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  initPool(TEST_DB_URL);
  await migrate();
  await closePool();
}

export async function teardown(): Promise<void> {
  if (!lockClient) return;
  await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]).catch(() => undefined);
  await lockClient.end().catch(() => undefined);
  lockClient = null;
}
