/**
 * SEC-PWD-01/02: смена своего пароля (POST /api/me/password) и административный сброс
 * (POST /api/admin/users/:id/password-reset) — только локальные учётки (ADR-0034).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
const NEW_PASS = "violet lantern quietly orbits";

beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await stopApp(); });
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });

const change = (a: FastifyInstance, token: string, currentPassword: string, newPassword: string) =>
  a.inject({ method: "POST", url: "/api/me/password", headers: auth(token), payload: { currentPassword, newPassword } });
const reset = (token: string, id: string) =>
  app.inject({ method: "POST", url: `/api/admin/users/${id}/password-reset`, headers: auth(token) });
const tryLogin = (username: string, password: string) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
const me = (token: string) => app.inject({ method: "GET", url: "/api/auth/me", headers: auth(token) });
const lastCookie = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : [raw];
  return String(all[all.length - 1]);
};
const auditRows = (action: string) =>
  q<{ actor_id: string | null; entity_id: string | null; result: string; details: Record<string, unknown> }>(
    `SELECT actor_id, entity_id, result, details FROM audit_log WHERE action = $1 ORDER BY created_at`, [action]);

describe("POST /api/me/password", () => {
  test("changes the password, revokes other sessions, keeps the caller signed in, audits", async () => {
    const other = await login(app, "emp1"); // вторая сессия (другое устройство)
    const current = await login(app, "emp1");
    const res = await change(app, current, fx.pass, NEW_PASS);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.mustChangePassword).toBe(false);
    expect(body.user.username).toBe("emp1");
    expect(lastCookie(res)).toContain(`taskira_session=${encodeURIComponent(body.token)}`);

    // старые токены — и чужой сессии, и того, кто менял, — больше не действуют (ASVS V7.4.3)
    expect((await me(other)).statusCode).toBe(401);
    expect((await me(current)).statusCode).toBe(401);
    expect((await me(body.token)).statusCode).toBe(200);

    expect((await tryLogin("emp1", fx.pass)).statusCode).toBe(401);
    expect((await tryLogin("emp1", NEW_PASS)).statusCode).toBe(200);

    const [row] = await q<{ password_hash: string; password_changed_at: Date | null }>(
      `SELECT password_hash, password_changed_at FROM users WHERE id = $1`, [fx.users.emp1]);
    expect(row.password_hash.startsWith("sha256b64$")).toBe(true);
    expect(row.password_changed_at).not.toBeNull();

    const audit = await auditRows("auth.password.change");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: fx.users.emp1, entity_id: fx.users.emp1, result: "success" });
    expect(JSON.stringify(audit[0].details)).not.toContain(NEW_PASS);
  });

  test("wrong current password: 403 (not 401), counts toward the account lockout, audited", async () => {
    const token = await login(app, "emp1");
    const res = await change(app, token, "definitely-wrong", NEW_PASS);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CURRENT_PASSWORD_INVALID");
    expect((await me(token)).statusCode).toBe(200); // сессия цела

    const [state] = await q<{ failed_login_attempts: number }>(`SELECT failed_login_attempts FROM users WHERE id = $1`, [fx.users.emp1]);
    expect(state.failed_login_attempts).toBe(1);
    expect((await auditRows("auth.password.change"))[0]).toMatchObject({ result: "denied", details: { reason: "wrong_current" } });

    for (let i = 0; i < 4; i++) expect((await change(app, token, "definitely-wrong", NEW_PASS)).statusCode).toBe(403);
    const locked = await change(app, token, fx.pass, NEW_PASS); // даже верный пароль — пока действует блокировка
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("ACCOUNT_LOCKED");
    expect((await tryLogin("emp1", fx.pass)).statusCode).toBe(401); // и вход заблокирован тем же счётчиком
  });

  test("policy violations get specific codes", async () => {
    const token = await login(app, "emp1");
    const codeOf = async (pw: string) => (await change(app, token, fx.pass, pw)).json().error.code;
    expect(await codeOf("short-pass-1")).toBe("PASSWORD_TOO_SHORT");
    expect(await codeOf("x".repeat(129))).toBe("PASSWORD_TOO_LONG");
    expect(await codeOf("Aaaaaaaaaaaaaaaa1")).toBe("PASSWORD_COMMON");
    expect(await codeOf("my-emp1-secret-lantern")).toBe("PASSWORD_CONTAINS_USERNAME");
    expect(await codeOf("taskira lantern orbit")).toBe("PASSWORD_CONTEXT_WORD");
    expect(await codeOf("lantern orbit dept quietly")).toBe("PASSWORD_CONTEXT_WORD"); // название команды «Dept One»
    expect(await codeOf("employee lantern orbit")).toBe("PASSWORD_CONTEXT_WORD"); // собственное имя «Employee One»
    const [state] = await q<{ failed_login_attempts: number }>(`SELECT failed_login_attempts FROM users WHERE id = $1`, [fx.users.emp1]);
    expect(state.failed_login_attempts).toBe(0); // нарушение политики — не неверный пароль
  });

  test("the new password must differ from the current one", async () => {
    const token = await login(app, "emp1");
    expect((await change(app, token, fx.pass, NEW_PASS)).statusCode).toBe(200);
    const fresh = await login(app, "emp1", NEW_PASS);
    const res = await change(app, fresh, NEW_PASS, NEW_PASS);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("PASSWORD_REUSED");
  });

  test("passwords longer than 72 bytes are significant in full (no bcrypt truncation)", async () => {
    const head = "плавный зелёный трамвай гудит у старого моста"; // первые 72+ байта общие
    expect(Buffer.byteLength(head)).toBeGreaterThanOrEqual(72);
    const long = `${head} ночью`;
    const token = await login(app, "emp1");
    expect((await change(app, token, fx.pass, long)).statusCode).toBe(200);
    expect((await tryLogin("emp1", `${head} днём`)).statusCode).toBe(401);
    expect((await tryLogin("emp1", long)).statusCode).toBe(200);
  });

  test("LDAP accounts are refused with a clear code", async () => {
    const token = await login(app, "emp1");
    await q(`UPDATE users SET auth_source = 'ldap', password_hash = NULL WHERE id = $1`, [fx.users.emp1]);
    const res = await change(app, token, fx.pass, NEW_PASS);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PASSWORD_NOT_LOCAL");
  });

  test("a legacy bcrypt hash is rewritten in the new format on login", async () => {
    await login(app, "mgr1");
    const [row] = await q<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [fx.users.mgr1]);
    expect(row.password_hash.startsWith("sha256b64$")).toBe(true);
    expect((await tryLogin("mgr1", fx.pass)).statusCode).toBe(200);
  });
});

describe("POST /api/admin/users/:id/password-reset", () => {
  test("issues a one-time temporary password that only allows changing the password", async () => {
    const victimSession = await login(app, "emp1");
    const admin = await login(app, "admin");
    const res = await reset(admin, fx.users.emp1);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { temporaryPassword, expiresAt } = res.json();
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
    const ttlMs = new Date(expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 3600_000);
    expect(ttlMs).toBeLessThanOrEqual(24 * 3600_000);

    // сессии пользователя отозваны, прежний пароль больше не подходит
    expect((await me(victimSession)).statusCode).toBe(401);
    expect((await tryLogin("emp1", fx.pass)).statusCode).toBe(401);

    // вход временным паролем — сессия только для смены пароля
    const tempLogin = await tryLogin("emp1", temporaryPassword);
    expect(tempLogin.statusCode).toBe(200);
    expect(tempLogin.json().mustChangePassword).toBe(true);
    const temp = tempLogin.json().token as string;
    const blocked = await app.inject({ method: "GET", url: "/api/projects", headers: auth(temp) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await me(temp)).json().mustChangePassword).toBe(true);

    const changed = await change(app, temp, temporaryPassword, NEW_PASS);
    expect(changed.statusCode).toBe(200);
    const fresh = changed.json().token as string;
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: auth(fresh) })).statusCode).toBe(200);
    expect((await me(fresh)).json().mustChangePassword).toBe(false);
    // временный пароль одноразовый: после смены им не войти
    expect((await tryLogin("emp1", temporaryPassword)).statusCode).toBe(401);

    const audit = await auditRows("user.password.reset");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: fx.users.admin, entity_id: fx.users.emp1, result: "success" });
    expect(JSON.stringify(audit[0].details)).not.toContain(temporaryPassword);
    expect((await auditRows("auth.password.change")).at(-1)).toMatchObject({ details: { forced: true } });
  });

  test("an expired temporary password fails like any wrong password", async () => {
    const admin = await login(app, "admin");
    const { temporaryPassword } = (await reset(admin, fx.users.emp1)).json();
    await q(`UPDATE users SET password_expires_at = now() - interval '1 second' WHERE id = $1`, [fx.users.emp1]);
    const res = await tryLogin("emp1", temporaryPassword);
    expect(res.statusCode).toBe(401);
    const [state] = await q<{ failed_login_attempts: number }>(`SELECT failed_login_attempts FROM users WHERE id = $1`, [fx.users.emp1]);
    expect(state.failed_login_attempts).toBe(1);
  });

  test("reset clears an account lockout", async () => {
    await q(`UPDATE users SET failed_login_attempts = 5, locked_until = now() + interval '1 hour' WHERE id = $1`, [fx.users.emp1]);
    const admin = await login(app, "admin");
    const { temporaryPassword } = (await reset(admin, fx.users.emp1)).json();
    expect((await tryLogin("emp1", temporaryPassword)).statusCode).toBe(200);
  });

  test("refusals: non-admin 403, LDAP 409, self 409, unknown 404", async () => {
    const employee = await login(app, "emp1");
    const denied = await reset(employee, fx.users.mgr1);
    expect(denied.statusCode).toBe(403);

    const admin = await login(app, "admin");
    await q(`UPDATE users SET auth_source = 'ldap', password_hash = NULL WHERE id = $1`, [fx.users.mgr1]);
    const ldap = await reset(admin, fx.users.mgr1);
    expect(ldap.statusCode).toBe(409);
    expect(ldap.json().error.code).toBe("PASSWORD_NOT_LOCAL");

    const self = await reset(admin, fx.users.admin);
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe("PASSWORD_RESET_SELF");

    expect((await reset(admin, "00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
    expect(await auditRows("user.password.reset")).toHaveLength(0);
  });

  test("a user created with mustChangePassword must change it on first login", async () => {
    const admin = await login(app, "admin");
    const created = await app.inject({
      method: "POST", url: "/api/admin/users", headers: auth(admin),
      payload: { username: "newbie", password: "amber kettle drifts slowly", name: "New Person", initials: "NP", color: "#334455", jobRole: "qa", mustChangePassword: true },
    });
    expect(created.statusCode).toBe(201);
    const first = await tryLogin("newbie", "amber kettle drifts slowly");
    expect(first.json().mustChangePassword).toBe(true);
    const res = await app.inject({ method: "GET", url: "/api/projects", headers: auth(first.json().token) });
    expect(res.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

describe("rate limit on password routes", () => {
  const cfg = () => loadConfig().rateLimit;
  let saved = { ...cfg() };
  const opened: FastifyInstance[] = [];
  beforeAll(() => { saved = { ...cfg() }; });
  afterEach(async () => {
    for (const a of opened.splice(0)) await a.close();
    Object.assign(cfg(), saved);
  });

  test("POST /api/me/password returns 429 RATE_LIMITED past the limit", async () => {
    const token = await login(app, "emp1"); // вход — в базовом приложении, где лимиты выключены
    Object.assign(cfg(), { enabled: true, max: 1000, windowMs: 60_000, loginMax: 2, loginWindowMs: 60_000 });
    const limited = buildApp();
    opened.push(limited);
    await limited.ready();
    for (let i = 0; i < 2; i++) expect((await change(limited, token, fx.pass, "short")).statusCode).toBe(400);
    const blocked = await change(limited, token, fx.pass, "short");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
  });
});
