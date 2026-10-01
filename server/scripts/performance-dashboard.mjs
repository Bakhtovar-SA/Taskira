/**
 * Замер дашбордов (ADR-0022) на стенде performance-dashboard-seed.mjs: 100 проектов, 50 000 задач.
 *
 * Что меряется (всё — POST /api/dashboards/data, как шлёт клиент):
 *   1. «Обзор организации» целиком: администратор (видит все 100 проектов) и сотрудник (свои ~15);
 *   2. «Обзор проекта» целиком — самый крупный проект;
 *   3. каждый виджет по отдельности на всех 100 проектах — где узкое место;
 *   4. параллельная нагрузка: PERF_CONCURRENCY разных людей без пауз, каждый — обзор организации.
 * Наборы виджетов повторяют DEFAULT_ORG_OVERVIEW / DEFAULT_PROJECT_OVERVIEW (src/dashboards/catalog.ts).
 *
 *   PERF_BASE_URL=http://127.0.0.1:8082 PERF_ADMIN_USER=... PERF_ADMIN_PASSWORD=... node scripts/performance-dashboard.mjs
 * Сервер для замера — с RATE_LIMIT_ENABLED=false и MAINTENANCE_ENABLED=false.
 */
import { writeFileSync } from "node:fs";

const base = process.env.PERF_BASE_URL ?? "http://127.0.0.1:8082";
const adminUser = process.env.PERF_ADMIN_USER;
const adminPassword = process.env.PERF_ADMIN_PASSWORD;
const userPassword = process.env.PERF_USER_PASSWORD ?? "Perf-Dash-User-42!";
const runs = Number(process.env.PERF_RUNS ?? 30);
const concurrency = Number(process.env.PERF_CONCURRENCY ?? 20);
const loadSeconds = Number(process.env.PERF_LOAD_SECONDS ?? 30);
const out = process.env.PERF_OUT;
if (!adminUser || !adminPassword) throw new Error("PERF_ADMIN_USER and PERF_ADMIN_PASSWORD are required");

const W = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, w, h, ...extra });
const ORG_OVERVIEW = [
  W("projectHealth", "projectHealth", 0, 0, 4, 4),
  W("milestones", "milestones", 4, 0, 8, 4, { periodDays: 30 }),
  W("projects", "projects", 0, 4, 12, 5, { limit: 10 }),
  W("progress", "progress", 0, 9, 6, 4, { limit: 10 }),
  W("by-project", "breakdown", 6, 9, 6, 4, { groupBy: "project", chart: "bars" }),
  W("trend", "trend", 0, 13, 12, 4, { periodDays: 90 }),
];
const PROJECT_OVERVIEW = [
  W("count-open", "count", 0, 0, 3, 2, { metric: "open", periodDays: 30 }),
  W("count-overdue", "count", 3, 0, 3, 2, { metric: "overdue", periodDays: 30 }),
  W("count-dueSoon", "count", 6, 0, 3, 2, { metric: "dueSoon", periodDays: 30 }),
  W("count-closed", "count", 9, 0, 3, 2, { metric: "closed", periodDays: 30 }),
  W("trend", "trend", 0, 2, 8, 4, { periodDays: 90 }),
  W("by-status", "breakdown", 8, 2, 4, 4, { groupBy: "status", chart: "donut" }),
  W("workload", "workload", 0, 6, 6, 4, { limit: 8 }),
  W("issues-overdue", "issues", 6, 6, 6, 4, { preset: "overdue", limit: 8 }),
  W("activity", "activity", 0, 10, 6, 4, { limit: 10 }),
  W("issues-dueSoon", "issues", 6, 10, 6, 4, { preset: "dueSoon", limit: 8 }),
];
/** Все типы и варианты из каталога — по одному запросу на виджет. */
const SINGLE = [
  W("projects", "projects", 0, 0, 12, 5, { limit: 50 }),
  W("projectHealth", "projectHealth", 0, 0, 4, 4),
  W("milestones", "milestones", 0, 0, 8, 4, { periodDays: 30 }),
  ...["open", "overdue", "dueSoon", "unassigned", "closed", "created"].map((m) => W(`count-${m}`, "count", 0, 0, 3, 2, { metric: m, periodDays: 30 })),
  ...["status", "assignee", "priority", "type", "project"].map((g) => W(`by-${g}`, "breakdown", 0, 0, 6, 4, { groupBy: g, chart: "bars" })),
  W("trend-90", "trend", 0, 0, 8, 4, { periodDays: 90 }),
  W("trend-365", "trend", 0, 0, 8, 4, { periodDays: 365 }),
  ...["mine", "overdue", "dueSoon", "unassigned", "recentlyCreated", "recentlyClosed"].map((p) => W(`issues-${p}`, "issues", 0, 0, 6, 4, { preset: p, limit: 8 })),
  W("workload", "workload", 0, 0, 6, 4, { limit: 8 }),
  W("progress", "progress", 0, 0, 6, 4, { limit: 10 }),
  W("activity", "activity", 0, 0, 6, 4, { limit: 10 }),
];

