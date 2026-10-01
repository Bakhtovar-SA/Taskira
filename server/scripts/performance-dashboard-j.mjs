/** Isolated J benchmark: creates a NEW scratch DB; never resets a supplied database.
 * node --import tsx scripts/performance-dashboard-j.mjs
 * Connection uses DATABASE_URL_TEST (same setup as tests). DB retained for inspection. */
import pg from "pg";
import { TEST_DB_URL } from "../test/env.ts";
import { initPool, migrate, closePool, q } from "../src/db.ts";
import { widgetData } from "../src/services/dashboardData.ts";
const name = `taskira_test_j_perf_${Date.now()}`;
const adminUrl = new URL(TEST_DB_URL); adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
const url = new URL(TEST_DB_URL); url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString(); process.env.PERF_CONFIRM = "seed-dashboards";
initPool(url.toString());
try {
  await migrate();
  await import("./performance-dashboard-seed.mjs");
  await q(`INSERT INTO project_milestones (project_id, name, date) SELECT p.id, 'Milestone ' || n, CURRENT_DATE + n * 7 FROM projects p CROSS JOIN generate_series(1, 2) n`);
  const ids = (await q("SELECT id FROM projects ORDER BY key")).map(p => p.id);
  const user = (await q("SELECT id FROM users ORDER BY username LIMIT 1"))[0].id;
  const result = { database: name, projects: ids.length, issues: Number((await q("SELECT count(*) AS n FROM issues"))[0].n), timings: {} };
  for (const settings of [{ type: "projects", limit: 50 }, { type: "projectHealth" }, { type: "milestones", periodDays: 30 }]) {
    const w = { id: settings.type, x: 0, y: 0, w: 12, h: 4, ...settings };
    for (let i = 0; i < 3; i++) await widgetData(w, ids, user);
    const times = [];
    for (let i = 0; i < 20; i++) { const start = performance.now(); await widgetData(w, ids, user); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    result.timings[settings.type] = { medianMs: +times[10].toFixed(2), p95Ms: +times[18].toFixed(2) };
  }
  result.unscheduledPlan = (await q("EXPLAIN (ANALYZE, BUFFERS) SELECT i.id FROM issues i WHERE i.project_id = $1 AND i.archived_at IS NULL AND i.due_date IS NULL", [ids[0]])).map(r => r["QUERY PLAN"]);
  console.log(JSON.stringify(result, null, 2));
} finally { await closePool(); }
