#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [lastMigration, outputArg] = process.argv.slice(2);
if (!lastMigration || !outputArg) {
  console.error("Usage: node scripts/create-db-snapshot.mjs LAST_MIGRATION OUTPUT.sql");
  process.exit(2);
}

function loadLocalEnv() {
  const path = join(serverDir, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(index + 1).trim();
  }
}

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDir = join(serverDir, "migrations");
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const boundary = allMigrations.indexOf(lastMigration);
if (boundary < 0) throw new Error(`Unknown migration: ${lastMigration}`);
const migrations = allMigrations.slice(0, boundary + 1);

// Одноразовая БД, а не схема внутри переданной (TEST-01): миграции создают расширения (`pg_trgm`, `pgcrypto`),
// а они принадлежат базе — расширение, созданное в схеме-однодневке, уходило бы вместе с ней при
// `DROP SCHEMA … CASCADE`. В своей БД миграции идут в `public`, как на настоящей установке, и дамп берётся
// с `public` без переименования схем. DATABASE_URL — только «сервер и учётные данные».
const snapshotDatabase = `taskira_snapshot_${process.pid}_${Date.now()}`;
const urlFor = (database) => {
  const u = new URL(databaseUrl);
  u.pathname = `/${database}`;
  u.searchParams.delete("options");
  return u.toString();
};
const admin = new pg.Client({ connectionString: urlFor("postgres") });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${snapshotDatabase}"`);
} catch (error) {
  await admin.end();
  if (error.code === "42501") throw new Error(`No CREATEDB privilege to create the disposable database "${snapshotDatabase}": ALTER ROLE <role> CREATEDB;`);
  throw error;
}
const client = new pg.Client({ connectionString: urlFor(snapshotDatabase) });

try {
  await client.connect();
  await client.query(`CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const name of migrations) {
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    const nonTransactional = sql.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].trim() === "-- migration-transaction: none";
    if (nonTransactional) {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const url = new URL(urlFor(snapshotDatabase));
  const pgDump = process.env.PG_DUMP || "pg_dump";
  const dump = execFileSync(
    pgDump,
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      `--host=${url.hostname}`,
      `--port=${url.port || "5432"}`,
      `--username=${decodeURIComponent(url.username)}`,
      `--dbname=${decodeURIComponent(url.pathname.slice(1))}`,
      "--schema=public",
    ],
    { encoding: "utf8", env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } },
  );

  // С `--schema=public` pg_dump добавляет блок комментария схемы (заголовок и сам COMMENT):
  // убираем его целиком, чтобы снимок остался побайтно таким же, как при прежней схеме-однодневке.
  const body = dump
    .replace(/--\r?\n-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -\r?\n--\r?\n\r?\nCOMMENT ON SCHEMA public IS [^\r\n]*\r?\n\r?\n\r?\n/, "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("\\restrict") && !line.startsWith("\\unrestrict"))
    .filter((line) => !line.startsWith("SET "))
    .filter((line) => !line.startsWith("SELECT pg_catalog.set_config"))
    .filter((line) => line !== "CREATE SCHEMA public;")
    .filter((line) => !line.startsWith("ALTER SCHEMA public OWNER TO"))
    .filter((line) => !line.startsWith("COMMENT ON SCHEMA public IS"))
    .join("\n")
    .trim();

  // Расширения, на чьи объекты ссылается дамп, но которые сам дамп схемы не создаёт: без них снимок на границе,
  // новее миграции с триграммными индексами, не загрузится («класс операторов "public.gin_trgm_ops" не существует»).
  const extensions = ["pgcrypto"];
  if (/\b(?:gin|gist)_trgm_ops\b/.test(body)) extensions.push("pg_trgm");
  const createExtensions = extensions.map((name) => `CREATE EXTENSION IF NOT EXISTS ${name};`).join("\n");

  const values = migrations.map((name) => `('${name.replaceAll("'", "''")}')`).join(",\n  ");
  const output = `-- Taskira upgrade snapshot through ${lastMigration}.\n` +
    `-- Generated by server/scripts/create-db-snapshot.mjs; do not edit manually.\n\n` +
    `${createExtensions}\n\n${body}\n\n` +
    `INSERT INTO public.schema_migrations(name) VALUES\n  ${values};\n\n` +
    `CREATE TABLE public.upgrade_snapshot_probe (value text PRIMARY KEY);\n` +
    `INSERT INTO public.upgrade_snapshot_probe(value) VALUES ('${lastMigration}');\n`;
  writeFileSync(resolve(outputArg), output, "utf8");
  console.log(`Created ${outputArg} (${migrations.length} applied migrations)`);
} finally {
  await client.end().catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${snapshotDatabase}" WITH (FORCE)`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
