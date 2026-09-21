/**
 * Детерминированная фикстура нагрузочного стенда.
 * Запускается ТОЛЬКО на отдельной БД с PERF_CONFIRM=seed-50000: проект PERF
 * пересоздаётся логически (его задачи удаляются), прочие проекты не затрагиваются.
 */
import bcrypt from "bcryptjs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.PERF_CONFIRM !== "seed-50000") {
  throw new Error("Refusing to alter data: set PERF_CONFIRM=seed-50000 for an isolated performance database");
}

const issueCount = Number(process.env.PERF_ISSUES ?? 50_000);
const userCount = Number(process.env.PERF_USERS ?? 200);
const boardColumnSize = Number(process.env.PERF_BOARD_COLUMN ?? 1_500);
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Load-User-42!";
if (!Number.isInteger(issueCount) || issueCount < boardColumnSize) throw new Error("PERF_ISSUES must cover PERF_BOARD_COLUMN");
if (!Number.isInteger(userCount) || userCount < 1) throw new Error("PERF_USERS must be positive");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const department = await client.query(
    `INSERT INTO departments (name) VALUES ('Performance Lab')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const project = await client.query(
    `INSERT INTO projects (key, name, description, department_id, is_shared)
     VALUES ('PERF', 'Performance Fixture', 'Generated load-test data', $1, false)
     ON CONFLICT (key) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description, department_id = EXCLUDED.department_id
     RETURNING id`,
    [department.rows[0].id],
  );
  const projectId = project.rows[0].id;

  await client.query(`DELETE FROM issues WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM workflow_statuses WHERE project_id = $1`, [projectId]);
  const statuses = await client.query(
    `INSERT INTO workflow_statuses (project_id, sid, name, category, position)
     VALUES ($1, 'todo', 'К выполнению', 'todo', 0),
            ($1, 'inprogress', 'В работе', 'inprogress', 1),
            ($1, 'done', 'Готово', 'done', 2)
     RETURNING id, sid`,
    [projectId],
  );
  const bySid = new Map(statuses.rows.map((row) => [row.sid, row.id]));
  await client.query(
    `INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id)
     VALUES ($1, $2, $3), ($1, $3, $2), ($1, $3, $4), ($1, $4, $3)`,
    [projectId, bySid.get("todo"), bySid.get("inprogress"), bySid.get("done")],
  );

  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role, is_active)
     SELECT 'perf_' || lpad(n::text, 3, '0'), $1,
            'Performance User ' || n, 'PU', '#0B5FD9', 'load test', 'member', true
       FROM generate_series(1, $2::int) AS n
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, is_active = true, auth_source = 'local', session_version = 0`,
    [hash, userCount],
  );
  await client.query(
    `INSERT INTO project_members (project_id, user_id, role)
     SELECT $1, id, 'employee' FROM users WHERE username ~ '^perf_[0-9]{3}$'
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId],
  );

  const reporter = await client.query(`SELECT id FROM users WHERE username = 'perf_001'`);
  await client.query(
    `INSERT INTO issues
       (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank)
     SELECT $1, n, 'PERF-' || n, 'Performance issue ' || n, '', 'task',
            CASE
              WHEN n <= $2 THEN $3::uuid
              WHEN n % 4 = 0 THEN $4::uuid
              ELSE $5::uuid
            END,
            'medium', $6, '{}', n
       FROM generate_series(1, $7::int) AS n`,
    [projectId, boardColumnSize, bySid.get("todo"), bySid.get("done"), bySid.get("inprogress"), reporter.rows[0].id, issueCount],
  );
  await client.query(
    `INSERT INTO project_counters (project_id, next_num) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET next_num = EXCLUDED.next_num`,
    [projectId, issueCount + 1],
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ projectId, issueCount, userCount, boardColumnSize }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
