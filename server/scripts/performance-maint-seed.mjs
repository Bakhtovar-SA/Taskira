/**
 * MAINT-01 (замер на большом объёме): дозаливает в ВРЕМЕННУЮ копию нагрузочной БД N закрытых давно задач,
 * подлежащих автоархивации. Копия делается так (сервер на исходной БД остановить — иначе CREATE DATABASE откажет):
 *
 *   CREATE DATABASE taskira_perf_maint TEMPLATE taskira;   -- схема taskira_perf лежит внутри БД taskira
 *
 * Скрипт отказывается работать, если имя БД не содержит «maint» (защита от случайного прогона по рабочему стенду),
 * и требует PERF_CONFIRM=maint-seed. Ничего не удаляет и не меняет существующих строк: только вставляет новые в
 * проект PX01 с ключами MNT-<n> (по умолчанию 500 000). После замера копию удаляют целиком: DROP DATABASE.
 *
 * Переменные: PERF_MAINT_DATABASE_URL (обязательна), PERF_SCHEMA (по умолчанию taskira_perf),
 * PERF_MAINT_ROWS (по умолчанию 500000), PERF_MAINT_AGE_DAYS (по умолчанию 40).
 */
import pg from "pg";

const url = process.env.PERF_MAINT_DATABASE_URL;
if (!url) throw new Error("PERF_MAINT_DATABASE_URL не задан");
if (process.env.PERF_CONFIRM !== "maint-seed") throw new Error("Нужен PERF_CONFIRM=maint-seed");
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!/maint/.test(dbName)) throw new Error(`База «${dbName}» не похожа на временную копию (нет «maint» в имени)`);
const schema = process.env.PERF_SCHEMA ?? "taskira_perf";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("PERF_SCHEMA: недопустимое имя схемы");
const rows = Number(process.env.PERF_MAINT_ROWS ?? 500_000);
const ageDays = Number(process.env.PERF_MAINT_AGE_DAYS ?? 40);

const client = new pg.Client({ connectionString: url, options: `-csearch_path=${schema},public` });
await client.connect();
try {
  const { rows: base } = await client.query(
    `SELECT p.id AS project_id, i.status_id, i.reporter_id, COALESCE((SELECT max(num) FROM issues WHERE project_id = p.id), 0) AS max_num
       FROM projects p JOIN issues i ON i.project_id = p.id
      WHERE p.key = 'PX01' ORDER BY i.created_at LIMIT 1`,
  );
  if (!base[0]) throw new Error("проект PX01 не найден в схеме " + schema);
  const { project_id, status_id, reporter_id, max_num } = base[0];
  const t0 = Date.now();
  const r = await client.query(
    `INSERT INTO issues (project_id, num, key, title, type_id, status_id, priority_id, reporter_id, rank, done_at, created_at)
     SELECT $1, $4::int + g, 'MNT-' || g, 'Maint issue ' || g, 'task', $2, 'medium', $3, g,
            now() - make_interval(days => $5::int), now() - make_interval(days => $5::int + 5)
       FROM generate_series(1, $6::int) AS g`,
    [project_id, status_id, reporter_id, max_num, ageDays, rows],
  );
  await client.query("ANALYZE issues");
  console.log(JSON.stringify({ db: dbName, schema, inserted: r.rowCount, ms: Date.now() - t0 }));
} finally {
  await client.end();
}
