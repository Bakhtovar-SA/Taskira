/** Тонкий слой над node-postgres: параметризованные запросы + применение SQL-миграций. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

// PG-тип `date` (OID 1082) — отдаём как есть, строкой "ГГГГ-ММ-ДД".
// Без этого node-postgres парсит его в JS Date → JSON.stringify даёт полный
// ISO-таймстемп, и клиентский `new Date(iso + "T00:00:00")` ломается («Invalid Date»
// в шапке спринта, taskira-review §1.2). Типы в коде (`due_date: string | null`,
// `start_date: string | null`) с самого начала рассчитаны на строку.
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | null = null;

/**
 * `idleTimeoutMillis: 0` — простаивающие соединения не закрываются. Умолчание `pg` (10 с) рассчитано
 * на другой профиль: после паузы первый запрос платит за новое соединение (на стенде 60–92 мс против
 * 0,5 мс на тёплом), а при малом трафике — по утрам, после выходных — это каждый первый запрос.
 * Пул ограничен `max` (по умолчанию 10), поэтому держать их открытыми дёшево; при нескольких
 * процессах сервера постоянно занято `процессов × max` соединений — учитывайте `max_connections`.
 */
export function initPool(databaseUrl: string, max = 10, idleTimeoutMillis = 0): pg.Pool {
  pool = new Pool({ connectionString: databaseUrl, max, idleTimeoutMillis, keepAlive: true });
  // Без обработчика 'error' на пуле обрыв простаивающего соединения (рестарт Postgres, failover,
  // idle_session_timeout, обрыв через балансировщик) — необработанное событие и падение процесса.
  // Раньше 10-секундный тайм-аут прятал это окно; с постоянными соединениями оно открыто.
  pool.on("error", (err) => console.error(`[db] ошибка простаивающего соединения: ${err.message}`));
  return pool;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error("Пул БД не инициализирован — вызовите initPool()");
  return pool;
}

function migrationFiles(): string[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

const NON_TRANSACTIONAL_MARKER = "-- migration-transaction: none";

function isNonTransactionalMigration(sql: string): boolean {
  return sql.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].trim() === NON_TRANSACTIONAL_MARKER;
}

async function assertNoInvalidIndexes(client: pg.PoolClient, file: string): Promise<void> {
  const invalid = await client.query<{ index_name: string }>(
    `SELECT indexrelid::regclass::text AS index_name
       FROM pg_index
      WHERE NOT indisvalid
        AND indrelid IN (
          SELECT c.oid FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace
        )`,
  );
  if (invalid.rows.length > 0) {
    throw new Error(
      `Нетранзакционная миграция ${file} оставила/обнаружила невалидный индекс: ${invalid.rows.map((row) => row.index_name).join(", ")}. Выполните recovery из SQL-файла и повторите запуск.`,
    );
  }
}

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Межпроцессная взаимоисключающая секция на session-level advisory-локе Postgres. Держит ОДНО выделенное
 * соединение на время `fn`; лок снимается в `finally`, а при обрыве соединения Postgres снимает его сам —
 * упавший процесс не оставляет «вечный лок».
 *
 * `wait: false` — не ждать: занято → `{ acquired: false }` без выполнения (тик фонового джоба просто
 * пропускается). `wait: true` — встать в очередь (стартовый сид: второй экземпляр дождётся первого и увидит
 * уже созданное). Ключ — строка, `hashtext` даёт int4: префикс `taskira:` по образцу существующих локов.
 * Не работает через pgbouncer в transaction-режиме (лок привязан к серверному соединению).
 */
export async function withAdvisoryLock<T>(key: string, opts: { wait: boolean }, fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = await getPool().connect();
  let locked = false;
  let broken = false;
  try {
    if (opts.wait) {
      await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
      locked = true;
    } else {
      const r = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key]);
      locked = r.rows[0]?.ok === true;
      if (!locked) return { acquired: false };
    }
    return { acquired: true, value: await fn() };
  } finally {
    if (locked) {
      // не смогли снять лок — соединение нельзя возвращать в пул с висящим локом: закрываем его
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {
        broken = true;
      });
    }
    client.release(broken);
  }
}

export async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

export async function one<T>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function exec(text: string): Promise<void> {
  await getPool().query(text);
}

/** Экранирование спецсимволов ILIKE (`%`, `_`, `\`) в пользовательском вводе —
 *  общая для всех роутов, строящих `... ILIKE '%' || $1 || '%'`. */
export const escLike = (s: string): string => s.replace(/[%_\\]/g, "\\$&");

/** Операция на выделенном клиенте — для read-then-write без гонок (rank, счётчики). */
export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Выполняет составную мутацию атомарно на одном соединении. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Применяет миграции из server/migrations по имени, отмечая выполненные в schema_migrations.
 * Обычная миграция проходит целиком внутри явной транзакции. Файл с первой
 * строкой `-- migration-transaction: none` исполняется без BEGIN — только для
 * PostgreSQL DDL вроде CREATE INDEX CONCURRENTLY; после него runner проверяет,
 * что в текущей схеме не осталось невалидных индексов, и лишь затем ставит
 * отметку schema_migrations.
 */
export async function migrate(): Promise<void> {
  const p = getPool();
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = migrationFiles();
  const client = await p.connect();
  try {
    // Один session-level lock на весь цикл: две стартующие реплики больше не
    // могут одновременно увидеть одну и ту же миграцию неприменённой.
    await client.query(`SELECT pg_advisory_lock(hashtext('taskira:schema-migrations'))`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    for (const file of files) {
      const applied = await client.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
      if (applied.rows.length > 0) continue;

      const sql = readFileSync(join(dir, file), "utf8");
      if (isNonTransactionalMigration(sql)) {
        if (!/^-- recovery: .+$/m.test(sql.replaceAll("\r", ""))) {
          throw new Error(`Нетранзакционная миграция ${file} не содержит обязательный -- recovery:`);
        }
        await client.query(sql);
        await assertNoInvalidIndexes(client, file);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        console.log(`[db] применена нетранзакционная миграция ${file}`);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        console.log(`[db] применена миграция ${file}`);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('taskira:schema-migrations'))`).catch(() => undefined);
    client.release();
  }
}

/** Проверка readiness: БД отвечает и каждая миграция этого build применена. */
export async function pendingMigrations(): Promise<string[]> {
  const rows = await q<{ name: string }>(`SELECT name FROM schema_migrations`);
  const applied = new Set(rows.map((row) => row.name));
  return migrationFiles().filter((file) => !applied.has(file));
}

export async function closePool(): Promise<void> {
  await pool?.end();
}
