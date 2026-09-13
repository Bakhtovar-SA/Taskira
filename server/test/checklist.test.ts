/** Чек-лист задачи (checklist_items, миграция 019). Право — то же `edit`,
 *  что у issue_links/полей задачи; отдельной модели прав нет. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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
const checklist = (issueId: string) => `/api/projects/${p1()}/issues/${issueId}/checklist`;
const issueUrl = (issueId: string) => `/api/projects/${p1()}/issues/${issueId}`;

/** Ещё одна задача в P1 (см. issue-links.test.ts). */
async function secondP1Issue(): Promise<string> {
  const mgr = await login(app, "mgr1");
  const res = await post(`/api/projects/${p1()}/issues`, mgr, newIssue({ title: "second" }));
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).id as string;
}

describe("checklist", () => {
  test("manager добавляет пункт — виден и в ответе POST, и в GET /:id", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;

    const r = await post(checklist(issue), mgr, { text: "Проверить логи" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.item.text).toBe("Проверить логи");
    expect(body.item.done).toBe(false);
    expect(body.checklist).toHaveLength(1);

    const detail = JSON.parse((await g(issueUrl(issue), mgr)).body);
    expect(detail.checklist).toHaveLength(1);
    expect(detail.checklist[0].id).toBe(body.item.id);
  });

  test("порядок пунктов — по возрастанию position (порядок добавления)", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    await post(checklist(issue), mgr, { text: "первый" });
    await post(checklist(issue), mgr, { text: "второй" });
    await post(checklist(issue), mgr, { text: "третий" });

    const detail = JSON.parse((await g(issueUrl(issue), mgr)).body);
    expect(detail.checklist.map((i: { text: string }) => i.text)).toEqual(["первый", "второй", "третий"]);
  });

  test("PATCH переключает done и меняет текст", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    const created = JSON.parse((await post(checklist(issue), mgr, { text: "пункт" })).body).item;

    const r1 = await patch(`${checklist(issue)}/${created.id}`, mgr, { done: true });
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).item.done).toBe(true);

    const r2 = await patch(`${checklist(issue)}/${created.id}`, mgr, { text: "новый текст" });
    expect(JSON.parse(r2.body).item.text).toBe("новый текст");
    // done не тронут вторым патчем
    expect(JSON.parse(r2.body).item.done).toBe(true);
  });

  test("PATCH с пустым телом — 400", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    const created = JSON.parse((await post(checklist(issue), mgr, { text: "пункт" })).body).item;
    expect((await patch(`${checklist(issue)}/${created.id}`, mgr, {})).statusCode).toBe(400);
  });

  test("пустой текст — 400", async () => {
    // Раздельно от "только пробелы": oneLine() (contract.ts) проверяет .min()
    // ДО trim-transform, так что whitespace-only строка не 400 нигде в этом
    // контракте (то же верно для title/названия проекта/отдела) — не баг
    // чек-листа, а общее свойство oneLine(), вне рамок этой фичи.
    const mgr = await login(app, "mgr1");
    expect((await post(checklist(fx.issues.p1issue), mgr, { text: "" })).statusCode).toBe(400);
  });

  test("DELETE снимает пункт и возвращает обновлённый список", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    const created = JSON.parse((await post(checklist(issue), mgr, { text: "пункт" })).body).item;

    const r = await del(`${checklist(issue)}/${created.id}`, mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).checklist).toHaveLength(0);
    // повторное удаление — 404
    expect((await del(`${checklist(issue)}/${created.id}`, mgr)).statusCode).toBe(404);
  });

  test("пункт из другой задачи того же проекта — 404 (IDOR-сверка, как у attachments/links)", async () => {
    const mgr = await login(app, "mgr1");
    const created = JSON.parse((await post(checklist(fx.issues.p1issue), mgr, { text: "пункт" })).body).item;
    const other = await secondP1Issue();
    const r = await patch(`${checklist(other)}/${created.id}`, mgr, { done: true });
    expect(r.statusCode).toBe(404);
  });

  test("employee редактирует чек-лист своей задачи; viewer — 403", async () => {
    const emp = await login(app, "emp1"); // reporter+assignee p1issue
    const viw = await login(app, "viw1");
    expect((await post(checklist(fx.issues.p1issue), emp, { text: "своя" })).statusCode).toBe(200);
    expect((await post(checklist(fx.issues.p1issue), viw, { text: "чужая" })).statusCode).toBe(403);
  });

  test("не участник проекта — 403", async () => {
    const out = await login(app, "outsider");
    expect((await post(checklist(fx.issues.p1issue), out, { text: "x" })).statusCode).toBe(403);
  });

  test("лимит пунктов на задачу — 400 после LIMITS.checklistItemsPerIssue", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    for (let i = 0; i < 50; i++) {
      expect((await post(checklist(issue), mgr, { text: `пункт ${i}` })).statusCode).toBe(200);
    }
    expect((await post(checklist(issue), mgr, { text: "51-й" })).statusCode).toBe(400);
  });

  test("GET /:id всегда содержит массив checklist", async () => {
    const mgr = await login(app, "mgr1");
    const detail = JSON.parse((await g(issueUrl(fx.issues.p1issue), mgr)).body);
    expect(Array.isArray(detail.checklist)).toBe(true);
  });
});
