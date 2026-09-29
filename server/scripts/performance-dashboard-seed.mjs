/**
 * Стенд для замера дашбордов (ADR-0022): 100 проектов в 10 командах, по умолчанию 500 задач в каждом (50 000),
 * 80 человек, исполнители, сроки, закрытые и архивные задачи, история изменений — чтобы у каждого виджета были
 * данные реальной формы. Замер — performance-dashboard.mjs.
 *
 * Запускать ТОЛЬКО на отдельной БД, уже прошедшей миграции (достаточно один раз запустить на ней сервер):
 *   PERF_CONFIRM=seed-dashboards DATABASE_URL=postgresql://.../taskira_dashperf node scripts/performance-dashboard-seed.mjs
 * Повторный запуск пересоздаёт проекты DSH001…DSH100 и пользователей dash_NN.
 */
import bcrypt from "bcryptjs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.PERF_CONFIRM !== "seed-dashboards") {
  throw new Error("Refusing to alter data: set PERF_CONFIRM=seed-dashboards for an isolated performance database");
}
const projectCount = Number(process.env.PERF_PROJECTS ?? 100);
const issuesPerProject = Number(process.env.PERF_ISSUES_PER_PROJECT ?? 500);
const userCount = Number(process.env.PERF_USERS ?? 80);
const membersPerProject = Number(process.env.PERF_MEMBERS_PER_PROJECT ?? 12);
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Dash-User-42!";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const t0 = Date.now();
try {
  await client.query("BEGIN");
  await client.query(`DELETE FROM projects WHERE key ~ '^DSH[0-9]{3}$'`);

  const depts = [];
  for (let d = 1; d <= 10; d++) {
    const r = await client.query(
      `INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [`Команда ${d}`],
    );
    depts.push(r.rows[0].id);
  }

  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role, is_active)
     SELECT 'dash_' || lpad(n::text, 2, '0'), $1, 'Сотрудник ' || n, 'С' || (n % 10), '#6D5BD0', 'нагрузка', 'member', true
       FROM generate_series(1, $2::int) AS n
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, auth_source = 'local'`,
    [hash, userCount],
  );
  const users = (await client.query(`SELECT id FROM users WHERE username ~ '^dash_[0-9]{2}$' ORDER BY username`)).rows.map((r) => r.id);

  for (let p = 1; p <= projectCount; p++) {
    const key = `DSH${String(p).padStart(3, "0")}`;
    const pr = await client.query(
      `INSERT INTO projects (key, name, description, department_id, is_shared, start_date, target_date)
       VALUES ($1, $2, '', $3, false, CURRENT_DATE - (random() * 200)::int, CURRENT_DATE + (random() * 200)::int)
       RETURNING id`,
      [key, `Проект ${p}`, depts[(p - 1) % depts.length]],
    );
    const projectId = pr.rows[0].id;
    const st = await client.query(
      `INSERT INTO workflow_statuses (project_id, sid, name, category, position)
       VALUES ($1, 'todo', 'К выполнению', 'todo', 0), ($1, 'inprogress', 'В работе', 'inprogress', 1),
              ($1, 'review', 'На проверке', 'inprogress', 2), ($1, 'done', 'Готово', 'done', 3)
       RETURNING id, sid`,
      [projectId],
    );
    const s = Object.fromEntries(st.rows.map((r) => [r.sid, r.id]));
    // Участники: скользящее окно по списку людей — у каждого человека несколько проектов, у проекта своя команда.
    const members = Array.from({ length: membersPerProject }, (_, i) => users[(p * 7 + i) % users.length]);
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role) SELECT $1, unnest($2::uuid[]), 'employee'`,
      [projectId, members],
    );
    // Задачи: 45% закрыты, остальные в работе; сроки — нет / прошлые / ближайшие / дальние; созданы за 180 дней.
    await client.query(
      `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank,
                           due_date, created_at, updated_at, done_at, archived_at)
       SELECT $1, n, $2 || '-' || n, 'Задача ' || n, '',
              (ARRAY['task','task','task','bug','request'])[1 + (n % 5)],
              CASE WHEN r.x < 0.45 THEN $3::uuid WHEN r.x < 0.65 THEN $4::uuid WHEN r.x < 0.75 THEN $5::uuid ELSE $6::uuid END,
              (ARRAY['low','medium','medium','high','critical'])[1 + (n % 5)],
              $7, '{}', n,
              CASE WHEN r.y < 0.4 THEN NULL WHEN r.y < 0.55 THEN CURRENT_DATE - (1 + (r.z * 40)::int)
                   WHEN r.y < 0.75 THEN CURRENT_DATE + (r.z * 7)::int ELSE CURRENT_DATE + (8 + (r.z * 90)::int) END,
              c.at, c.at,
              CASE WHEN r.x < 0.45 THEN c.at + (now() - c.at) * r.z END,
              CASE WHEN r.x < 0.45 AND c.at + (now() - c.at) * r.z < now() - interval '30 days' THEN now() - interval '1 day' END
         FROM generate_series(1, $8::int) AS n
         CROSS JOIN LATERAL (SELECT random() AS x, random() AS y, random() AS z) r
         CROSS JOIN LATERAL (SELECT now() - make_interval(secs => random() * 180 * 86400) AS at) c`,
      [projectId, key, s.done, s.todo, s.review, s.inprogress, members[0], issuesPerProject],
    );
    await client.query(`INSERT INTO project_counters (project_id, next_num) VALUES ($1, $2)`, [projectId, issuesPerProject + 1]);
    // Исполнители: ~70% задач, у 15% — второй; нагрузка смещена к первым участникам проекта.
    await client.query(
      `INSERT INTO issue_assignees (issue_id, user_id)
       SELECT i.id, ($2::uuid[])[1 + floor(power(random(), 2) * $3)::int] FROM issues i WHERE i.project_id = $1 AND random() < 0.7
       ON CONFLICT DO NOTHING`,
      [projectId, members, members.length],
    );
    await client.query(
      `INSERT INTO issue_assignees (issue_id, user_id)
       SELECT i.id, ($2::uuid[])[1 + floor(random() * $3)::int] FROM issues i WHERE i.project_id = $1 AND random() < 0.15
       ON CONFLICT DO NOTHING`,
      [projectId, members, members.length],
    );
    // История: по 3 записи на задачу.
    await client.query(
      `INSERT INTO activity (issue_id, actor_id, text, created_at)
       SELECT i.id, ($2::uuid[])[1 + floor(random() * $3)::int], 'изменил(а) статус', i.created_at + (now() - i.created_at) * random()
         FROM issues i CROSS JOIN generate_series(1, 3) WHERE i.project_id = $1`,
      [projectId, members, members.length],
    );
  }
  await client.query("COMMIT");
  await client.query("ANALYZE");
  const totals = (await client.query(`SELECT (SELECT count(*) FROM issues) AS issues, (SELECT count(*) FROM activity) AS activity, (SELECT count(*) FROM issue_assignees) AS assignees`)).rows[0];
  console.log(JSON.stringify({ projects: projectCount, issuesPerProject, users: userCount, ...totals, seconds: Math.round((Date.now() - t0) / 1000) }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
