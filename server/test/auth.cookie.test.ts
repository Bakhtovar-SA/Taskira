import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getApp, resetDb, seedFixture, stopApp } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  await seedFixture();
});

function setCookieHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("; ") : value ?? "";
}

describe("HttpOnly session cookie", () => {
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

    const cookie = setCookie.split(";", 1)[0];
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).username).toBe("emp1");
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
