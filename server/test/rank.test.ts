import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { computeRank } from "../src/services/rank.js";
import { getApp, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let fx: Fixture;
let num: number;
beforeAll(getApp);
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); num = 2; });

async function add(rank: number, archived = false) {
  const issueNum = num++;
  return (await q<{ id: string }>(
    `INSERT INTO issues (project_id, num, key, title, type_id, status_id, priority_id, reporter_id, rank, archived_at)
     VALUES ($1, $2::integer, 'CORP-' || $2::integer::text, 'Rank fixture', 'task', $3, 'medium', $4, $5,
             CASE WHEN $6 THEN now() ELSE NULL END) RETURNING id`,
    [fx.projects.p1, issueNum, fx.p1status.todo, fx.users.emp1, rank, archived],
  ))[0].id;
}
const rank = (beforeId: string | null = null, excludeId?: string, statusId = fx.p1status.todo) =>
  withTransaction((client) => computeRank(client, fx.projects.p1, statusId, beforeId, excludeId));

test("начало, середина, конец и пустая колонка сохраняют порядок", async () => {
  await q(`UPDATE issues SET rank = 1000 WHERE id = $1`, [fx.issues.p1issue]);
  const middle = await add(2000);
  await add(3000);
  expect(await rank(fx.issues.p1issue)).toBe(0);
  expect(await rank(middle)).toBe(1500);
  expect(await rank()).toBe(4000);
  expect(await rank(null, undefined, fx.p1status.inprogress)).toBe(1000);
});

test("перемещаемая задача исключается из поиска обоих соседей", async () => {
  await q(`UPDATE issues SET rank = 1000 WHERE id = $1`, [fx.issues.p1issue]);
  const moving = await add(2000);
  const target = await add(3000);
  expect(await rank(target, moving)).toBe(2000);
  expect(await rank(null, target)).toBe(3000);
  expect(await rank(fx.issues.p1issue, fx.issues.p1issue)).toBe(4000);
});

test("удалённый ориентир, другая колонка и другой проект дают вставку в конец", async () => {
  await add(5000);
  const otherColumn = await add(9000);
  await q(`UPDATE issues SET status_id = $2 WHERE id = $1`, [otherColumn, fx.p1status.inprogress]);
  await q(`UPDATE issues SET rank = 100000 WHERE id = $1`, [fx.issues.p2issue]);
  for (const id of [randomUUID(), otherColumn, fx.issues.p2issue]) expect(await rank(id)).toBe(6000);
});

test("архивные ранги продолжают участвовать в порядке", async () => {
  await q(`UPDATE issues SET rank = 1000 WHERE id = $1`, [fx.issues.p1issue]);
  const archived = await add(2000, true);
  const target = await add(3000);
  expect(await rank(target)).toBe(2500);
  expect(await rank(archived)).toBe(1500);
  expect(await rank()).toBe(4000);
});

test("одинаковые ранги используют порядок UUID и вызывают перенумерацию", async () => {
  await q(`UPDATE issues SET rank = 1000 WHERE id = $1`, [fx.issues.p1issue]);
  await add(1000);
  const rows = await q<{ id: string }>(`SELECT id FROM issues WHERE project_id = $1 ORDER BY rank, id`, [fx.projects.p1]);
  expect(await rank(rows[1].id)).toBe(1500);
  expect(await q(`SELECT rank FROM issues WHERE project_id = $1 ORDER BY rank, id`, [fx.projects.p1]))
    .toEqual([{ rank: 1000 }, { rank: 2000 }]);
});

test("слишком маленький зазор перенумеровывается в той же транзакции и откатывается", async () => {
  await q(`UPDATE issues SET rank = 1000 WHERE id = $1`, [fx.issues.p1issue]);
  const target = await add(1000 + 1e-10);
  const before = await q(`SELECT id, rank FROM issues ORDER BY id`);
  await expect(withTransaction(async (client) => {
    expect(await computeRank(client, fx.projects.p1, fx.p1status.todo, target)).toBe(1500);
    throw new Error("rollback rank");
  })).rejects.toThrow("rollback rank");
  expect(await q(`SELECT id, rank FROM issues ORDER BY id`)).toEqual(before);
});
