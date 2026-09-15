/** Состав отдела (department_members, миграция 009) — ручное добавление/удаление
 *  (source='manual'), для отделов без LDAP-группы или пока человек не попал ни в
 *  одну группу директории. LDAP-строки (source='ldap') из этих роутов не убираются —
 *  их пересобирает services/departmentSync.ts. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { addDeptMember, auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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

const membersUrl = (deptId: string, userId?: string) =>
  userId ? `/api/departments/${deptId}/members/${userId}` : `/api/departments/${deptId}/members`;

describe("состав отдела — ручное добавление/удаление", () => {
  test("global admin может добавить, увидеть и убрать вручную добавленного", async () => {
    const adm = await login(app, "admin");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;

    const add = await put(membersUrl(d1, uid), adm);
    expect(add.statusCode).toBe(200);
    const added = JSON.parse(add.body);
    expect(added).toMatchObject({ userId: uid, source: "manual" });

    const list = JSON.parse((await g(membersUrl(d1), adm)).body);
    expect(list.map((m: { userId: string }) => m.userId)).toContain(uid);

    const remove = await del(membersUrl(d1, uid), adm);
    expect(remove.statusCode).toBe(204);
    const listAfter = JSON.parse((await g(membersUrl(d1), adm)).body);
    expect(listAfter.map((m: { userId: string }) => m.userId)).not.toContain(uid);
  });

  test("добавление идемпотентно — повторный PUT не дублирует и не ошибается", async () => {
    const adm = await login(app, "admin");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;

    expect((await put(membersUrl(d1, uid), adm)).statusCode).toBe(200);
    expect((await put(membersUrl(d1, uid), adm)).statusCode).toBe(200);

    const list = JSON.parse((await g(membersUrl(d1), adm)).body);
    expect(list.filter((m: { userId: string }) => m.userId === uid)).toHaveLength(1);
  });

  test("не глобальный admin — 403 на всех трёх роутах", async () => {
    const mgr = await login(app, "mgr1");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;

    expect((await g(membersUrl(d1), mgr)).statusCode).toBe(403);
    expect((await put(membersUrl(d1, uid), mgr)).statusCode).toBe(403);
    expect((await del(membersUrl(d1, uid), mgr)).statusCode).toBe(403);
  });

  test("нельзя убрать LDAP-строку отсюда — 409, её пересоберёт синк", async () => {
    const adm = await login(app, "admin");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;
    await q(
      `INSERT INTO department_members (department_id, user_id, source) VALUES ($1, $2, 'ldap')`,
      [d1, uid],
    );

    const res = await del(membersUrl(d1, uid), adm);
    expect(res.statusCode).toBe(409);

    const list = JSON.parse((await g(membersUrl(d1), adm)).body);
    const row = list.find((m: { userId: string }) => m.userId === uid);
    expect(row?.source).toBe("ldap");
  });

  test("добавление к уже существующей LDAP-строке не перезаписывает source", async () => {
    const adm = await login(app, "admin");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;
    await q(
      `INSERT INTO department_members (department_id, user_id, source) VALUES ($1, $2, 'ldap')`,
      [d1, uid],
    );

    const res = await put(membersUrl(d1, uid), adm);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).source).toBe("ldap");
  });

  test("деактивированного пользователя добавить нельзя — 400", async () => {
    const adm = await login(app, "admin");
    const d1 = fx.depts.d1;
    const uid = fx.users.outsider;
    await q(`UPDATE users SET is_active = false WHERE id = $1`, [uid]);

    expect((await put(membersUrl(d1, uid), adm)).statusCode).toBe(400);
  });

  test("неизвестный отдел — 404", async () => {
    const adm = await login(app, "admin");
    const fake = "00000000-0000-0000-0000-000000000000";
    expect((await g(membersUrl(fake), adm)).statusCode).toBe(404);
    expect((await put(membersUrl(fake, fx.users.outsider), adm)).statusCode).toBe(404);
  });

  test("уже помеченный вручную из другого отдела не мешает — состав по department_id", async () => {
    const adm = await login(app, "admin");
    const uid = fx.users.outsider;
    await addDeptMember(fx.depts.d1, uid);

    const listD2 = JSON.parse((await g(membersUrl(fx.depts.d2), adm)).body);
    expect(listD2.map((m: { userId: string }) => m.userId)).not.toContain(uid);
    const listD1 = JSON.parse((await g(membersUrl(fx.depts.d1), adm)).body);
    expect(listD1.map((m: { userId: string }) => m.userId)).toContain(uid);
  });
});
