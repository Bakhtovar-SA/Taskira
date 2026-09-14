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

  test("невалидный parentId — не сжигает номер CORP-N (проверка до nextIssueNum, ревью PR #46)", async () => {
    const mgr = await login(app, "mgr1");
    const before = JSON.parse((await post(issuesUrl(), mgr, newIssue({ title: "до" }))).body) as { key: string };
    const numBefore = Number(before.key.split("-")[1]);

    const bad = await post(issuesUrl(), mgr, newIssue({ title: "плохой parentId", parentId: fx.issues.p2issue }));
    expect(bad.statusCode).toBe(404);

    const after = JSON.parse((await post(issuesUrl(), mgr, newIssue({ title: "после" }))).body) as { key: string };
    const numAfter = Number(after.key.split("-")[1]);
    expect(numAfter).toBe(numBefore + 1);
  });

  test("гонка: два конкурентных PATCH не могут вместе создать вложенность в 3 уровня", async () => {
    // Ревью PR #46: C1->P и параллельно P->P2 — каждый PATCH сам по себе валиден
    // (родитель top-level на момент своей проверки), но вместе дают P2->P->C1.
    // assignParentLocked лочит обе задачи, вовлечённые в каждый вызов (P — общая
    // для обоих), так что один из двух обязан увидеть уже изменённое состояние
    // второго и провалиться с 400 — Postgres сериализует их через advisory-лок,
    // гонка тут детерминированно воспроизводима, без polling/retry.
    const mgr = await login(app, "mgr1");
    const p = await createIssue(mgr, { title: "P" });
    const c1 = await createIssue(mgr, { title: "C1" });
    const p2 = await createIssue(mgr, { title: "P2" });

    const [r1, r2] = await Promise.all([
      patch(`${issuesUrl()}/${c1.id}`, mgr, { parentId: p.id }),
      patch(`${issuesUrl()}/${p.id}`, mgr, { parentId: p2.id }),
    ]);

    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 400]);

    const finalP = JSON.parse((await g(`${issuesUrl()}/${p.id}`, mgr)).body);
    const finalC1 = JSON.parse((await g(`${issuesUrl()}/${c1.id}`, mgr)).body);
    if (r1.statusCode === 200) {
      expect(finalC1.parentId).toBe(p.id);
      expect(finalP.parentId).toBeNull();
    } else {
      expect(finalP.parentId).toBe(p2.id);
      expect(finalC1.parentId).toBeNull();
    }
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