async function login(username, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  return (await r.json()).token;
}
async function data(token, widgets, projectId) {
  const t = performance.now();
  const r = await fetch(`${base}/api/dashboards/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(projectId ? { widgets, projectId } : { widgets }),
  });
  const body = await r.json();
  const ms = performance.now() - t;
  if (!r.ok) throw new Error(`data: ${r.status} ${JSON.stringify(body)}`);
  const errors = Object.values(body.results).filter((x) => x.type === "error").length;
  return { ms, errors, body };
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const stats = (xs) => ({ n: xs.length, median: pct(xs, 50), p95: pct(xs, 95), max: Math.round(Math.max(...xs)) });
async function series(token, widgets, projectId) {
  for (let i = 0; i < 3; i++) await data(token, widgets, projectId); // прогрев
  const ms = [];
  let errors = 0;
  for (let i = 0; i < runs; i++) {
    const r = await data(token, widgets, projectId);
    ms.push(r.ms);
    errors += r.errors;
  }
  return { ...stats(ms), widgetErrors: errors };
}

const admin = await login(adminUser, adminPassword);
const employee = await login("dash_01", userPassword);
const projects = await (await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${admin}` } })).json();
const dsh = (Array.isArray(projects) ? projects : projects.items ?? []).filter((p) => /^DSH\d{3}$/.test(p.key));
if (dsh.length === 0) throw new Error("no DSH projects: run performance-dashboard-seed.mjs first");
const empVisible = (await (await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${employee}` } })).json()).length;

const result = { date: new Date().toISOString(), base, runs, projects: dsh.length, employeeVisibleProjects: empVisible, scenarios: {}, singleWidget: {}, load: null };
result.scenarios.orgOverviewAdmin = await series(admin, ORG_OVERVIEW);
result.scenarios.orgOverviewEmployee = await series(employee, ORG_OVERVIEW);
result.scenarios.projectOverview = await series(admin, PROJECT_OVERVIEW, dsh[0].id);
for (const w of SINGLE) result.singleWidget[w.id] = (await series(admin, [w])).median;

// Параллельно: разные люди (у каждого свой предел одновременных расчётов), без пауз.
const tokens = await Promise.all(Array.from({ length: concurrency }, (_, i) => login(`dash_${String(i + 1).padStart(2, "0")}`, userPassword)));
const lat = [];
let failed = 0;
const until = Date.now() + loadSeconds * 1000;
await Promise.all(
  tokens.map(async (tok) => {
    while (Date.now() < until) {
      try {
        lat.push((await data(tok, ORG_OVERVIEW)).ms);
      } catch {
        failed++;
      }
    }
  }),
);
result.load = { users: concurrency, seconds: loadSeconds, requests: lat.length, perSecond: Math.round((lat.length / loadSeconds) * 10) / 10, failed, ...stats(lat) };

console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
