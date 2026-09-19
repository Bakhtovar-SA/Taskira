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
const testSchema = process.env.UPGRADE_TEST_SCHEMA || "public";
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(testSchema)) throw new Error("invalid UPGRADE_TEST_SCHEMA");
const quotedSchema = `"${testSchema}"`;
const testUrl = new URL(databaseUrl);
if (testSchema !== "public") testUrl.searchParams.set("options", `-csearch_path=${testSchema},public`);
const testDatabaseUrl = testUrl.toString();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
if (testSchema !== "public") await client.query(`CREATE SCHEMA ${quotedSchema}`);
const snapshotSql = readFileSync(resolve(serverDir, snapshot), "utf8").replaceAll("public.", `${quotedSchema}.`);
await client.query(snapshotSql);
await client.end();

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
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
  if (testSchema !== "public") {
    const cleanup = new pg.Client({ connectionString: databaseUrl });
    await cleanup.connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await cleanup.end();
  }
}
