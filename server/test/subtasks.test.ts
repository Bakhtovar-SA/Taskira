/** Подзадачи (issues.parent_id, миграция 021) — строго два уровня, без
 *  произвольной вложенности. Список подзадач родителя не отдельный
 *  эндпоинт — клиент фильтрует уже загруженный список задач по parentId. */
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

const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const issuesUrl = () => `/api/projects/${p1()}/issues`;

async function createIssue(token: string, over: Record<string, unknown> = {}): Promise<{ id: string; parentId: string | null }> {
  const r = await post(issuesUrl(), token, newIssue(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("подзадачи", () => {
  test("создание с parentId — видно в ответе и в GET списка", async () => {
    const mgr = await login(app, "mgr1");
    const parent = await createIssue(mgr, { title: "родитель" });
    const child = await createIssue(mgr, { title: "подзадача", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);

    const list = JSON.parse((await g(issuesUrl(), mgr)).body);
    const found = list.items.find((i: { id: string }) => i.id === child.id);
    expect(found.parentId).toBe(parent.id);
  });

  test("PATCH назначает и снимает parentId", async () => {
    const mgr = await login(app, "mgr1");
    const parent = await createIssue(mgr, { title: "родитель" });
    const child = await createIssue(mgr, { title: "будущая подзадача" });

    const r1 = await patch(`${issuesUrl()}/${child.id}`, mgr, { parentId: parent.id });
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).parentId).toBe(parent.id);

    const r2 = await patch(`${issuesUrl()}/${child.id}`, mgr, { parentId: null });
    expect(r2.statusCode).toBe(200);
    expect(JSON.parse(r2.body).parentId).toBeNull();
  });

  test("задача не может быть подзадачей самой себя — 400", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(mgr, { title: "x" });
    expect((await patch(`${issuesUrl()}/${issue.id}`, mgr, { parentId: issue.id })).statusCode).toBe(400);
  });

  test("нельзя сделать подзадачу подзадачей (глубина > 1) — 400", async () => {
    const mgr = await login(app, "mgr1");
    const grandparent = await createIssue(mgr, { title: "дед" });
    const parent = await createIssue(mgr, { title: "родитель", parentId: grandparent.id });
    const child = await createIssue(mgr, { title: "внук" });
    // parent уже сам подзадача (parent_id = grandparent) — child не может стать его подзадачей
    expect((await patch(`${issuesUrl()}/${child.id}`, mgr, { parentId: parent.id })).statusCode).toBe(400);
    // то же в POST
    expect((await post(issuesUrl(), mgr, newIssue({ title: "внук2", parentId: parent.id }))).statusCode).toBe(400);
  });

  test("у задачи уже есть подзадачи — её нельзя сделать чужой подзадачей — 400", async () => {
    const mgr = await login(app, "mgr1");
    const parent = await createIssue(mgr, { title: "родитель" });
    await createIssue(mgr, { title: "подзадача", parentId: parent.id });
    const other = await createIssue(mgr, { title: "другой родитель" });

    expect((await patch(`${issuesUrl()}/${parent.id}`, mgr, { parentId: other.id })).statusCode).toBe(400);
  });

  test("parentId вне проекта — 404", async () => {
    const mgr = await login(app, "mgr1");
    expect(
      (await post(issuesUrl(), mgr, newIssue({ title: "x", parentId: fx.issues.p2issue }))).statusCode,
    ).toBe(404);
  });

  test("удаление родителя не уносит подзадачу (ON DELETE SET NULL)", async () => {
    const mgr = await login(app, "mgr1");
    const admin = await login(app, "admin");
    const parent = await createIssue(mgr, { title: "родитель" });
    const child = await createIssue(mgr, { title: "подзадача", parentId: parent.id });

    const del = await app.inject({ method: "DELETE", url: `${issuesUrl()}/${parent.id}`, headers: auth(admin) });
    expect(del.statusCode).toBe(204);

    const detail = JSON.parse((await g(`${issuesUrl()}/${child.id}`, mgr)).body);
    expect(detail.parentId).toBeNull();
  });
});
