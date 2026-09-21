/**
 * MAINT-01 (замер блокировок): пока на временной копии БД идёт проход обслуживания, непрерывно пишет в БД напрямую
 * и меряет задержку ОДНОЙ записи — отдельно для строк, которые проход не трогает (W-other), и для строк, которые он
 * архивирует (W-eligible). Так проверяется критерий приёмки MAINT-01: проход не держит блокировок дольше одной
 * пачки и не поднимает p99 записи на других строках.
 *
 * Пишет на уровне SQL (`UPDATE issues SET updated_at = now() WHERE id = …`), а не через HTTP: HTTP добавляет
 * собственные очереди и шум, а нас интересует именно ожидание блокировки строки. Только для временной копии
 * (имя БД содержит «maint»), PERF_CONFIRM=maint-probe. Результат — JSON: сырые замеры (t, ms) по каждому классу.
 *
 * PERF_MAINT_DATABASE_URL, PERF_SCHEMA (taskira_perf), PERF_PROBE_SECONDS (300), PERF_PROBE_WORKERS (4 на класс),
 * PERF_PROBE_OUTPUT (./performance-maint-probe.raw.json).
 */
import pg from "pg";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.env.PERF_MAINT_DATABASE_URL;
if (!url) throw new Error("PERF_MAINT_DATABASE_URL не задан");
if (process.env.PERF_CONFIRM !== "maint-probe") throw new Error("Нужен PERF_CONFIRM=maint-probe");
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!/maint/.test(dbName)) throw new Error(`База «${dbName}» не похожа на временную копию`);
const schema = process.env.PERF_SCHEMA ?? "taskira_perf";
const seconds = Number(process.env.PERF_PROBE_SECONDS ?? 300);
const workers = Number(process.env.PERF_PROBE_WORKERS ?? 4);
const output = resolve(process.env.PERF_PROBE_OUTPUT ?? "./performance-maint-probe.raw.json");

const pool = new pg.Pool({ connectionString: url, options: `-csearch_path=${schema},public`, max: workers * 2 + 2 });
const ids = async (where, n) =>
  (await pool.query(`SELECT id FROM issues WHERE ${where} ORDER BY random() LIMIT $1`, [n])).rows.map((r) => r.id);

// Строки, которые проход не тронет (открытые задачи проекта PERF), и подлежащие архивации (MNT-*).
const other = await ids(`done_at IS NULL AND archived_at IS NULL`, 5000);
const eligible = await ids(`key LIKE 'MNT-%' AND archived_at IS NULL`, 5000);
if (other.length < 100 || eligible.length < 100) throw new Error("мало строк для пробы");

const samples = { other: [], eligible: [] };
const started = Date.now();
const stopAt = started + seconds * 1000;

async function worker(kind, pickFrom) {
  while (Date.now() < stopAt) {
    const id = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    const t0 = performance.now();
    try {
      await pool.query(`UPDATE issues SET updated_at = now() WHERE id = $1`, [id]);
      samples[kind].push([Date.now() - started, +(performance.now() - t0).toFixed(2)]);
    } catch (e) {
      samples[kind].push([Date.now() - started, -1]);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

await Promise.all([
  ...Array.from({ length: workers }, () => worker("other", other)),
  ...Array.from({ length: workers }, () => worker("eligible", eligible)),
]);
await pool.end();

const report = { startedAtMs: started, startedAt: new Date(started).toISOString(), seconds, workersPerClass: workers, db: dbName, schema, samples };
await writeFile(output, JSON.stringify(report), "utf8");
console.log(JSON.stringify({ output, other: samples.other.length, eligible: samples.eligible.length }));
