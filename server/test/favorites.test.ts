/** Избранные проекты (user_favorite_projects, миграция 024). Персональная
 *  UX-настройка — доступна любому участнику видимого проекта (browse), не
 *  только manageAccess; хранится и читается через /api/auth/me, не bootstrap
 *  одного проекта — переключатель должен знать про избранное ещё до входа
 *  в конкретный проект. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
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

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });
const put = (url: string, token: string) => app.inject({ method: "PUT", url, headers: auth(token) });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const p2 = () => fx.projects.p2;
const favUrl = (pid: string) => `/api/projects/${pid}/favorite`;

async function meFavorites(token: string): Promise<string[]> {
  const r = await g("/api/auth/me", token);
  expect(r.statusCode).toBe(200);
  return JSON.parse(r.body).favoriteProjectIds;
}

describe("избранные проекты", () => {
  test("PUT добавляет в избранное, видно в /api/auth/me", async () => {
    const mgr = await login(app, "mgr1");
    expect(await meFavorites(mgr)).toEqual([]);

    const r = await put(favUrl(p1()), mgr);
    expect(r.statusCode).toBe(204);
    expect(await meFavorites(mgr)).toEqual([p1()]);
  });

  test("DELETE убирает из избранного", async () => {
    const mgr = await login(app, "mgr1");
    await put(favUrl(p1()), mgr);
    const r = await del(favUrl(p1()), mgr);
    expect(r.statusCode).toBe(204);
    expect(await meFavorites(mgr)).toEqual([]);
  });

  test("повторный PUT/DELETE идемпотентны — не 409/404, не дублируют запись", async () => {
    const mgr = await login(app, "mgr1");
    expect((await put(favUrl(p1()), mgr)).statusCode).toBe(204);
    expect((await put(favUrl(p1()), mgr)).statusCode).toBe(204);
    expect(await meFavorites(mgr)).toEqual([p1()]);

    expect((await del(favUrl(p1()), mgr)).statusCode).toBe(204);
    expect((await del(favUrl(p1()), mgr)).statusCode).toBe(204);
    expect(await meFavorites(mgr)).toEqual([]);
  });

  test("избранное — персональное: у mgr2 (участник P2) не появляется чужое избранное mgr1", async () => {
    const mgr1 = await login(app, "mgr1");
    const mgr2 = await login(app, "mgr2");
    await put(favUrl(p1()), mgr1);
    await put(favUrl(p2()), mgr2);

    expect(await meFavorites(mgr1)).toEqual([p1()]);
    expect(await meFavorites(mgr2)).toEqual([p2()]);
  });

  test("нельзя добавить в избранное проект, к которому нет доступа (browse) — 403", async () => {
    const outsider = await login(app, "outsider");
    const r = await put(favUrl(p1()), outsider);
    expect(r.statusCode).toBe(403);
    expect(await meFavorites(outsider)).toEqual([]);
  });

  test("удаление проекта каскадно убирает его из чужого избранного", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    await put(favUrl(p1()), mgr);
    expect(await meFavorites(mgr)).toEqual([p1()]);

    const r = await del(`/api/projects/${p1()}`, admin);
    expect(r.statusCode).toBe(204);
    expect(await meFavorites(mgr)).toEqual([]);
  });
});
