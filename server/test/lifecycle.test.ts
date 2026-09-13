/** Жизненный цикл задачи (миграция 016): done_at, архив, автообслуживание.
 *
 *  Проверяем ровно то, на чём стоит вся отчётность и на чём держится
 *  нерастущий активный набор проекта.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { runMaintenanceOnce } from "../src/services/maintenance.js";

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
const post = (url: string, token: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload: payload as never });

const statusId = async (pid: string, sid: string) =>
  (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = $2`, [pid, sid]))[0].id;

const doneAtOf = async (issueId: string) =>
  (await q<{ done_at: Date | null }>(`SELECT done_at FROM issues WHERE id = $1`, [issueId]))[0].done_at;

const archivedAtOf = async (issueId: string) =>
  (await q<{ archived_at: Date | null }>(`SELECT archived_at FROM issues WHERE id = $1`, [issueId]))[0].archived_at;

/** Перенос задачи в статус по его sid через API (проверяет и workflow). */
const moveTo = async (token: string, sid: string, issueId = fx.issues.p1issue) => {
  const to = await statusId(fx.projects.p1, sid);
  return post(`/api/projects/${fx.projects.p1}/issues/${issueId}/transition`, token, { to });
};

describe("done_at", () => {
  test("проставляется при переходе в категорию done", async () => {
    const adm = await login(app, "admin");
    expect(await doneAtOf(fx.issues.p1issue)).toBeNull();
    const res = await moveTo(adm, "done");
    expect(res.statusCode).toBe(200);
    expect(await doneAtOf(fx.issues.p1issue)).not.toBeNull();
    expect(JSON.parse(res.body).doneAt).toBeTruthy();
  });

  test("снимается при возврате задачи в работу", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    expect(await doneAtOf(fx.issues.p1issue)).not.toBeNull();
    // done -> inprogress есть в дефолтной схеме переходов
    const res = await moveTo(adm, "inprogress");
    expect(res.statusCode).toBe(200);
    expect(await doneAtOf(fx.issues.p1issue)).toBeNull();
    expect(JSON.parse(res.body).doneAt).toBeNull();
  });

  test("переоткрытая и снова закрытая задача получает НОВУЮ дату закрытия", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    const first = await doneAtOf(fx.issues.p1issue);
    await moveTo(adm, "inprogress");
    await moveTo(adm, "done");
    const second = await doneAtOf(fx.issues.p1issue);
    expect(second).not.toBeNull();
    expect(new Date(second!).getTime()).toBeGreaterThanOrEqual(new Date(first!).getTime());
  });
});

describe("архив", () => {
  test("автоархив забирает закрытые старше ARCHIVE_AFTER_DAYS и не трогает свежие", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    // Свежая закрытая задача архивации не подлежит.
    expect((await runMaintenanceOnce()).archived).toBe(0);
    expect(await archivedAtOf(fx.issues.p1issue)).toBeNull();

    // Отматываем дату закрытия на 40 дней назад (порог по умолчанию — 30).
    await q(`UPDATE issues SET done_at = now() - interval '40 days' WHERE id = $1`, [fx.issues.p1issue]);
    expect((await runMaintenanceOnce()).archived).toBe(1);
    expect(await archivedAtOf(fx.issues.p1issue)).not.toBeNull();
  });

  test("открытая задача не архивируется, даже если она очень старая", async () => {
    await q(`UPDATE issues SET created_at = now() - interval '400 days' WHERE id = $1`, [fx.issues.p1issue]);
    expect((await runMaintenanceOnce()).archived).toBe(0);
  });

  test("архивные исчезают из списка задач, но доступны по ?archived", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    await q(`UPDATE issues SET done_at = now() - interval '40 days' WHERE id = $1`, [fx.issues.p1issue]);
    await runMaintenanceOnce();

    const keys = (url: string) => g(url, adm).then((r) => JSON.parse(r.body).items.map((i: { key: string }) => i.key));
    const base = `/api/projects/${fx.projects.p1}/issues`;
    expect(await keys(base)).toEqual([]); // активный набор пуст
    expect(await keys(`${base}?archived=1`)).toEqual(["CORP-1"]);
    expect(await keys(`${base}?archived=all`)).toEqual(["CORP-1"]);
  });

  test("возврат в работу автоматически выводит задачу из архива", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    await q(`UPDATE issues SET done_at = now() - interval '40 days' WHERE id = $1`, [fx.issues.p1issue]);
    await runMaintenanceOnce();
    expect(await archivedAtOf(fx.issues.p1issue)).not.toBeNull();

    await moveTo(adm, "inprogress");
    expect(await archivedAtOf(fx.issues.p1issue)).toBeNull();
    const res = await g(`/api/projects/${fx.projects.p1}/issues`, adm);
    expect(JSON.parse(res.body).items.map((i: { key: string }) => i.key)).toEqual(["CORP-1"]);
  });

  test("архив — не удаление: задача открывается по прямой ссылке", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    await q(`UPDATE issues SET done_at = now() - interval '40 days' WHERE id = $1`, [fx.issues.p1issue]);
    await runMaintenanceOnce();
    const res = await g(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`, adm);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).key).toBe("CORP-1");
  });
});

describe("порядок новых задач", () => {
  test("новая задача встаёт В НАЧАЛО колонки, а не в конец", async () => {
    const adm = await login(app, "admin");
    const base = `/api/projects/${fx.projects.p1}/issues`;
    const todo = await statusId(fx.projects.p1, "todo");

    const a = JSON.parse((await post(base, adm, newIssue({ title: "первая", statusId: todo }))).body);
    const b = JSON.parse((await post(base, adm, newIssue({ title: "вторая", statusId: todo }))).body);

    const order = JSON.parse((await g(`${base}?status=${todo}`, adm)).body).items.map((i: { key: string }) => i.key);
    // Самая свежая — первой, фикстурная CORP-1 — последней.
    expect(order).toEqual([b.key, a.key, "CORP-1"]);
  });
});

describe("история задачи", () => {
  test("GET /activity отдаёт записи, которые пишет logActivity", async () => {
    const adm = await login(app, "admin");
    await moveTo(adm, "done");
    const res = await g(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/activity`, adm);
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1).text).toContain("переместил");
    expect(rows.at(-1).actor.name).toBe("Admin");
  });

  test("история недоступна тому, кто не видит задачу", async () => {
    const out = await login(app, "outsider");
    const res = await g(`/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/activity`, out);
    expect(res.statusCode).toBe(403);
  });
});

describe("отзыв токена при выходе (SEC-01)", () => {
  test("после выхода прежний токен перестаёт работать", async () => {
    const t = await login(app, "emp1");
    const url = `/api/projects/${fx.projects.p1}/issues`;
    expect((await g(url, t)).statusCode).toBe(200);

    expect((await post("/api/auth/logout", t)).statusCode).toBe(204);

    const after = await g(url, t);
    expect(after.statusCode).toBe(401);
    expect(JSON.parse(after.body).error.reason).toContain("Сессия завершена");
  });

  test("повторный вход выдаёт рабочий токен", async () => {
    const first = await login(app, "emp1");
    await post("/api/auth/logout", first);
    const second = await login(app, "emp1");
    expect((await g(`/api/projects/${fx.projects.p1}/issues`, second)).statusCode).toBe(200);
  });

  test("выход одного пользователя не трогает сессии других", async () => {
    const emp = await login(app, "emp1");
    const adm = await login(app, "admin");
    await post("/api/auth/logout", emp);
    expect((await g(`/api/projects/${fx.projects.p1}/issues`, adm)).statusCode).toBe(200);
  });
});
