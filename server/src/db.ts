/** Тонкий слой над node-postgres: параметризованные запросы + применение SQL-миграций. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initPool(databaseUrl: string): pg.Pool {
  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return pool;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error("Пул БД не инициализирован — вызовите initPool()");
  return pool;
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

/**
 * Применяет миграции из server/migrations по имени, отмечая выполненные в schema_migrations.
 * Каждая миграция проходит ЦЕЛИКОМ на одном соединении внутри явной транзакции:
 * при ошибке — ROLLBACK, соединение всегда возвращается в пул (fix 3a).
 */
export async function migrate(): Promise<void> {
  const p = getPool();
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  for (const file of files) {
    const applied = await p.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(dir, file), "utf8");
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql); // все операторы файла — внутри одной транзакции
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`[db] применена миграция ${file}`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
}
