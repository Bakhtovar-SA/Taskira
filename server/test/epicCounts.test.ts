/** EPIC-01: счётчики детей направлений (issues.epic_child_total/done) поддерживаются триггерами при любом пути записи.
 *  Каждый тест делает изменение и сверяет счётчики ВСЕХ задач с прямым агрегатом — тем самым запросом, который раньше
 *  выполнял GET …/issues/epics. Так ловится и «не пересчитал нужное направление», и «испортил чужое». */
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { withClient } from "../src/db.js";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

const MIGRATION = readFileSync(new URL("../migrations/20260930T0500_epic_child_counts.sql", import.meta.url), "utf8");

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
const create = async (over: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url: base(), headers: auth(adm), payload: newIssue(over) as never });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body) as { id: string };
};
const patch = async (id: string, body: Record<string, unknown>) => {
  const res = await app.inject({ method: "PATCH", url: `${base()}/${id}`, headers: auth(adm), payload: body as never });
  expect(res.statusCode).toBe(200);
};
const sidOf = async (sid: string) =>
  (await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = $2`, [fx.projects.p1, sid]))[0].id;
const counts = async (id: string) =>
  (await q<{ t: number; d: number }>(`SELECT epic_child_total AS t, epic_child_done AS d FROM issues WHERE id = $1`, [id]))[0];

/** Все задачи, у которых сохранённые счётчики расходятся с прямым агрегатом. Пустой массив = всё верно. */
async function drift() {
  return q<{ id: string; stored: string; actual: string }>(
    `SELECT e.id,
            e.epic_child_total || '/' || e.epic_child_done AS stored,
            coalesce(c.total, 0) || '/' || coalesce(c.done, 0) AS actual
       FROM issues e
       LEFT JOIN (
         SELECT ch.epic_id, count(*)::int AS total, (count(*) FILTER (WHERE ws.category = 'done'))::int AS done
           FROM issues ch JOIN workflow_statuses ws ON ws.id = ch.status_id
          WHERE ch.epic_id IS NOT NULL AND ch.archived_at IS NULL
          GROUP BY ch.epic_id
       ) c ON c.epic_id = e.id
      WHERE (e.epic_child_total, e.epic_child_done) IS DISTINCT FROM (coalesce(c.total, 0), coalesce(c.done, 0))`,
  );
}

async function family() {
  const e1 = await create({ title: "эпик 1" });
  const e2 = await create({ title: "эпик 2" });
  const kids = [];
  for (let i = 0; i < 3; i++) kids.push(await create({ title: `ребёнок ${i}`, epicId: e1.id }));
  return { e1, e2, kids };
}

describe("счётчики детей направлений (EPIC-01)", () => {
  test("создание детей через API", async () => {
    const { e1, e2 } = await family();
    expect(await counts(e1.id)).toEqual({ t: 3, d: 0 });
    expect(await counts(e2.id)).toEqual({ t: 0, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("PATCH epicId: перенос в другое направление, снятие и назначение", async () => {
    const { e1, e2, kids } = await family();
    await patch(kids[0].id, { epicId: e2.id });
    expect(await counts(e1.id)).toEqual({ t: 2, d: 0 });
    expect(await counts(e2.id)).toEqual({ t: 1, d: 0 });
    await patch(kids[1].id, { epicId: null });
    expect(await counts(e1.id)).toEqual({ t: 1, d: 0 });
    await patch(kids[1].id, { epicId: e1.id });
    expect(await counts(e1.id)).toEqual({ t: 2, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("переход в «Готово» и обратно через /transition", async () => {
    const { e1, kids } = await family();
    const done = await sidOf("done");
    const move = async (id: string, to: string) => {
      const r = await app.inject({ method: "POST", url: `${base()}/${id}/transition`, headers: auth(adm), payload: { to } });
      expect(r.statusCode).toBe(200);
    };
    await move(kids[0].id, fx.p1status.inprogress);
    await move(kids[0].id, done);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 1 });
    await move(kids[0].id, fx.p1status.inprogress);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("архивация ребёнка (как воркер обслуживания) и возврат из архива", async () => {
    const { e1, kids } = await family();
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [kids[2].id]);
    expect(await counts(e1.id)).toEqual({ t: 2, d: 0 });
    await q(`UPDATE issues SET archived_at = NULL WHERE id = $1`, [kids[2].id]);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("удаление ребёнка через API и удаление самого направления (ON DELETE SET NULL у детей)", async () => {
    const { e1, kids } = await family();
    const del = (id: string) => app.inject({ method: "DELETE", url: `${base()}/${id}`, headers: auth(adm) });
    expect([200, 204]).toContain((await del(kids[0].id)).statusCode);
    expect(await counts(e1.id)).toEqual({ t: 2, d: 0 });
    expect([200, 204]).toContain((await del(e1.id)).statusCode);
    const [orphan] = await q<{ epic_id: string | null }>(`SELECT epic_id FROM issues WHERE id = $1`, [kids[1].id]);
    expect(orphan.epic_id).toBeNull();
    expect(await drift()).toEqual([]);
  });

  test("прямой SQL: INSERT, UPDATE статуса пачкой, DELETE", async () => {
    const { e1, kids } = await family();
    const done = await sidOf("done");
    const [row] = await q<{ id: string }>(
      `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank, epic_id)
       VALUES ($1, 900, 'CORP-900', 'из SQL', '', 'task', $2, 'medium', $3, '{}', 9, $4) RETURNING id`,
      [fx.projects.p1, done, fx.users.admin, e1.id],
    );
    expect(await counts(e1.id)).toEqual({ t: 4, d: 1 });
    await q(`UPDATE issues SET status_id = $2 WHERE id = ANY($1)`, [kids.map((k) => k.id), done]);
    expect(await counts(e1.id)).toEqual({ t: 4, d: 4 });
    await q(`DELETE FROM issues WHERE id = $1`, [row.id]);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 3 });
    expect(await drift()).toEqual([]);
  });

  test("правка категории статуса в схеме меняет «закрыто» у всех его детей", async () => {
    const { e1 } = await family();
    await q(`UPDATE workflow_statuses SET category = 'done' WHERE id = $1`, [fx.p1status.todo]);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 3 });
    await q(`UPDATE workflow_statuses SET category = 'todo' WHERE id = $1`, [fx.p1status.todo]);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("правки, не касающиеся направления, счётчики не трогают (триггер не будится)", async () => {
    const { e1, kids } = await family();
    await q(`UPDATE issues SET epic_child_total = 99 WHERE id = $1`, [e1.id]); // метка: пересчёт её бы стёр
    await patch(kids[0].id, { title: "новое название", priorityId: "high" });
    expect((await counts(e1.id)).t).toBe(99);
  });

  test("две параллельные транзакции добавляют детей в одно направление — счёт не теряется", async () => {
    const { e1 } = await family();
    const insert = (c: import("pg").PoolClient, n: number) =>
      c.query(
        `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank, epic_id)
         VALUES ($1, $2, $3, 'параллельно', '', 'task', $4, 'medium', $5, '{}', $7, $6)`,
        [fx.projects.p1, n, `CORP-${n}`, fx.p1status.todo, fx.users.admin, e1.id, n],
      );
    await withClient(async (a) =>
      withClient(async (b) => {
        try {
          await a.query("BEGIN");
          await b.query("BEGIN");
          await insert(a, 801);
          const second = insert(b, 802); // ждёт блокировку строки направления, взятую транзакцией a
          await new Promise((r) => setTimeout(r, 100));
          await a.query("COMMIT");
          await second;
          await b.query("COMMIT");
        } finally {
          // Упавший тест не должен вернуть в пул соединение с открытой транзакцией.
          await a.query("ROLLBACK").catch(() => {});
          await b.query("ROLLBACK").catch(() => {});
        }
      }),
    );
    expect(await counts(e1.id)).toEqual({ t: 5, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("повторный запуск миграции ничего не ломает и чинит испорченные счётчики", async () => {
    const { e1, e2 } = await family();
    await q(`UPDATE issues SET epic_child_total = 42, epic_child_done = 7 WHERE id = ANY($1)`, [[e1.id, e2.id]]);
    await q(MIGRATION);
    await q(MIGRATION);
    expect(await counts(e1.id)).toEqual({ t: 3, d: 0 });
    expect(await counts(e2.id)).toEqual({ t: 0, d: 0 });
    expect(await drift()).toEqual([]);
  });

  test("GET …/issues/epics отдаёт сохранённые счётчики, план — индекс, не Seq Scan", async () => {
    const { e1, kids } = await family();
    await q(`UPDATE issues SET status_id = $2 WHERE id = $1`, [kids[0].id, await sidOf("done")]);
    const res = await app.inject({ url: `${base()}/epics`, headers: auth(adm) });
    expect(JSON.parse(res.body).items).toMatchObject([{ id: e1.id, childTotal: 3, childDone: 1 }]);

    // Одно соединение: SET действует только в своей сессии, а q() берёт любое соединение пула.
    const plan = await withClient(async (c) => {
      await c.query(`SET enable_seqscan = off`);
      try {
        const r = await c.query<{ "QUERY PLAN": string }>(
          `EXPLAIN SELECT id FROM issues e WHERE e.project_id = $1 AND e.epic_child_total > 0 AND e.archived_at IS NULL
            ORDER BY e.rank, e.id LIMIT 201`,
          [fx.projects.p1],
        );
        return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
      } finally {
        await c.query(`RESET enable_seqscan`);
      }
    });
    expect(plan).toContain("idx_issues_active_epics");
  });
});
