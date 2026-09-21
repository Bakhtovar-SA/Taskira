/** PERF-06, серверный PR: узкие точки доступа для карточки, Timeline и
 *  справочника направлений вместо обхода всех задач проекта на клиенте.
 *   - parentId / epicId — параметры существующего GET …/issues (пагинация,
 *     сортировка и права те же);
 *   - GET …/issues/epics — направления с агрегатом по активным детям;
 *   - epicChildrenCount в детальном DTO GET …/issues/:id.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
let adm: string;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  adm = await login(app, "admin");
});

const base = (project = fx.projects.p1) => `/api/projects/${project}/issues`;
const g = async (url: string) => {
  const res = await app.inject({ url, headers: auth(adm) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const create = async (over: Record<string, unknown>, project = fx.projects.p1) => {
  const res = await app.inject({ method: "POST", url: base(project), headers: auth(adm), payload: newIssue(over) as never });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body) as { id: string; key: string; title: string };
};
const sidOf = async (sid: string, project = fx.projects.p1) =>
  (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = $2`, [project, sid]))[0].id;
const archive = (id: string) => q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [id]);
const titles = (body: { items: { title: string }[] }) => body.items.map((i) => i.title).sort();

describe.each([
  ["parentId", "parentId"],
  ["epicId", "epicId"],
] as const)("фильтр %s в GET …/issues", (param, field) => {
  test("возвращает только детей этой задачи; архивные скрыты, archived=all их возвращает", async () => {
    const owner = await create({ title: "владелец" });
    const other = await create({ title: "другой владелец" });
    await create({ title: "ребёнок 1", [field]: owner.id });
    await create({ title: "ребёнок 2", [field]: owner.id });
    const gone = await create({ title: "архивный ребёнок", [field]: owner.id });
    await create({ title: "чужой ребёнок", [field]: other.id });
    await create({ title: "без владельца" });
    await archive(gone.id);

    const res = await g(`${base()}?${param}=${owner.id}&limit=200`);
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(["ребёнок 1", "ребёнок 2"]);
    expect(titles((await g(`${base()}?${param}=${owner.id}&archived=all&limit=200`)).body)).toEqual([
      "архивный ребёнок",
      "ребёнок 1",
      "ребёнок 2",
    ]);
  });

  test("работает с пагинацией и сортировкой, счётчик считает тот же набор", async () => {
    const owner = await create({ title: "владелец" });
    for (const t of ["a", "b", "c", "d", "e"]) await create({ title: t, [field]: owner.id });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await g(`${base()}?${param}=${owner.id}&sort=key&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(page.status).toBe(200);
      seen.push(...page.body.items.map((x: { title: string }) => x.title));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);

    const counts = await g(`${base()}/counts?${param}=${owner.id}`);
    expect(counts.body.total).toBe(5);
  });

  test("комбинируется с другими фильтрами (статус)", async () => {
    const owner = await create({ title: "владелец" });
    const done = await create({ title: "закрытый", [field]: owner.id });
    await create({ title: "открытый", [field]: owner.id });
    await q(`UPDATE issues SET status_id = $2, done_at = now() WHERE id = $1`, [done.id, await sidOf("done")]);
    expect(titles((await g(`${base()}?${param}=${owner.id}&closed=hide`)).body)).toEqual(["открытый"]);
    expect(titles((await g(`${base()}?${param}=${owner.id}&status=${await sidOf("done")}`)).body)).toEqual(["закрытый"]);
  });

  test("не uuid — 400; задача другого проекта ничего не возвращает", async () => {
    expect((await g(`${base()}?${param}=not-a-uuid`)).status).toBe(400);
    const foreign = await create({ title: "чужой проект" }, fx.projects.p2);
    expect((await g(`${base()}?${param}=${foreign.id}`)).body.items).toEqual([]);
  });
});

describe("GET …/issues/epics", () => {
  test("направления с агрегатом по активным детям: total, done по категории статуса; архивные и «не эпики» не попадают", async () => {
    const e1 = await create({ title: "эпик 1" });
    const e2 = await create({ title: "эпик 2" });
    const lonely = await create({ title: "обычная задача" });
    const c1 = await create({ title: "c1", epicId: e1.id });
    await create({ title: "c2", epicId: e1.id });
    const c3 = await create({ title: "c3", epicId: e1.id });
    await create({ title: "c4", epicId: e2.id });
    await q(`UPDATE issues SET status_id = $2, done_at = now() WHERE id = $1`, [c1.id, await sidOf("done")]);
    await archive(c3.id); // архивный ребёнок не считается
    await q(`UPDATE issues SET color = '#ff0000', t_start = 4, t_span = 6 WHERE id = $1`, [e1.id]);

    const res = await g(`${base()}/epics`);
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    const byTitle = Object.fromEntries(res.body.items.map((i: { title: string }) => [i.title, i]));
    expect(Object.keys(byTitle).sort()).toEqual(["эпик 1", "эпик 2"]);
    expect(byTitle["эпик 1"]).toMatchObject({
      id: e1.id,
      key: e1.key,
      color: "#ff0000",
      tStart: 4,
      tSpan: 6,
      childTotal: 2,
      childDone: 1,
    });
    expect(byTitle["эпик 2"]).toMatchObject({ childTotal: 1, childDone: 0 });
    expect(byTitle["обычная задача"]).toBeUndefined();
    void lonely;
  });

  test("порядок — по rank, как в списке задач", async () => {
    const epics = [await create({ title: "A" }), await create({ title: "B" }), await create({ title: "C" })];
    for (const e of epics) await create({ title: `дитя ${e.title}`, epicId: e.id });
    const listOrder = (await g(`${base()}?limit=200`)).body.items
      .map((i: { id: string }) => i.id)
      .filter((id: string) => epics.some((e) => e.id === id));
    const res = await g(`${base()}/epics`);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(listOrder);
  });

  test("архивное направление не возвращается, даже если у него есть дети", async () => {
    const e = await create({ title: "архивный эпик" });
    await create({ title: "дитя", epicId: e.id });
    await archive(e.id);
    expect((await g(`${base()}/epics`)).body.items).toEqual([]);
  });

  test("limit и truncated; направления другого проекта не видны", async () => {
    for (const t of ["A", "B"]) {
      const e = await create({ title: `эпик ${t}` });
      await create({ title: `дитя ${t}`, epicId: e.id });
    }
    const foreign = await create({ title: "чужой эпик" }, fx.projects.p2);
    await create({ title: "чужое дитя", epicId: foreign.id }, fx.projects.p2);

    const one = await g(`${base()}/epics?limit=1`);
    expect(one.body.items).toHaveLength(1);
    expect(one.body.truncated).toBe(true);
    const all = await g(`${base()}/epics`);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.truncated).toBe(false);
    expect(all.body.items.map((i: { title: string }) => i.title)).not.toContain("чужой эпик");
    expect((await g(`${base()}/epics?limit=0`)).status).toBe(400);
    expect((await g(`${base()}/epics?limit=501`)).status).toBe(400);
  });

  test("нужно право browse", async () => {
    const outsider = await login(app, "outsider");
    const res = await app.inject({ url: `${base()}/epics`, headers: auth(outsider) });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe("epicChildrenCount в GET …/issues/:id", () => {
  test("число активных детей; 0 у обычной задачи; архивные не считаются", async () => {
    const epic = await create({ title: "направление" });
    const plain = await create({ title: "обычная" });
    const a = await create({ title: "a", epicId: epic.id });
    await create({ title: "b", epicId: epic.id });

    const detail = async (id: string) => (await g(`${base()}/${id}`)).body;
    expect((await detail(epic.id)).epicChildrenCount).toBe(2);
    expect((await detail(plain.id)).epicChildrenCount).toBe(0);
    await archive(a.id);
    expect((await detail(epic.id)).epicChildrenCount).toBe(1);
  });

  test("подзадачи (parentId) не делают задачу «направлением»", async () => {
    const parent = await create({ title: "родитель" });
    await create({ title: "подзадача", parentId: parent.id });
    const detail = (await g(`${base()}/${parent.id}`)).body;
    expect(detail.epicChildrenCount).toBe(0);
    expect(detail.subtasksSummary.total).toBe(1);
  });

  test("в списке задач поля нет (только в детальном ответе)", async () => {
    const res = await g(`${base()}?limit=5`);
    expect(res.body.items[0]).not.toHaveProperty("epicChildrenCount");
  });
});
