/** Общий инструментарий интеграционных тестов: приложение, фикстуры, логин. */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { initConfig, loadConfig } from "../src/config.js";
import { initPool, closePool, q } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { seedProjectWorkflow } from "../src/services/workflow.js";

const PASS = "password123";

let app: FastifyInstance | null = null;

/** Поднимает Fastify один раз на файл тестов (без listen — используем app.inject). */
export async function getApp(): Promise<FastifyInstance> {
  if (app) return app;
  initConfig();
  initPool(loadConfig().databaseUrl);
  app = buildApp();
  await app.ready();
  return app;
}

export async function stopApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
  await closePool();
}

/** Чистит все таблицы. Вызывать в beforeEach перед seedFixture(). */
export async function resetDb(): Promise<void> {
  await q(
    `TRUNCATE departments, projects, users, project_members, workflow_statuses,
      workflow_transitions, sprints, issues, comments, activity, issue_watchers,
      project_counters, audit_log RESTART IDENTITY CASCADE`,
  );
}

export interface Fixture {
  pass: string;
  users: { admin: string; mgr1: string; emp1: string; viw1: string; mgr2: string; outsider: string };
  depts: { d1: string; d2: string };
  projects: { p1: string; p2: string };
  issues: { p1issue: string; p2issue: string };
  p1status: { todo: string; inprogress: string };
}

/**
 * Фикстура:
 *  users: admin (global admin, без членства); outsider (member, нигде не участник);
 *         mgr1/emp1/viw1 — manager/employee/viewer в P1; mgr2 — manager в P2.
 *  P1 (CORP) в D1, P2 (SEC) в D2 — оба не shared.
 *  По задаче в каждом проекте (P1: reporter+assignee = emp1; P2: mgr2).
 */
export async function seedFixture(): Promise<Fixture> {
  const hash = await bcrypt.hash(PASS, 4); // низкий cost — быстрее в тестах

  const mkUser = async (username: string, name: string, role: "admin" | "member") =>
    (
      await q<{ id: string }>(
        `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role)
         VALUES ($1, $2, $3, 'XX', '#334455', 'qa', $4) RETURNING id`,
        [username, hash, name, role],
      )
    )[0].id;

  const admin = await mkUser("admin", "Admin", "admin");
  const mgr1 = await mkUser("mgr1", "Manager One", "member");
  const emp1 = await mkUser("emp1", "Employee One", "member");
  const viw1 = await mkUser("viw1", "Viewer One", "member");
  const mgr2 = await mkUser("mgr2", "Manager Two", "member");
  const outsider = await mkUser("outsider", "Outsider", "member");

  const d1 = (await q<{ id: string }>(`INSERT INTO departments (name) VALUES ('Dept One') RETURNING id`))[0].id;
  const d2 = (await q<{ id: string }>(`INSERT INTO departments (name) VALUES ('Dept Two') RETURNING id`))[0].id;

  const mkProject = async (key: string, name: string, deptId: string) =>
    (
      await q<{ id: string }>(
        `INSERT INTO projects (key, name, description, department_id) VALUES ($1, $2, '', $3) RETURNING id`,
        [key, name, deptId],
      )
    )[0].id;
  const p1 = await mkProject("CORP", "Corp", d1);
  const p2 = await mkProject("SEC", "Sec", d2);
  await seedProjectWorkflow(p1);
  await seedProjectWorkflow(p2);

  const addMember = (pid: string, uid: string, role: string) =>
    q(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)`, [pid, uid, role]);
  await addMember(p1, mgr1, "manager");
  await addMember(p1, emp1, "employee");
  await addMember(p1, viw1, "viewer");
  await addMember(p2, mgr2, "manager");

  const statusId = async (pid: string, sid: string) =>
    (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = $2`, [pid, sid]))[0].id;
  const p1todo = await statusId(p1, "todo");
  const p1inprogress = await statusId(p1, "inprogress");
  const p2todo = await statusId(p2, "todo");

  const mkIssue = async (pid: string, key: string, statusId2: string, reporter: string, assignee: string | null) => {
    const id = (
      await q<{ id: string }>(
        `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id,
                             reporter_id, assignee_id, labels, rank)
         VALUES ($1, 1, $2, 't', '', 'task', $3, 'medium', $4, $5, '{}', 1) RETURNING id`,
        [pid, `${key}-1`, statusId2, reporter, assignee],
      )
    )[0].id;
    // счётчик номеров: следующая задача проекта — с num=2
    await q(`INSERT INTO project_counters (project_id, next_num) VALUES ($1, 2)`, [pid]);
    return id;
  };
  const p1issue = await mkIssue(p1, "CORP", p1todo, emp1, emp1);
  const p2issue = await mkIssue(p2, "SEC", p2todo, mgr2, mgr2);

  return {
    pass: PASS,
    users: { admin, mgr1, emp1, viw1, mgr2, outsider },
    depts: { d1, d2 },
    projects: { p1, p2 },
    issues: { p1issue, p2issue },
    p1status: { todo: p1todo, inprogress: p1inprogress },
  };
}

export async function login(instance: FastifyInstance, username: string, password = PASS): Promise<string> {
  const res = await instance.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login ${username}: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).token as string;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Минимальное валидное тело создания задачи. */
export const newIssue = (over: Record<string, unknown> = {}) => ({
  title: "test issue",
  typeId: "task",
  priorityId: "medium",
  assigneeId: null,
  epicId: null,
  points: null,
  sprintId: null,
  ...over,
});
