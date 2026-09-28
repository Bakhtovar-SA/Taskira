/** GET /api/admin/license (ТЗ 5.9): статус для страницы «Лицензия»; только глобальный admin; токен не отдаётся. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp } from "./helpers.js";

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

describe("GET /api/admin/license", () => {
  test("без лицензии — state: unset", async () => {
    const adm = await login(app, "admin");
    const res = await app.inject({ method: "GET", url: "/api/admin/license", headers: auth(adm) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ state: "unset" });
  });

  test("испорченный токен — state: invalid с причиной, сам токен в ответе не встречается", async () => {
    await q(`INSERT INTO instance (id, name, license_key) VALUES (1, 'test', 'not.a.license') ON CONFLICT (id) DO UPDATE SET license_key = EXCLUDED.license_key`);
    const adm = await login(app, "admin");
    const res = await app.inject({ method: "GET", url: "/api/admin/license", headers: auth(adm) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.state).toBe("invalid");
    expect(typeof body.reason).toBe("string");
    expect(res.body).not.toContain("not.a.license");
  });

  test("не админ — 403", async () => {
    const mgr = await login(app, "mgr1");
    const res = await app.inject({ method: "GET", url: "/api/admin/license", headers: auth(mgr) });
    expect(res.statusCode).toBe(403);
  });
});
