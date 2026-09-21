#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = process.argv[2];
if (!snapshot) {
  console.error("Usage: node scripts/upgrade-snapshot-smoke.mjs SNAPSHOT.sql");
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// Одноразовая БД, а не схема внутри переданной (TEST-01): расширения (`pg_trgm`, `pgcrypto`) принадлежат базе,
// и `DROP SCHEMA … CASCADE` схемы, где их создала миграция, молча уносит их вместе с индексами других схем.
// Снимок при этом грузится в `public`, как на настоящей установке, без переписывания имён схемы.
// DATABASE_URL используется только как «сервер + учётные данные»: его собственная БД не меняется.
// Нужно право CREATEDB (в CI роль — владелец docker-сервиса Postgres).
const testDatabase = process.env.UPGRADE_TEST_DATABASE || `upgrade_snapshot_${process.pid}_${Date.now()}`;
if (!/^upgrade_snapshot_[A-Za-z0-9_]+$/.test(testDatabase)) {
  throw new Error("UPGRADE_TEST_DATABASE must match upgrade_snapshot_<letters, digits, underscore>: the script drops it at the end");
}
const urlFor = (database) => {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  url.searchParams.delete("options"); // схемный режим больше не используется
  return url.toString();
};
const testDatabaseUrl = urlFor(testDatabase);

const admin = new pg.Client({ connectionString: urlFor("postgres") });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
} catch (error) {
  await admin.end();
  if (error.code === "42501") {
    throw new Error(`No CREATEDB privilege to create the disposable database "${testDatabase}": ALTER ROLE <role> CREATEDB;`);
  }
  throw error;
}
await admin.end();

async function dropTestDatabase() {
  const cleanup = new pg.Client({ connectionString: urlFor("postgres") });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE)`);
  await cleanup.end();
}

// Битый снимок падает ДО основного try/finally — БД нужно убрать и в этом случае.
try {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query(readFileSync(resolve(serverDir, snapshot), "utf8"));
  } finally {
    await client.end();
  }
} catch (error) {
  await dropTestDatabase();
  throw error;
}

const port = 18080;
const logs = [];
const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: serverDir,
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    PORT: String(port),
    HOST: "127.0.0.1",
    TASKIRA_VERSION: "upgrade-ci",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

try {
  let health;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // Server is still applying migrations or binding the port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  if (!health || health.version !== "upgrade-ci" || health.db !== true) {
    throw new Error(`health-check failed: ${JSON.stringify(health)}`);
  }

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  if (!login.ok || !login.headers.get("set-cookie")?.includes("taskira_session=")) {
    throw new Error(`login smoke test failed with HTTP ${login.status}`);
  }

  const verify = new pg.Client({ connectionString: testDatabaseUrl });
  await verify.connect();
  const applied = await verify.query("SELECT name FROM schema_migrations ORDER BY name");
  const expected = readdirSync(resolve(serverDir, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  if (JSON.stringify(applied.rows.map((row) => row.name)) !== JSON.stringify(expected)) {
    throw new Error("not all current migrations were applied");
  }
  const probe = await verify.query("SELECT value FROM upgrade_snapshot_probe");
  if (probe.rowCount !== 1) throw new Error("snapshot probe data was not preserved");
  await verify.end();
  console.log(`upgrade smoke passed: ${snapshot} -> ${expected.at(-1)}`);
} catch (error) {
  console.error(logs.join(""));
  throw error;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolveWait) => {
    if (server.exitCode !== null) return resolveWait();
    server.once("exit", resolveWait);
    setTimeout(() => {
      server.kill("SIGKILL");
      resolveWait();
    }, 5000).unref();
  });
  await dropTestDatabase();
}
