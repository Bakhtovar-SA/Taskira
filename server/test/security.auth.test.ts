import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await stopApp(); });
beforeEach(async () => { await resetDb(); await seedFixture(); });

describe("account lockout and audit export", () => {
  test("locks a known account after repeated failures and unlocks after the window", async () => {
    for (let i = 0; i < 5; i++) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "emp1", password: "definitely-wrong" },
      });
      expect(denied.statusCode).toBe(401);
    }

    const locked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "password123" },
    });
    expect(locked.statusCode).toBe(401);

    await q(`UPDATE users SET locked_until = now() - interval '1 second' WHERE username = 'emp1'`);
    const token = await login(app, "emp1");
    expect(token).toBeTruthy();
    const state = (await q<{ failed_login_attempts: number; locked_until: Date | null }>(
      `SELECT failed_login_attempts, locked_until FROM users WHERE username = 'emp1'`,
    ))[0];
    expect(state).toEqual({ failed_login_attempts: 0, locked_until: null });
  });

  test("starts a fresh failure window after a lock naturally expires", async () => {
    await q(
      `UPDATE users
          SET failed_login_attempts = 5, locked_until = now() - interval '1 second'
        WHERE username = 'emp1'`,
    );

    const denied = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "one-new-typo" },
    });
    expect(denied.statusCode).toBe(401);

    const [state] = await q<{ failed_login_attempts: number; locked_until: Date | null }>(
      `SELECT failed_login_attempts, locked_until FROM users WHERE username = 'emp1'`,
    );
    expect(state).toEqual({ failed_login_attempts: 1, locked_until: null });
  });

  test("does not apply local lockout counters to LDAP accounts", async () => {
    await q(
      `UPDATE users SET auth_source = 'ldap', password_hash = NULL WHERE username = 'emp1'`,
    );

    for (let i = 0; i < 5; i++) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "emp1", password: "wrong-ldap-password" },
      });
      expect(denied.statusCode).toBe(401);
    }

    const [state] = await q<{ failed_login_attempts: number; locked_until: Date | null }>(
      `SELECT failed_login_attempts, locked_until FROM users WHERE username = 'emp1'`,
    );
    expect(state).toEqual({ failed_login_attempts: 0, locked_until: null });
  });

  test("exports parseable one-record-per-line JSONL and stable CSV columns", async () => {
    const token = await login(app, "admin");
    await q(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details, result)
       SELECT id, 'security.test', 'user', id, $1::jsonb, 'denied' FROM users WHERE username = 'emp1'`,
      [JSON.stringify({ note: "line one\nline two" })],
    );

    const jsonl = await app.inject({
      url: "/api/admin/audit-log/export?format=jsonl",
      headers: auth(token),
    });
    expect(jsonl.statusCode).toBe(200);
    expect(jsonl.headers["content-type"]).toContain("application/x-ndjson");
    const records = jsonl.body.trim().split("\n").map((line) => JSON.parse(line));
    expect(records.some((row) => row.action === "security.test" && row.result === "denied")).toBe(true);
    for (const row of records) {
      expect(Object.keys(row)).toEqual(["timestamp", "actor", "action", "object", "result", "details"]);
      expect(new Date(row.timestamp).toISOString()).toBe(row.timestamp);
    }

    const csv = await app.inject({
      url: "/api/admin/audit-log/export?format=csv",
      headers: auth(token),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split("\n")[0]).toBe("timestamp,actor,action,object,result,details");
  });

  test("marks an audit export when the selected window is truncated", async () => {
    const token = await login(app, "admin");
    await q(
      `INSERT INTO audit_log (actor_id, action, entity, details, result)
       SELECT id, 'security.extra', 'user', '{}'::jsonb, 'success'
         FROM users WHERE username = 'admin'`,
    );
    const response = await app.inject({
      url: "/api/admin/audit-log/export?format=jsonl&limit=1",
      headers: auth(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-taskira-truncated"]).toBe("true");
    expect(response.headers["x-taskira-limit"]).toBe("1");
    expect(response.body.trim().split("\n")).toHaveLength(1);
  });

  test("denies audit export to a non-admin user", async () => {
    const token = await login(app, "emp1");
    const response = await app.inject({
      url: "/api/admin/audit-log/export?format=jsonl",
      headers: auth(token),
    });
    expect(response.statusCode).toBe(403);
  });
});
