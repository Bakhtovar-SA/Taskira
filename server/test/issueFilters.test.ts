/** PERF-05, шаг 1: фильтры, сортировка и счётчики списка задач — на сервере.
 *
 *  Клиент перестаёт держать весь набор в памяти, поэтому всё, что раньше делал
 *  `data.issues.filter(...)`, обязано работать поверх пагинации: фильтр находит
 *  задачу за пределами первой страницы, а сортировка листается курсором без
 *  потерь и дублей.
 */
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { SORT_EXPR } from "../src/services/issueFilters.js";
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

const base = () => `/api/projects/${fx.projects.p1}/issues`;
const g = async (url: string) => {
  const res = await app.inject({ url, headers: auth(adm) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const create = async (over: Record<string, unknown>) => {
  const res = await app.inject({ method: "POST", url: base(), headers: auth(adm), payload: newIssue(over) as never });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body) as { id: string; key: string; title: string };
};
const sidOf = async (sid: string) =>
  (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = $2`, [fx.projects.p1, sid]))[0].id;

/** Листает весь набор страницами по `limit`, возвращает заголовки в порядке выдачи. */
async function walk(query: string, limit = 2): Promise<string[]> {
  const titles: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await g(`${base()}?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(page.status).toBe(200);
    titles.push(...page.body.items.map((i: { title: string }) => i.title));
    cursor = page.body.nextCursor;
    if (!cursor) return titles;
  }
  throw new Error("cursor walk did not terminate");
}

describe("фильтры на сервере", () => {
  test("фильтр по исполнителю находит задачу за пределами первой страницы", async () => {
    const target = await create({ title: "цель", assigneeIds: [fx.users.mgr1] });
    for (let i = 0; i < 5; i++) await create({ title: `шум ${i}` });
    // Первая страница (limit=2) цели не содержит — прежний клиентский фильтр
    // по загруженному набору её бы не нашёл.
    const firstPage = await g(`${base()}?limit=2`);
    expect(firstPage.body.items.map((i: { id: string }) => i.id)).not.toContain(target.id);

    const res = await g(`${base()}?assignee=${fx.users.mgr1}&limit=2`);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([target.id]);
    expect(res.body.hasMore).toBe(false);
  });

  test("assignee=none — только задачи без исполнителей", async () => {
    await create({ title: "занята", assigneeIds: [fx.users.mgr1, fx.users.emp1] });
    await create({ title: "свободна" });
    const res = await g(`${base()}?assignee=none`);
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(["свободна"]);
  });

  // ТЗ 3.2 (план v2 Трек 3): фильтры условий сохранённых вьюх — priority/label/sprintId.
  test("priority — точное совпадение", async () => {
    await create({ title: "low", priorityId: "low" });
    const crit = await create({ title: "crit", priorityId: "critical" });
    await create({ title: "med", priorityId: "medium" });
    const res = await g(`${base()}?priority=critical`);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([crit.id]);
  });

  test("label — точное совпадение одной метки среди нескольких на задаче", async () => {
    const tagged = await create({ title: "с меткой", labels: ["frontend", "urgent"] });
    await create({ title: "без метки" });
    await create({ title: "другая метка", labels: ["backend"] });
    const res = await g(`${base()}?label=urgent`);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([tagged.id]);
  });

  test("sprintId — фильтрует по спринту; молча игнорируется, если модуль спринтов выключен", async () => {
    await q(`UPDATE projects SET sprints_enabled = true WHERE id = $1`, [fx.projects.p1]);
    const sprintRes = await app.inject({
      method: "POST",
      url: `${base().replace("/issues", "")}/sprints`,
      headers: auth(adm),
      payload: { name: "Sprint 1", goal: "" },
    });
    expect(sprintRes.statusCode).toBe(201);
    const sprint = JSON.parse(sprintRes.body);
    const inSprint = await create({ title: "в спринте" });
    await create({ title: "не в спринте" });
    const assign = await app.inject({
      method: "PATCH",
      url: `${base()}/${inSprint.id}/sprint`,
      headers: auth(adm),
      payload: { sprintId: sprint.id },
    });
    expect(assign.statusCode).toBe(200);

    const filtered = await g(`${base()}?sprintId=${sprint.id}`);
    expect(filtered.body.items.map((i: { id: string }) => i.id)).toEqual([inSprint.id]);

    // Выключаем модуль через настоящий PATCH (не raw SQL) — projectById() кэширует
    // проект на 30с (services/project.ts), и только PATCH /api/projects/:id зовёт
    // invalidateProjectCache(); прямой UPDATE оставил бы кэш с прежним sprints_enabled
    // и тест ловил бы устаревшее значение, а не проверял реальное поведение фильтра.
    const off = await app.inject({
      method: "PATCH",
      url: `/api/projects/${fx.projects.p1}`,
      headers: auth(adm),
      payload: { sprintsEnabled: false },
    });
    expect(off.statusCode).toBe(200);
    const ignored = await g(`${base()}?sprintId=${sprint.id}`);
    expect(ignored.status).toBe(200);
    expect(ignored.body.items.length).toBeGreaterThanOrEqual(2); // фильтр проигнорирован, вернулись обе
  });

  test("closed: hide / recent / older", async () => {
    const done = await sidOf("done");
    const fresh = await create({ title: "свежая" });
    const old = await create({ title: "давняя" });
    const legacy = await create({ title: "без done_at" });
    const open = await create({ title: "открытая" });
    await q(`UPDATE issues SET status_id = $2, done_at = now() WHERE id = $1`, [fresh.id, done]);
    await q(`UPDATE issues SET status_id = $2, done_at = now() - interval '40 days' WHERE id = $1`, [old.id, done]);
    await q(`UPDATE issues SET status_id = $2, done_at = NULL WHERE id = $1`, [legacy.id, done]);

    const titles = async (qs: string) => (await g(`${base()}?${qs}`)).body.items.map((i: { title: string }) => i.title).sort();
    expect(await titles("closed=hide")).not.toEqual(expect.arrayContaining(["свежая"]));
    expect(await titles("closed=hide")).toContain("открытая");
    // Без done_at — считаются свежими, как в прежнем клиентском окне доски.
    expect(await titles("closed=recent&closedDays=14")).toEqual(expect.arrayContaining(["свежая", "без done_at", "открытая"]));
    expect(await titles("closed=recent&closedDays=14")).not.toContain("давняя");
    expect(await titles("closed=older&closedDays=14")).toEqual(["давняя"]);
    void open;
  });
});

describe("сортировка курсором", () => {
  test("priority: страницы по 2 совпадают с полной выдачей, тай-брейк — номер в направлении сортировки", async () => {
    await create({ title: "low-1", priorityId: "low" });
    await create({ title: "crit-1", priorityId: "critical" });
    await create({ title: "med-1", priorityId: "medium" });
    await create({ title: "crit-2", priorityId: "critical" });
    await create({ title: "high-1", priorityId: "high" });
    const seeded = await g(`${base()}?limit=200`);
    const seededTitles = seeded.body.items.map((i: { title: string }) => i.title); // включает задачу фикстуры

    const expected = ["crit-1", "crit-2", "high-1", "med-1"];
    const asc = await walk("sort=priority&dir=asc", 2);
    expect(asc.filter((t) => expected.includes(t) || t === "low-1")).toEqual([...expected, "low-1"].filter((t) => asc.includes(t)));
    expect(new Set(asc).size).toBe(asc.length);
    expect(asc.length).toBe(seededTitles.length);

    const desc = await walk("sort=priority&dir=desc", 2);
    expect(desc.indexOf("low-1")).toBeLessThan(desc.indexOf("crit-1"));
    // тай-брейк зеркален направлению: в desc при равном приоритете номера убывают
    expect(desc.indexOf("crit-2")).toBeLessThan(desc.indexOf("crit-1"));
    expect(desc.length).toBe(asc.length);
  });

  test("due: задачи без срока в конце, страницы без потерь и дублей", async () => {
    await create({ title: "без срока" });
    await create({ title: "поздно", dueDate: "2030-01-10" });
    await create({ title: "рано", dueDate: "2030-01-02" });
    await create({ title: "тот же день", dueDate: "2030-01-02" });
    const order = await walk("sort=due&dir=asc", 1);
    expect(order.indexOf("рано")).toBeLessThan(order.indexOf("тот же день"));
    expect(order.indexOf("тот же день")).toBeLessThan(order.indexOf("поздно"));
    expect(order.indexOf("поздно")).toBeLessThan(order.indexOf("без срока"));
    expect(new Set(order).size).toBe(order.length);
  });

  test("updated desc и key: полный обход равен выдаче одной страницей", async () => {
    for (const t of ["a", "b", "c", "d", "e"]) await create({ title: t });
    for (const sort of ["updated", "key"]) {
      for (const dir of ["asc", "desc"]) {
        const paged = await walk(`sort=${sort}&dir=${dir}`, 2);
        const whole = (await g(`${base()}?sort=${sort}&dir=${dir}&limit=200`)).body.items.map((i: { title: string }) => i.title);
        expect(paged).toEqual(whole);
      }
    }
    const byKey = (await g(`${base()}?sort=key&dir=asc&limit=200`)).body.items.map((i: { key: string }) => Number(i.key.split("-")[1]));
    expect(byKey).toEqual([...byKey].sort((x, y) => x - y));
  });

  test("курсор одной сортировки не подходит другой, а rank-курсор — сортировке", async () => {
    for (const t of ["a", "b", "c"]) await create({ title: t });
    const byPriority = await g(`${base()}?sort=priority&limit=1`);
    const byRank = await g(`${base()}?limit=1`);
    const enc = encodeURIComponent;
    expect((await g(`${base()}?sort=key&limit=1&cursor=${enc(byPriority.body.nextCursor)}`)).status).toBe(400);
    expect((await g(`${base()}?sort=priority&dir=desc&limit=1&cursor=${enc(byPriority.body.nextCursor)}`)).status).toBe(400);
    expect((await g(`${base()}?sort=priority&limit=1&cursor=${enc(byRank.body.nextCursor)}`)).status).toBe(400);
    expect((await g(`${base()}?limit=1&cursor=${enc(byPriority.body.nextCursor)}`)).status).toBe(400);
  });
});

describe("счётчики", () => {
  test("считают тот же набор, что и список, и не считают архивные", async () => {
    const done = await sidOf("done");
    const a = await create({ title: "a", assigneeIds: [fx.users.mgr1] });
    await create({ title: "b" });
    const c = await create({ title: "c", assigneeIds: [fx.users.mgr1] });
    await q(`UPDATE issues SET status_id = $2, done_at = now() WHERE id = $1`, [c.id, done]);
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [a.id]);

    const all = await g(`${base()}/counts`);
    expect(all.status).toBe(200);
    const listed = await g(`${base()}?limit=200&includeTotal=1`);
    expect(all.body.total).toBe(listed.body.total);
    expect(Object.values(all.body.byStatus as Record<string, number>).reduce((x, y) => x + y, 0)).toBe(all.body.total);
    expect(all.body.byStatus[done]).toBe(1);

    const mine = await g(`${base()}/counts?assignee=${fx.users.mgr1}`);
    const mineList = await g(`${base()}?assignee=${fx.users.mgr1}&includeTotal=1&limit=1`);
    expect(mine.body.total).toBe(mineList.body.total);
    expect(mine.body.total).toBe(1); // архивная «a» не учитывается

    const none = await g(`${base()}/counts?assignee=none&closed=hide`);
    expect(none.body.total).toBeGreaterThanOrEqual(1);
  });

  test("нужно право browse", async () => {
    const outsider = await login(app, "outsider");
    const res = await app.inject({ url: `${base()}/counts`, headers: auth(outsider) });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe("индексы сортировок", () => {
  // SORT_EXPR и выражения в миграциях 20260920T140x пишутся руками в двух
  // местах. Если разойдутся, запрос продолжит работать, но перестанет
  // использовать индекс: тихая деградация 3 мс → 90 мс на большом проекте.
  test.each([
    ["priority", "idx_issues_active_sort_priority"],
    ["due", "idx_issues_active_sort_due"],
    ["updated", "idx_issues_active_sort_updated"],
  ] as const)("ORDER BY %s может использовать %s", async (sort, index) => {
    const expr = SORT_EXPR[sort];
    const plan = await withTransaction(async (client) => {
      // На крошечной фикстуре планировщик и без индекса выберет seq scan+sort;
      // запрещаем их, чтобы проверить именно возможность использовать индекс.
      await client.query("SET LOCAL enable_seqscan = off");
      await client.query("SET LOCAL enable_sort = off");
      const res = await client.query(
        `EXPLAIN SELECT i.id FROM issues i WHERE i.project_id = $1 AND i.archived_at IS NULL
          ORDER BY ${expr}, i.num LIMIT 10`,
        [fx.projects.p1],
      );
      return res.rows.map((r) => r["QUERY PLAN"] as string).join("\n");
    });
    expect(plan).toContain(index);
  });
});

describe("has_assignee (assignee=none)", () => {
  const drift = async () =>
    Number(
      (
        await q<{ n: string }>(
          `SELECT count(*)::text AS n FROM issues i
            WHERE i.has_assignee <> EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = i.id)`,
        )
      )[0].n,
    );
  const flag = async (id: string) => (await q<{ f: boolean }>(`SELECT has_assignee AS f FROM issues WHERE id = $1`, [id]))[0].f;
  const patch = (id: string, payload: unknown) =>
    app.inject({ method: "PATCH", url: `${base()}/${id}`, headers: auth(adm), payload: payload as never });

  test("триггер держит флаг верным при любом пути записи", async () => {
    const issue = await create({ title: "флаг" });
    expect(await flag(issue.id)).toBe(false);

    expect((await patch(issue.id, { assigneeIds: [fx.users.mgr1, fx.users.emp1] })).statusCode).toBe(200);
    expect(await flag(issue.id)).toBe(true);

    // PATCH заменяет список целиком: DELETE + INSERT — итог должен остаться true
    expect((await patch(issue.id, { assigneeIds: [fx.users.emp1] })).statusCode).toBe(200);
    expect(await flag(issue.id)).toBe(true);

    expect((await patch(issue.id, { assigneeIds: [] })).statusCode).toBe(200);
    expect(await flag(issue.id)).toBe(false);

    // прямой SQL (импорт, ручная правка): один из двух исполнителей уходит — флаг остаётся
    await q(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2), ($1, $3)`, [issue.id, fx.users.mgr1, fx.users.emp1]);
    expect(await flag(issue.id)).toBe(true);
    await q(`DELETE FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [issue.id, fx.users.mgr1]);
    expect(await flag(issue.id)).toBe(true);
    await q(`DELETE FROM issue_assignees WHERE issue_id = $1`, [issue.id]);
    expect(await flag(issue.id)).toBe(false);
    expect(await drift()).toBe(0);
  });

  test("assignee=none и его счётчик согласованы с фактическими исполнителями", async () => {
    await create({ title: "занята", assigneeIds: [fx.users.mgr1] });
    await create({ title: "свободна 1" });
    await create({ title: "свободна 2" });
    const list = await g(`${base()}?assignee=none&limit=200`);
    const titles = list.body.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["свободна 1", "свободна 2"]));
    expect(titles).not.toContain("занята");
    for (const item of list.body.items) expect(item.assigneeIds).toEqual([]);
    const counts = await g(`${base()}/counts?assignee=none`);
    expect(counts.body.total).toBe(list.body.items.length);
    expect(await drift()).toBe(0);
  });

  test("миграция идемпотентна и пересчитывает флаг (backfill)", async () => {
    const issue = await create({ title: "backfill", assigneeIds: [fx.users.mgr1] });
    await q(`UPDATE issues SET has_assignee = false`); // имитируем данные, записанные до миграции
    expect(await drift()).toBeGreaterThan(0);
    const sql = readFileSync(new URL("../migrations/20260920T1410_issue_has_assignee.sql", import.meta.url), "utf8");
    await q(sql);
    expect(await flag(issue.id)).toBe(true);
    expect(await drift()).toBe(0);
  });
});

describe("GET …/issues/assignees", () => {
  test("исполнители активных задач по убыванию нагрузки; архивные и чужие проекты не считаются", async () => {
    const a = await create({ title: "a", assigneeIds: [fx.users.mgr1, fx.users.emp1] });
    await create({ title: "b", assigneeIds: [fx.users.mgr1] });
    await create({ title: "c", assigneeIds: [fx.users.mgr1] });
    const archived = await create({ title: "arch", assigneeIds: [fx.users.emp1] });
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [archived.id]);
    void a;

    const res = await g(`${base()}/assignees`);
    expect(res.status).toBe(200);
    const byUser = Object.fromEntries(res.body.items.map((r: { userId: string; count: number }) => [r.userId, r.count]));
    expect(byUser[fx.users.mgr1]).toBe(3);
    // emp1: задача фикстуры (assignee=emp1) + «a»; архивная «arch» не учитывается
    expect(byUser[fx.users.emp1]).toBe(2);
    expect(res.body.items[0].userId).toBe(fx.users.mgr1);

    expect((await g(`${base()}/assignees?limit=1`)).body.items).toHaveLength(1);
    expect((await g(`${base()}/assignees?limit=0`)).status).toBe(400);
  });

  test("нужно право browse", async () => {
    const outsider = await login(app, "outsider");
    const res = await app.inject({ url: `${base()}/assignees`, headers: auth(outsider) });
    expect([403, 404]).toContain(res.statusCode);
  });
});
