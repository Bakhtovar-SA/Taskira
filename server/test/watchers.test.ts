/** «Следить за задачей» (INVENTORY 1.2 №11): детальный ответ говорит, следит ли текущий пользователь и сколько
 *  всего подписчиков; POST/DELETE …/watchers/me переключают. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const url = () => `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`;
const watchOf = async (user: string) => (await app.inject({ url: url(), headers: auth(await login(app, user)) })).json().watch;

test("детальный ответ: watch для текущего пользователя; подписка и отписка", async () => {
  const before = await watchOf("viw1");
  expect(before.watching).toBe(false);
  const h = auth(await login(app, "viw1"));
  const on = await app.inject({ method: "POST", url: `${url()}/watchers/me`, headers: h });
  expect(on.json()).toEqual({ watching: true, watchers: before.watchers + 1 });
  expect(await watchOf("viw1")).toEqual({ watching: true, watchers: before.watchers + 1 });
  // Другой пользователь видит то же число, но не «я слежу».
  expect((await watchOf("mgr1")).watching).toBe(false);
  const off = await app.inject({ method: "DELETE", url: `${url()}/watchers/me`, headers: h });
  expect(off.json()).toEqual({ watching: false, watchers: before.watchers });
});

test("не участник проекта не может подписаться", async () => {
  const r = await app.inject({ method: "POST", url: `${url()}/watchers/me`, headers: auth(await login(app, "outsider")) });
  expect([403, 404]).toContain(r.statusCode);
});
