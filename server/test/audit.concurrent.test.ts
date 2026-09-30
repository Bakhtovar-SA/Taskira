import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { withClient } from "../src/db.js";
import { provisionFromLdap } from "../src/services/userProvisioning.js";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });

// Hold a real database gate until both requests reach it; no timing-only race assertion.
async function concurrentAt<T>(key: string, run: () => [Promise<T>, Promise<T>]): Promise<T[]> {
  return withClient(async (gate) => {
    await gate.query(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
    const pending = run();
    try {
      let waiting = 0;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const rows = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`);
        waiting = rows[0].n;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      await gate.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
      await Promise.allSettled(pending);
    }
    return Promise.all(pending);
  });
}

test("конкурентное создание сохраняет разные ранги в одной колонке", async () => {
  const token = await login(app, "admin");
  const create = (title: string) => app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/issues`, headers: auth(token), payload: newIssue({ title, statusId: fx.p1status.todo }) }).then((r) => r);
  const results = await concurrentAt(fx.p1status.todo, () => [create("Первый"), create("Второй")]);
  expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
  const ids = results.map((r) => JSON.parse(r.body).id);
  const rows = await q<{ rank: number }>(`SELECT rank FROM issues WHERE id = ANY($1::uuid[])`, [ids]);
  expect(new Set(rows.map((r) => r.rank)).size).toBe(2);
});

test.each([false, true])("конкурентные переходы соблюдают workflow и историю (bulk=%s)", async (bulk) => {
  const token = await login(app, "admin");
  const { todo, inprogress } = fx.p1status;
  const [{ id: done }] = await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND category = 'done' LIMIT 1`, [fx.projects.p1]);
  await q(`DELETE FROM workflow_transitions WHERE project_id = $1`, [fx.projects.p1]);
  await q(`INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [fx.projects.p1, todo, inprogress, done]);
  const move = (to: string) => app.inject(bulk
    ? { method: "PATCH", url: `/api/projects/${fx.projects.p1}/issues/bulk`, headers: auth(token), payload: { issueIds: [fx.issues.p1issue], action: "status", statusId: to } }
    : { method: "POST", url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`, headers: auth(token), payload: { to } }).then((r) => r);
  const results = await concurrentAt(todo, () => [move(inprogress), move(done)]);
  if (bulk) {
    const bodies = results.map((r) => JSON.parse(r.body));
    expect(bodies.flatMap((b) => b.succeeded)).toHaveLength(1);
    expect(bodies.flatMap((b) => b.failed)).toHaveLength(1);
  } else expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const [row] = await q<{ status_id: string; done_at: Date | null }>(`SELECT status_id, done_at FROM issues WHERE id = $1`, [fx.issues.p1issue]);
  expect([inprogress, done]).toContain(row.status_id);
  expect(row.done_at !== null).toBe(row.status_id === done);
  expect(await q(`SELECT id FROM activity WHERE issue_id = $1 AND text LIKE 'переместил(а)%'`, [fx.issues.p1issue])).toHaveLength(1);
});

test("две операции не могут убрать обоих последних активных администраторов", async () => {
  await q(`UPDATE users SET global_role = 'admin' WHERE id = $1`, [fx.users.mgr1]);
  const token = await login(app, "admin");
  const demote = (id: string) => app.inject({ method: "PATCH", url: `/api/users/${id}`, headers: auth(token), payload: { globalRole: "member", isActive: false } }).then((r) => r);
  const results = await concurrentAt("taskira:active-admins", () => [demote(fx.users.admin), demote(fx.users.mgr1)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await q(`SELECT id FROM users WHERE global_role = 'admin' AND is_active`)).toHaveLength(1);
});

test("конкурентный LDAP-синк сохраняет последнего администратора и отзывает прежнюю сессию пониженного", async () => {
  await q(`UPDATE users SET global_role = 'admin' WHERE id = $1`, [fx.users.mgr1]);
  const tokens = { admin: await login(app, "admin"), mgr1: await login(app, "mgr1") };
  const sync = (login: "admin" | "mgr1") => provisionFromLdap({ login, dn: `uid=${login},dc=test`, name: login, email: null, title: null, phone: null, groupDns: [] });
  const results = await concurrentAt("taskira:active-admins", () => [sync("admin"), sync("mgr1")]);
  expect(results.filter((r) => r.global_role === "admin")).toHaveLength(1);
  expect(await q(`SELECT id FROM users WHERE global_role = 'admin' AND is_active`)).toHaveLength(1);
  const demoted = results.find((r) => r.global_role === "member")!;
  const token = demoted.id === fx.users.admin ? tokens.admin : tokens.mgr1;
  expect((await app.inject({ url: "/api/auth/me", headers: auth(token) })).statusCode).toBe(401);
});
