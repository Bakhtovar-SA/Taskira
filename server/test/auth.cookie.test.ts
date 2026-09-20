import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { JwtPayload } from "../src/middleware.js";
import { getApp, resetDb, seedFixture, stopApp } from "./helpers.js";

let app: FastifyInstance;
const previousVersion = process.env.TASKIRA_VERSION;
const previousCookieSecure = process.env.SESSION_COOKIE_SECURE;
const previousRotateAfter = process.env.SESSION_ROTATE_AFTER_SECONDS;

beforeAll(async () => {
  process.env.TASKIRA_VERSION = "3.2.1";
  process.env.SESSION_COOKIE_SECURE = "yes";
  process.env.SESSION_ROTATE_AFTER_SECONDS = "1";
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
  if (previousVersion === undefined) delete process.env.TASKIRA_VERSION;
  else process.env.TASKIRA_VERSION = previousVersion;
  if (previousCookieSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
  else process.env.SESSION_COOKIE_SECURE = previousCookieSecure;
  if (previousRotateAfter === undefined) delete process.env.SESSION_ROTATE_AFTER_SECONDS;
  else process.env.SESSION_ROTATE_AFTER_SECONDS = previousRotateAfter;
});
beforeEach(async () => {
  await resetDb();
  await seedFixture();
});

function setCookieHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("; ") : value ?? "";
}

describe("HttpOnly session cookie", () => {
  test("health endpoint reports the installed release version", async () => {
    const health = await app.inject({ url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, db: true, version: "3.2.1" });
  });

  test("SESSION_COOKIE_SECURE accepts the shared boolean aliases", async () => {
    const secure = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "password123" },
    });
    expect(setCookieHeader(secure.headers["set-cookie"])).toContain("; Secure");
  });

  test("login sets a hardened cookie and it authenticates without Authorization", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "password123" },
    });
    expect(login.statusCode).toBe(200);

    const setCookie = setCookieHeader(login.headers["set-cookie"]);
    expect(setCookie).toContain("taskira_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=28800");

    const cookie = setCookie.split(";", 1)[0];
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).username).toBe("emp1");
  });

  test("actively used browser sessions receive a rotated cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "password123" },
    });
    const initialToken = JSON.parse(login.body).token as string;
    const initialPayload = app.jwt.decode<JwtPayload>(initialToken);
    const cookie = setCookieHeader(login.headers["set-cookie"]).split(";", 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const rotated = setCookieHeader(me.headers["set-cookie"]);
    expect(rotated).toContain("taskira_session=");
    expect(rotated).not.toBe(setCookieHeader(login.headers["set-cookie"]));
    const rotatedToken = decodeURIComponent(rotated.split(";", 1)[0].split("=", 2)[1]);
    const rotatedPayload = app.jwt.decode<JwtPayload>(rotatedToken);
    expect(initialPayload.origIat).toBeTypeOf("number");
    expect(rotatedPayload.origIat).toBe(initialPayload.origIat);
    expect(rotatedPayload.exp).toBe(initialPayload.exp);
    expect(rotated).not.toContain("Max-Age=28800");
  });

  test("logout clears and revokes the cookie session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "emp1", password: "password123" },
    });
    const cookie = setCookieHeader(login.headers["set-cookie"]).split(";", 1)[0];

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    const cleared = setCookieHeader(logout.headers["set-cookie"]);
    expect(cleared).toContain("taskira_session=");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");

    const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
