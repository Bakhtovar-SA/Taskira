/**
 * Досев нагрузочного стенда до реалистичной топологии (PERF-05).
 *
 * performance-seed.mjs даёт один проект, где все задачи `medium`, без сроков,
 * исполнителей и архива — на таких данных планировщик выбирает план, которого
 * в реальной инсталляции не будет. Этот скрипт, поверх уже засеянного проекта
 * PERF, добавляет:
 *   - неравномерное распределение priority / due_date / updated_at / done_at;
 *   - исполнителей: ~70% задач с исполнителем, выборка сильно смещена к
 *     нескольким «загруженным» людям (степень 3), у 15% — второй исполнитель;
 *   - архивные задачи PERF (активных по-прежнему PERF_ISSUES);
 *   - ещё PERF_EXTRA_PROJECTS проектов разного размера, у каждого свой workflow.
 *
 * Запускать ТОЛЬКО в изолированной схеме/БД:
 *   PERF_CONFIRM=seed-topology DATABASE_URL=... PERF_SCHEMA=taskira_perf node scripts/performance-seed-topology.mjs
 * ВАЖНО: если поверх этого стенда запускать сам сервер, задайте MAINTENANCE_ENABLED=false —
 * иначе фоновая архивация уберёт из активного набора закрытые >30 дней задач
 * (у части задач done_at сознательно давний) и замеры перестанут быть сопоставимы.
 * Повторный запуск идемпотентен: доп. проекты пересоздаются, PERF пере-рандомизируется.
 */
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const schema = process.env.PERF_SCHEMA;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.PERF_CONFIRM !== "seed-topology") {
  throw new Error("Refusing to alter data: set PERF_CONFIRM=seed-topology for an isolated performance database");
}
if (!schema || !/^[a-z_][a-z0-9_]*$/.test(schema) || schema === "public") {
  throw new Error("PERF_SCHEMA must name an isolated non-public schema");
}
const archivedExtra = Number(process.env.PERF_ARCHIVED ?? 10_000);
// размеры дополнительных проектов: от крупного до крошечного
const extraSizes = (process.env.PERF_EXTRA_SIZES ?? "20000,8000,3000,1000,500,200,100,50,10")
  .split(",")
  .map(Number);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(`SET search_path TO "${schema}"`);
  await client.query("BEGIN");

  const perf = (await client.query(`SELECT id, department_id FROM projects WHERE key = 'PERF'`)).rows[0];
  if (!perf) throw new Error("run performance-seed.mjs first");
  const users = (await client.query(`SELECT id FROM users WHERE username ~ '^perf_[0-9]{3}$' ORDER BY username`)).rows.map((r) => r.id);
  const userCount = users.length;

  // 1. Распределения в PERF. random() вычисляется по строке; сид фиксировать
  // не нужно — важна форма распределения, а не конкретные значения.
  await client.query(
    `UPDATE issues i SET
        priority_id = CASE WHEN r < 0.10 THEN 'critical' WHEN r < 0.30 THEN 'high' WHEN r < 0.80 THEN 'medium' ELSE 'low' END,
        due_date    = CASE WHEN random() < 0.6 THEN CURRENT_DATE + (floor(random() * 180) - 90)::int END,
        updated_at  = now() - (random() * interval '365 days'),
        done_at     = CASE WHEN ws.category = 'done' THEN now() - (random() * interval '120 days') END
       FROM (SELECT id, random() AS r FROM issues WHERE project_id = $1) x, workflow_statuses ws
      WHERE i.id = x.id AND ws.id = i.status_id`,
    [perf.id],
  );

  // 2. Исполнители PERF: смещение к малому индексу через random()^3.
  await client.query(`DELETE FROM issue_assignees WHERE issue_id IN (SELECT id FROM issues WHERE project_id = $1)`, [perf.id]);
  await client.query(
    `INSERT INTO issue_assignees (issue_id, user_id)
     SELECT id, ($2::uuid[])[1 + floor(power(random(), 3) * $3)::int]
       FROM issues WHERE project_id = $1 AND random() < 0.70
     ON CONFLICT DO NOTHING`,
    [perf.id, users, userCount],
  );
  await client.query(
    `INSERT INTO issue_assignees (issue_id, user_id)
     SELECT ia.issue_id, ($2::uuid[])[1 + floor(random() * $3)::int]
       FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id
      WHERE i.project_id = $1 AND random() < 0.15
     ON CONFLICT DO NOTHING`,
    [perf.id, users, userCount],
  );

  // 3. Архив PERF: закрытые давно. Активный набор остаётся прежним.
  const doneSid = (await client.query(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = 'done'`, [perf.id])).rows[0].id;
  const maxNum = Number((await client.query(`SELECT max(num) AS n FROM issues WHERE project_id = $1`, [perf.id])).rows[0].n);
  await client.query(`DELETE FROM issues WHERE project_id = $1 AND archived_at IS NOT NULL AND title LIKE 'Archived issue%'`, [perf.id]);
  const activeMax = Number((await client.query(`SELECT max(num) AS n FROM issues WHERE project_id = $1`, [perf.id])).rows[0].n);
  await client.query(
    `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank,
                         done_at, archived_at, updated_at)
     SELECT $1, $2::int + n, 'PERF-' || ($2::int + n), 'Archived issue ' || n, '', 'task', $3, 'medium', $4, '{}', $2::int + n,
            now() - interval '60 days' - random() * interval '300 days', now() - interval '30 days', now() - interval '60 days'
       FROM generate_series(1, $5::int) n`,
    [perf.id, Math.max(maxNum, activeMax), doneSid, users[0], archivedExtra],
  );
  await client.query(
    `INSERT INTO project_counters (project_id, next_num) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET next_num = EXCLUDED.next_num`,
    [perf.id, Math.max(maxNum, activeMax) + archivedExtra + 1],
  );

  // 4. Дополнительные проекты.
  await client.query(`DELETE FROM projects WHERE key ~ '^PX[0-9]{2}$'`);
  const summary = [];
  for (const [idx, size] of extraSizes.entries()) {
    const key = `PX${String(idx + 1).padStart(2, "0")}`;
    const project = (
      await client.query(
        `INSERT INTO projects (key, name, description, department_id, is_shared)
         VALUES ($1, $2, 'Generated topology fixture', $3, false) RETURNING id`,
        [key, `Topology ${key}`, perf.department_id],
      )
    ).rows[0].id;
    const st = (
      await client.query(
        `INSERT INTO workflow_statuses (project_id, sid, name, category, position)
         VALUES ($1,'todo','К выполнению','todo',0), ($1,'inprogress','В работе','inprogress',1),
                ($1,'review','На проверке','inprogress',2), ($1,'done','Готово','done',3)
         RETURNING id, sid`,
        [project],
      )
    ).rows;
    const sids = new Map(st.map((r) => [r.sid, r.id]));
    await client.query(
      `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank,
                           due_date, updated_at, done_at)
       SELECT $1, n, $2 || '-' || n, 'Topology issue ' || n, '', 'task', s.id,
              CASE WHEN r < 0.10 THEN 'critical' WHEN r < 0.30 THEN 'high' WHEN r < 0.80 THEN 'medium' ELSE 'low' END,
              $4, '{}', n,
              CASE WHEN random() < 0.6 THEN CURRENT_DATE + (floor(random() * 180) - 90)::int END,
              now() - random() * interval '365 days',
              CASE WHEN s.sid = 'done' THEN now() - random() * interval '120 days' END
         FROM (SELECT n, random() AS r, (ARRAY['todo','inprogress','review','done'])[1 + floor(random() * 4)::int] AS sid
                 FROM generate_series(1, $3::int) n) g
         JOIN (SELECT id, sid FROM workflow_statuses WHERE project_id = $1) s ON s.sid = g.sid`,
      [project, key, size, users[0]],
    );
    await client.query(
      `INSERT INTO issue_assignees (issue_id, user_id)
       SELECT id, ($2::uuid[])[1 + floor(power(random(), 3) * $3)::int]
         FROM issues WHERE project_id = $1 AND random() < 0.70
       ON CONFLICT DO NOTHING`,
      [project, users, userCount],
    );
    await client.query(
      `INSERT INTO project_counters (project_id, next_num) VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET next_num = EXCLUDED.next_num`,
      [project, size + 1],
    );
    summary.push({ key, size });
  }
  await client.query("COMMIT");
  await client.query("ANALYZE issues");
  await client.query("ANALYZE issue_assignees");
  console.log(JSON.stringify({ perfProject: perf.id, archivedExtra, extraProjects: summary }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
