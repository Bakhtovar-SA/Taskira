/** Самопроверка `responseContract.ts`: хук действительно разбирает ответы и ловит расхождение. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { auth, getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { RESPONSES, checkedRoutes, takeViolations } from "./responseContract.js";
import { ROUTES } from "./access/routes.manifest.js";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await stopApp(); });
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });

test("every checked route exists in the route manifest", () => {
  expect(Object.keys(RESPONSES).filter((route) => !(route in ROUTES))).toEqual([]);
});

test("a response that matches its schema is checked and reports nothing", async () => {
  const token = await login(app, "mgr1");
  const me = await app.inject({ url: "/api/auth/me", headers: auth(token) });
  const project = await app.inject({ url: `/api/projects/${fx.projects.p1}`, headers: auth(token) });
  const issues = await app.inject({ url: `/api/projects/${fx.projects.p1}/issues`, headers: auth(token) });
  expect([me.statusCode, project.statusCode, issues.statusCode]).toEqual([200, 200, 200]);
  expect(checkedRoutes()).toEqual(expect.arrayContaining(["GET /api/auth/me", "GET /api/projects/:projectId", "GET /api/projects/:projectId/issues"]));
  expect(takeViolations()).toEqual([]);
});

test("a response that does not match its schema is reported", async () => {
  const token = await login(app, "mgr1");
  const original = RESPONSES["GET /api/auth/me"];
  RESPONSES["GET /api/auth/me"] = z.object({ noSuchField: z.string() });
  try {
    const me = await app.inject({ url: "/api/auth/me", headers: auth(token) });
    expect(me.statusCode).toBe(200);
  } finally {
    RESPONSES["GET /api/auth/me"] = original;
  }
  const found = takeViolations(); // забираем сами, иначе afterEach уронит этот тест
  expect(found.map((v) => v.route)).toEqual(["GET /api/auth/me"]);
  expect(found[0].issues).toContain("noSuchField");
});
