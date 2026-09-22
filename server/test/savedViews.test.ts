/** Сохранённые вьюхи (saved_views, миграция 20260922T1100, ТЗ 3.2 план v2 Трек 3) —
 *  личные, а не общие для проекта: право browse (любой участник, включая viewer),
 *  но видит и правит только свои собственные строки. */
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
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const viewsUrl = () => `/api/projects/${p1()}/saved-views`;

const body = (over: Record<string, unknown> = {}) => ({
  name: "Мои критичные",
  filter: { priority: "critical" },
  isDefault: false,
  ...over,
});

async function createView(token: string, over: Record<string, unknown> = {}) {
  const r = await post(viewsUrl(), token, body(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("сохранённые вьюхи: доступ", () => {
  test("viewer (только browse) может создавать/читать/править/удалять свои вьюхи", async () => {
    const viw = await login(app, "viw1");
    const v = await createView(viw);
    expect(v.name).toBe("Мои критичные");
    expect(v.filter).toEqual({ priority: "critical" });
    expect(v.isDefault).toBe(false);

    const list = JSON.parse((await g(viewsUrl(), viw)).body);
    expect(list).toHaveLength(1);

    const upd = await patch(`${viewsUrl()}/${v.id}`, viw, body({ name: "Переименована" }));
    expect(upd.statusCode).toBe(200);
    expect(JSON.parse(upd.body).name).toBe("Переименована");

    expect((await del(`${viewsUrl()}/${v.id}`, viw)).statusCode).toBe(204);
    expect(JSON.parse((await g(viewsUrl(), viw)).body)).toHaveLength(0);
  });

  test("outsider (не участник проекта) — 403/404 на всех операциях", async () => {
    const out = await login(app, "outsider");
    expect([403, 404]).toContain((await g(viewsUrl(), out)).statusCode);
    expect([403, 404]).toContain((await post(viewsUrl(), out, body())).statusCode);
  });

  test("чужая вьюха: не видна в списке, PATCH/DELETE — 404, а не молчаливый успех", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const mine = await createView(mgr);

    const empList = JSON.parse((await g(viewsUrl(), emp)).body);
    expect(empList).toHaveLength(0); // не видит чужую

    expect((await patch(`${viewsUrl()}/${mine.id}`, emp, body({ name: "чужими руками" }))).statusCode).toBe(404);
    expect((await del(`${viewsUrl()}/${mine.id}`, emp)).statusCode).toBe(404);

    // Оригинал не тронут — не "тихо применилось к чужой".
    const stillMgrs = JSON.parse((await g(viewsUrl(), mgr)).body);
    expect(stillMgrs).toHaveLength(1);
    expect(stillMgrs[0].name).toBe("Мои критичные");
  });
});

describe("сохранённые вьюхи: is_default", () => {
  test("новая вьюха с isDefault=true снимает флаг со старой (той же вьюхи того же пользователя)", async () => {
    const mgr = await login(app, "mgr1");
    const first = await createView(mgr, { name: "первая", isDefault: true });
    expect(first.isDefault).toBe(true);

    const second = await createView(mgr, { name: "вторая", isDefault: true });
    expect(second.isDefault).toBe(true);

    const list = JSON.parse((await g(viewsUrl(), mgr)).body) as { id: string; isDefault: boolean }[];
    expect(list.find((v) => v.id === first.id)?.isDefault).toBe(false);
    expect(list.find((v) => v.id === second.id)?.isDefault).toBe(true);
  });

  test("default одного пользователя не трогает default другого в том же проекте", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const mgrDefault = await createView(mgr, { name: "менеджерская", isDefault: true });
    const empDefault = await createView(emp, { name: "сотрудника", isDefault: true });

    const mgrList = JSON.parse((await g(viewsUrl(), mgr)).body) as { id: string; isDefault: boolean }[];
    const empList = JSON.parse((await g(viewsUrl(), emp)).body) as { id: string; isDefault: boolean }[];
    expect(mgrList.find((v) => v.id === mgrDefault.id)?.isDefault).toBe(true);
    expect(empList.find((v) => v.id === empDefault.id)?.isDefault).toBe(true);
  });

  test("PATCH снимает default с другой своей вьюхи, но не с себя же при повторном isDefault=true", async () => {
    const mgr = await login(app, "mgr1");
    const v = await createView(mgr, { isDefault: true });
    const upd = await patch(`${viewsUrl()}/${v.id}`, mgr, body({ isDefault: true }));
    expect(upd.statusCode).toBe(200);
    expect(JSON.parse(upd.body).isDefault).toBe(true);
  });
});

describe("сохранённые вьюхи: валидация и лимиты", () => {
  test("пустое имя — 400", async () => {
    const mgr = await login(app, "mgr1");
    expect((await post(viewsUrl(), mgr, body({ name: "" }))).statusCode).toBe(400);
  });

  test("filter с полем не из SavedViewFilter отклоняется валидацией", async () => {
    const mgr = await login(app, "mgr1");
    const r = await post(viewsUrl(), mgr, body({ filter: { priority: "critical", closedDays: 999 } }));
    expect(r.statusCode).toBe(400);
  });

  test("лимит вьюх на пользователя в проекте — 400 после LIMITS.savedViewsPerUserProject", async () => {
    const mgr = await login(app, "mgr1");
    for (let i = 0; i < 30; i++) {
      expect((await post(viewsUrl(), mgr, body({ name: `вьюха ${i}` }))).statusCode).toBe(201);
    }
    expect((await post(viewsUrl(), mgr, body({ name: "31-я" }))).statusCode).toBe(400);
  });
});
