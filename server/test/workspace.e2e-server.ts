// Disposable real API fixture. Never points at a production database.
import "./env.js";
import pg from "pg";
import { TEST_DB_NAME, TEST_DB_URL } from "./env.js";
import { initConfig } from "../src/config.js";
import { initPool, migrate, closePool } from "../src/db.js";
import { getApp, resetDb, seedFixture, login, auth } from "./helpers.js";
import { runWorkspaceOnce } from "../src/services/workspaceProcesses.js";
if (!TEST_DB_NAME.startsWith("taskira_test_workspace_e2e"))
  throw new Error("Use a disposable taskira_test_workspace_e2e database");
const url = new URL(TEST_DB_URL);
url.pathname = "/postgres";
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
if (
  !(
    await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
      TEST_DB_NAME,
    ])
  ).rowCount
)
  await admin.query(`CREATE DATABASE "${TEST_DB_NAME.replaceAll('"', '""')}"`);
await admin.end();
initConfig();
initPool(TEST_DB_URL);
await migrate();
await closePool();
const app = await getApp();
await resetDb();
const f = await seedFixture();
for (const pid of Object.values(f.projects))
  await app.inject({
    method: "PATCH",
    url: `/api/projects/${pid}/workspace/modules`,
    headers: auth(await login(app, "admin")),
    payload: {
      documents: true,
      objects: true,
      processes: true,
      planning: true,
    },
  });
let work: Promise<unknown> | undefined;
const timer = setInterval(() => {
  if (!work)
    work = runWorkspaceOnce()
      .catch(console.error)
      .finally(() => {
        work = undefined;
      });
}, 300);

await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.WORKSPACE_TEST_API_PORT || 28181),
});
console.log("WORKSPACE_E2E_READY", JSON.stringify(f.projects));
const stop = async () => {
  clearInterval(timer);
  await work;
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
