/** История задачи — события данными (трек E). Фраза в `text` — ровно прежняя (старые клиенты, экспорт), событие
 *  отдаётся рядом; запись без события или с неизвестным видом читается как `event: null`, а не роняет историю. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { activityColumns, activityEventOf, activityText } from "../src/services/activity.js";
import type { ActivityEvent } from "../src/contract.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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

describe("фраза события — та же, что писалась до трека E", () => {
  const cases: [ActivityEvent, string][] = [
    [{ kind: "created" }, "создал(а) задачу"],
    [{ kind: "created", ruleName: "Проверка договора" }, "создал(а) задачу по расписанию «Проверка договора»"],
    [{ kind: "renamed" }, "переименовал(а) задачу"],
    [{ kind: "description" }, "обновил(а) описание"],
    [{ kind: "priority", from: "medium", to: "critical" }, "изменил(а) приоритет: Средний → Критичный"],
    [{ kind: "priority", from: "low", to: "high", bulk: true }, "изменил(а) приоритет: Низкий → Высокий (массовая операция)"],
    [{ kind: "complexity", from: null, to: "hard" }, "изменил(а) сложность: — → Сложная"],
    [{ kind: "due", from: "2026-09-01", to: null }, "изменил(а) срок: 2026-09-01 → —"],
    [{ kind: "assigneeAdded", name: "Анна" }, "назначил(а) исполнителем Анна"],
    [{ kind: "assigneeRemoved", name: "Анна" }, "снял(а) исполнителя Анна"],
    [{ kind: "assigneeBulk", cleared: true }, "снял(а) исполнителя (массовая операция)"],
    [{ kind: "assigneeBulk", cleared: false }, "назначил(а) исполнителя (массовая операция)"],
    [{ kind: "direction" }, "изменил(а) группу (эпик)"],
    [{ kind: "parent", set: true }, "сделал(а) подзадачей другой задачи"],
    [{ kind: "parent", set: false }, "убрал(а) из подзадач"],
    [{ kind: "labels" }, "обновил(а) метки"],
    [{ kind: "status", from: "К выполнению", to: "Готово" }, "переместил(а) из «К выполнению» в «Готово»"],
    [{ kind: "status", from: "A", to: "B", bulk: true }, "переместил(а) из «A» в «B» (массовая операция)"],
    [{ kind: "checklistAdded", text: "Проверить" }, "добавил(а) пункт чек-листа «Проверить»"],
    [{ kind: "checklistRemoved" }, "удалил(а) пункт чек-листа"],
    [{ kind: "link", type: "blocks", key: "CORP-2" }, "отметил(а), что задача блокирует CORP-2"],
    [{ kind: "link", type: "blocked_by", key: "CORP-2" }, "отметил(а), что задача заблокирована CORP-2"],
    [{ kind: "link", type: "relates", key: "CORP-2" }, "связал(а) с CORP-2"],
  ];
  test.each(cases)("%o", (event, text) => {
    expect(activityText(event)).toBe(text);
  });

  test("на записи событие проверяется схемой: вне списка — только текст (kind NULL), без ошибки и без «undefined»", () => {
    const bad = activityColumns({ kind: "priority", from: "urgent", to: "high" } as unknown as ActivityEvent);
    expect(bad).toEqual({ kind: null, payload: null, text: "изменил(а) приоритет: urgent → Высокий" });
    expect(activityColumns({ kind: "priority", from: "low", to: "high" })).toEqual({ kind: "priority", payload: '{"from":"low","to":"high"}', text: "изменил(а) приоритет: Низкий → Высокий" });
  });

  test("событие из строки БД: без kind и с неизвестным kind — null", () => {
    expect(activityEventOf(null, null)).toBeNull();
    expect(activityEventOf("future.kind", { a: 1 })).toBeNull();
    expect(activityEventOf("priority", { from: "x", to: "y" })).toBeNull();
    expect(activityEventOf("priority", { from: "low", to: "high" })).toEqual({ kind: "priority", from: "low", to: "high" });
  });

  test.each([
    { kind: "status", from: "К выполнению", to: "Готово" },
    { kind: "status", from: "A", to: "B", bulk: true },
    { kind: "assigneeAdded", name: "Анна" },
    { kind: "assigneeRemoved", name: "Анна" },
    { kind: "assigneeBulk", cleared: false },
    { kind: "assigneeBulk", cleared: true },
  ] satisfies ActivityEvent[])("старое событие без идентификаторов читается: %o", (event) => {
    const { kind, ...payload } = event;
    expect(activityEventOf(kind, payload)).toEqual(event);
  });
});

test("правка задачи пишет событие; старая запись без события отдаётся с event: null", async () => {
  const mgr = await login(app, "mgr1");
  const url = `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`;
  await q(`INSERT INTO activity (issue_id, actor_id, text, created_at) VALUES ($1, $2, 'старая запись', now() - interval '1 day')`, [fx.issues.p1issue, fx.users.emp1]);
  const r = await app.inject({ method: "PATCH", url, headers: auth(mgr), payload: { priorityId: "critical", dueDate: "2026-10-01" } });
  expect(r.statusCode).toBe(200);
  const items = JSON.parse((await app.inject({ url: `${url}/activity`, headers: auth(mgr) })).body) as { text: string; event: ActivityEvent | null }[];
  expect(items[0]).toMatchObject({ text: "старая запись", event: null });
  // Записи одной правки пишутся в одной транзакции с одним временем — порядок между ними не задан.
  const fresh = items.slice(1);
  expect(fresh.map((i) => i.event?.kind).sort()).toEqual(["due", "priority"]);
  expect(fresh.find((i) => i.event?.kind === "priority")).toMatchObject({ event: { to: "critical" } });
  expect(fresh.find((i) => i.event?.kind === "due")).toMatchObject({ event: { from: null, to: "2026-10-01" }, text: "изменил(а) срок: — → 2026-10-01" });
});

test.each([false, true])("переход статуса сохраняет идентификаторы в БД и API (bulk=%s)", async (bulk) => {
  const mgr = await login(app, "mgr1");
  const base = `/api/projects/${fx.projects.p1}/issues`;
  const r = await app.inject({
    method: bulk ? "PATCH" : "POST",
    url: bulk ? `${base}/bulk` : `${base}/${fx.issues.p1issue}/transition`,
    headers: auth(mgr),
    payload: bulk
      ? { action: "status", issueIds: [fx.issues.p1issue], statusId: fx.p1status.inprogress }
      : { to: fx.p1status.inprogress },
  });
  expect(r.statusCode).toBe(200);
  if (bulk) expect(JSON.parse(r.body)).toEqual({ succeeded: [fx.issues.p1issue], failed: [] });

  const rows = await q<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM activity WHERE issue_id = $1 AND kind = 'status'`, [fx.issues.p1issue],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].payload).toMatchObject({ fromId: fx.p1status.todo, toId: fx.p1status.inprogress });
  expect(rows[0].payload.bulk).toBe(bulk ? true : undefined);
  const history = await app.inject({ url: `${base}/${fx.issues.p1issue}/activity`, headers: auth(mgr) });
  expect(history.statusCode).toBe(200);
  expect(JSON.parse(history.body)).toMatchObject([
    { event: { kind: "status", fromId: fx.p1status.todo, toId: fx.p1status.inprogress } },
  ]);
});

test("замена исполнителей сохраняет id добавленного и снятого человека вместе с именами", async () => {
  const mgr = await login(app, "mgr1");
  const url = `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`;
  const r = await app.inject({ method: "PATCH", url, headers: auth(mgr), payload: { assigneeIds: [fx.users.mgr1] } });
  expect(r.statusCode).toBe(200);

  const rows = await q<{ kind: string; payload: Record<string, unknown>; text: string }>(
    `SELECT kind, payload, text FROM activity WHERE issue_id = $1`, [fx.issues.p1issue],
  );
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([
    { kind: "assigneeAdded", payload: { name: "Manager One", userId: fx.users.mgr1 }, text: "назначил(а) исполнителем Manager One" },
    { kind: "assigneeRemoved", payload: { name: "Employee One", userId: fx.users.emp1 }, text: "снял(а) исполнителя Employee One" },
  ]));
  const history = await app.inject({ url: `${url}/activity`, headers: auth(mgr) });
  expect(history.statusCode).toBe(200);
  expect(JSON.parse(history.body)).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: { kind: "assigneeAdded", name: "Manager One", userId: fx.users.mgr1 } }),
    expect.objectContaining({ event: { kind: "assigneeRemoved", name: "Employee One", userId: fx.users.emp1 } }),
  ]));
});

test("массовое назначение сохраняет userId, массовое снятие — null", async () => {
  const mgr = await login(app, "mgr1");
  const url = `/api/projects/${fx.projects.p1}/issues/bulk`;
  for (const assigneeId of [fx.users.mgr1, "none"]) {
    const r = await app.inject({
      method: "PATCH", url, headers: auth(mgr),
      payload: { action: "assignee", issueIds: [fx.issues.p1issue], assigneeId },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ succeeded: [fx.issues.p1issue], failed: [] });
  }
  const rows = await q<{ payload: Record<string, unknown>; text: string }>(
    `SELECT payload, text FROM activity WHERE issue_id = $1 AND kind = 'assigneeBulk'`, [fx.issues.p1issue],
  );
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([
    { payload: { cleared: false, userId: fx.users.mgr1 }, text: "назначил(а) исполнителя (массовая операция)" },
    { payload: { cleared: true, userId: null }, text: "снял(а) исполнителя (массовая операция)" },
  ]));
  const history = await app.inject({
    url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/activity`, headers: auth(mgr),
  });
  expect(history.statusCode).toBe(200);
  expect(JSON.parse(history.body)).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: { kind: "assigneeBulk", cleared: false, userId: fx.users.mgr1 } }),
    expect.objectContaining({ event: { kind: "assigneeBulk", cleared: true, userId: null } }),
  ]));
});
