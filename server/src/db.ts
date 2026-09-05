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

/** Применяет миграции из server/migrations по имени, отмечая выполненые в schema_migrations. */
export async function migrate(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  for (const file of files) {
    const applied = await one<{ name: string }>(`SELECT name FROM schema_migrations WHERE name = $1`, [file]);
    if (applied) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    await exec(`BEGIN`);
    try {
      await exec(sql);
      await exec(`INSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}')`);
      await exec(`COMMIT`);
      console.log(`[db] применена миграция ${file}`);
    } catch (e) {
      await exec(`ROLLBACK`);
      throw e;
    }
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
}
