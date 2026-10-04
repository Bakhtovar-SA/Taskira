/** INT-02: триггеры outbox охватывают реальные пути записи и живут в транзакции истории. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { ActivityEvent } from "../src/contract.js";
import { logActivity } from "../src/services/activity.js";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
let token: string;

beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  // Новые таблицы очищаются существующим TRUNCATE … CASCADE, без правки resetDb().
  expect(await counts()).toEqual({ webhooks: 0, integration_events: 0, webhook_deliveries: 0 });
  fx = await seedFixture();
  token = await login(app, "mgr1");
});

async function counts() {
  return (await q<{ webhooks: number; integration_events: number; webhook_deliveries: number }>(
    `SELECT (SELECT count(*)::int FROM webhooks) AS webhooks,
            (SELECT count(*)::int FROM integration_events) AS integration_events,
            (SELECT count(*)::int FROM webhook_deliveries) AS webhook_deliveries`,
  ))[0];
}

async function addWebhook(projectId: string, state: "active" | "paused" | "disabled" = "active") {
  return (await q<{ id: string }>(
    `INSERT INTO webhooks (project_id, name, url_enc, url_display, secret_enc, events, state, disabled_reason, created_by)
     VALUES ($1, 'Test hook', 'test-url', 'https://example.invalid/hook', 'test-secret',
             ARRAY['issue.updated'], $2, $3, $4) RETURNING id`,
    [projectId, state, state === "disabled" ? "failing" : null, fx.users.mgr1],
  ))[0].id;
}

interface OutboxEvent {
  id: string;
  event_id: string;
  type: string;
  project_id: string;
  issue_id: string;
  issue_key: string;
  actor_id: string;
  dedupe_key: string;
  changes: Record<string, unknown>[];
  data: Record<string, unknown>;
  payload: unknown;
  dispatched_at: unknown;
}
const events = () => q<OutboxEvent>(`SELECT * FROM integration_events ORDER BY id`);
const base = () => `/api/projects/${fx.projects.p1}/issues`;
const issueUrl = () => `${base()}/${fx.issues.p1issue}`;

test("SQL-классификация охватывает весь закрытый контракт истории", async () => {
  // При добавлении kind контракт требует явного решения о его типе интеграции.
  const mapping = {
    created: "issue.created", status: "issue.statusChanged",
    assigneeAdded: "issue.assigned", assigneeRemoved: "issue.assigned", assigneeBulk: "issue.assigned",
    renamed: "issue.updated", description: "issue.updated", priority: "issue.updated", complexity: "issue.updated",
    due: "issue.updated", direction: "issue.updated", parent: "issue.updated", labels: "issue.updated",
    checklistAdded: "issue.updated", checklistRemoved: "issue.updated", link: "issue.updated",
  } satisfies Record<ActivityEvent["kind"], string>;
  expect(Object.keys(mapping).sort()).toEqual(ActivityEvent.options.map((option) => option.shape.kind.value).sort());
  const rows = await q<{ kind: keyof typeof mapping; type: string }>(
    `SELECT kind, integration_event_type(kind) AS type FROM unnest($1::text[]) AS kind`, [Object.keys(mapping)],
  );
  for (const row of rows) expect(row.type, row.kind).toBe(mapping[row.kind]);
});

test.each([
  { eventTypes: ["unknown"] }, { eventTypes: ["ping"] }, { eventTypes: [null] },
  { eventTypes: ["issue.updated", null] }, { eventTypes: [] },
])(
  "подписка отклоняет неизвестные, служебные и пустые типы событий ($eventTypes)", async ({ eventTypes }) => {
    await expect(q(
      `INSERT INTO webhooks (project_id, name, url_enc, url_display, secret_enc, events)
       VALUES ($1, 'Invalid hook', 'test', 'https://example.invalid/hook', 'test', $2::text[])`,
      [fx.projects.p1, eventTypes],
    )).rejects.toMatchObject({ code: "23514" });
  },
);

const paths = ["create", "rename", "transition", "assignees", "comment", "link", "checklist", "bulk"] as const;
type WritePath = typeof paths[number];
const types: Record<WritePath, string> = {
  create: "issue.created", rename: "issue.updated", transition: "issue.statusChanged", assignees: "issue.assigned",
  comment: "issue.commented", link: "issue.updated", checklist: "issue.updated", bulk: "issue.updated",
};

async function write(path: WritePath): Promise<{ issueId: string; commentId?: string; linkedIssueId?: string }> {
  const request = async (method: "POST" | "PATCH", url: string, payload: unknown, status = 200) => {
    const response = await app.inject({ method, url, headers: auth(token), payload: payload as Record<string, unknown> });
    expect(response.statusCode, response.body).toBe(status);
    return JSON.parse(response.body);
  };
  const issueId = fx.issues.p1issue;
  switch (path) {
    case "create": return { issueId: (await request("POST", base(), newIssue(), 201)).id };
    case "rename": await request("PATCH", issueUrl(), { title: "Changed title" }); break;
    case "transition": await request("POST", `${issueUrl()}/transition`, { to: fx.p1status.inprogress }); break;
    case "assignees": await request("PATCH", issueUrl(), { assigneeIds: [fx.users.mgr1] }); break;
    case "comment": return { issueId, commentId: (await request("POST", `${issueUrl()}/comments`, { body: "A comment" }, 201)).id };
    case "link": {
      // Фикстура цели без истории: проверяем запись добавления ссылки у исходной задачи.
      const linkedIssueId = (await q<{ id: string }>(
        `INSERT INTO issues (project_id, num, key, title, type_id, status_id, priority_id, reporter_id, rank)
         VALUES ($1, 99, 'CORP-99', 'Link target', 'task', $2, 'medium', $3, 99) RETURNING id`,
        [fx.projects.p1, fx.p1status.todo, fx.users.mgr1],
      ))[0].id;
      await request("POST", `${issueUrl()}/links`, { linkedIssueId, type: "relates" });
      return { issueId, linkedIssueId };
    }
    case "checklist": await request("POST", `${issueUrl()}/checklist`, { text: "Check it" }); break;
    case "bulk": {
      const response = await request("PATCH", `${base()}/bulk`, { action: "priority", issueIds: [issueId], priorityId: "high" });
      expect(response).toEqual({ succeeded: [issueId], failed: [] });
      break;
    }
  }
  return { issueId };
}

describe("триггеры на путях API", () => {
  test("без подписки все пути записи оставляют outbox пустым", async () => {
    for (const path of paths) await write(path);
    expect(await events()).toEqual([]);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM activity`))[0].n).toBeGreaterThan(0);
  });

  test.each(["paused", "disabled"] as const)("подписка %s не создаёт событий", async (state) => {
    await addWebhook(fx.projects.p1, state);
    for (const path of paths) await write(path);
    expect(await events()).toEqual([]);
  });

  test("подписка другого проекта не включает outbox этого проекта", async () => {
    await addWebhook(fx.projects.p2);
    await write("rename");
    await write("comment");
    expect(await events()).toEqual([]);
  });

  test.each(paths)("активная подписка: %s", async (path) => {
    await addWebhook(fx.projects.p1);
    const { issueId, commentId } = await write(path);
    const rows = await events();
    expect(rows).toHaveLength(1);
    const event = rows.find((row) => row.issue_id === issueId)!;
    expect(event).toMatchObject({
      type: types[path], project_id: fx.projects.p1, issue_id: issueId,
      issue_key: path === "create" ? "CORP-2" : "CORP-1", actor_id: fx.users.mgr1,
      payload: null, dispatched_at: null,
    });
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    if (path === "comment") {
      expect(event.data).toEqual({ commentId });
      expect(event.dedupe_key).toBe(`comment:${commentId}`);
      expect(event.changes).toEqual([]);
    } else {
      expect(event.data).toEqual({});
      expect(event.dedupe_key).toMatch(new RegExp(`^tx:[0-9]+:${issueId}:${types[path]}$`));
      expect(event.changes).not.toHaveLength(0);
    }
    if (path === "transition") {
      expect(event.changes).toEqual([expect.objectContaining({
        kind: "status", fromId: fx.p1status.todo, toId: fx.p1status.inprogress,
      })]);
    }
    if (path === "assignees") {
      expect(event.changes).toHaveLength(2);
      expect(event.changes).toEqual(expect.arrayContaining([
        { kind: "assigneeAdded", name: "Manager One", userId: fx.users.mgr1 },
        { kind: "assigneeRemoved", name: "Employee One", userId: fx.users.emp1 },
      ]));
    }
    if (path === "link") {
      expect(event.changes).toEqual([{ kind: "link", type: "relates", key: "CORP-99" }]);
    }
    if (path === "bulk") expect(event.changes).toEqual([{ kind: "priority", from: "medium", to: "high", bulk: true }]);
    // Раскладка доставок появится в INT-04, триггер создаёт только событие.
    expect((await counts()).webhook_deliveries).toBe(0);
  });

  test.each(["status", "assignee"] as const)("массовая операция %s сохраняет тип и идентификаторы события", async (action) => {
    await addWebhook(fx.projects.p1);
    const response = await app.inject({
      method: "PATCH", url: `${base()}/bulk`, headers: auth(token),
      payload: action === "status"
        ? { action, issueIds: [fx.issues.p1issue], statusId: fx.p1status.inprogress }
        : { action, issueIds: [fx.issues.p1issue], assigneeId: fx.users.mgr1 },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ succeeded: [fx.issues.p1issue], failed: [] });
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(action === "status"
      ? { type: "issue.statusChanged", changes: [{ kind: "status", fromId: fx.p1status.todo, toId: fx.p1status.inprogress, bulk: true }] }
      : { type: "issue.assigned", changes: [{ kind: "assigneeBulk", cleared: false, userId: fx.users.mgr1 }] });
  });
});

describe("границы транзакции и жизненный цикл", () => {
  test("один PATCH склеивает название, приоритет и срок в порядке записи истории", async () => {
    await addWebhook(fx.projects.p1);
    const response = await app.inject({
      method: "PATCH", url: issueUrl(), headers: auth(token),
      payload: { title: "Changed title", priorityId: "high", dueDate: "2026-12-10" },
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("issue.updated");
    expect(rows[0].changes).toEqual([
      { kind: "renamed" }, { kind: "priority", from: "medium", to: "high" },
      { kind: "due", from: null, to: "2026-12-10" },
    ]);
  });

  test("одинаковая история в двух транзакциях создаёт два разных события", async () => {
    await addWebhook(fx.projects.p1);
    for (let n = 0; n < 2; n++) {
      await withTransaction((client) => logActivity(fx.issues.p1issue, fx.users.mgr1, { kind: "renamed" }, client));
    }
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.dedupe_key)).size).toBe(2);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
    expect(rows.map((row) => row.changes)).toEqual([[{ kind: "renamed" }], [{ kind: "renamed" }]]);
  });

  test("склейка не смешивает задачи и типы внутри одной транзакции", async () => {
    await addWebhook(fx.projects.p1);
    await addWebhook(fx.projects.p2);
    await withTransaction(async (client) => {
      await logActivity(fx.issues.p1issue, fx.users.mgr1, { kind: "renamed" }, client);
      await logActivity(fx.issues.p1issue, fx.users.mgr1, { kind: "assigneeAdded", name: "Manager One", userId: fx.users.mgr1 }, client);
      await logActivity(fx.issues.p2issue, fx.users.mgr2, { kind: "renamed" }, client);
    });
    const rows = await events();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row.issue_id, row.type])).toEqual([
      [fx.issues.p1issue, "issue.updated"], [fx.issues.p1issue, "issue.assigned"], [fx.issues.p2issue, "issue.updated"],
    ]);
  });

  test.each(["activity", "comments"] as const)("откат транзакции удаляет и %s, и его outbox", async (source) => {
    await addWebhook(fx.projects.p1);
    await expect(withTransaction(async (client) => {
      if (source === "activity") await logActivity(fx.issues.p1issue, fx.users.mgr1, { kind: "renamed" }, client);
      else await client.query(`INSERT INTO comments (issue_id, author_id, body) VALUES ($1, $2, 'Rolled back')`, [fx.issues.p1issue, fx.users.mgr1]);
      const inside = await client.query(`SELECT id FROM integration_events`);
      expect(inside.rows).toHaveLength(1);
      throw new Error("rollback outbox test");
    })).rejects.toThrow("rollback outbox test");
    expect(await events()).toEqual([]);
    expect(await q(`SELECT id FROM ${source}`)).toEqual([]);
  });

  test("два комментария в одной транзакции остаются двумя отдельными событиями", async () => {
    await addWebhook(fx.projects.p1);
    const comments = await withTransaction(async (client) => (await client.query<{ id: string }>(
      `INSERT INTO comments (issue_id, author_id, body) VALUES ($1, $2, 'First'), ($1, $2, 'Second') RETURNING id`,
      [fx.issues.p1issue, fx.users.mgr1],
    )).rows);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.dedupe_key)).toEqual(comments.map((comment) => `comment:${comment.id}`));
    expect(rows.map((row) => row.data)).toEqual(comments.map((comment) => ({ commentId: comment.id })));
  });

  test("история без kind не создаёт событие", async () => {
    await addWebhook(fx.projects.p1);
    await q(`INSERT INTO activity (issue_id, actor_id, text) VALUES ($1, $2, 'Legacy history')`, [fx.issues.p1issue, fx.users.mgr1]);
    expect(await events()).toEqual([]);
  });

  test("два параллельных PATCH разных полей успешно создают отдельные события", async () => {
    await addWebhook(fx.projects.p1);
    const responses = await Promise.all([
      app.inject({ method: "PATCH", url: issueUrl(), headers: auth(token), payload: { title: "Concurrent title" } }),
      app.inject({ method: "PATCH", url: issueUrl(), headers: auth(token), payload: { priorityId: "high" } }),
    ]);
    for (const response of responses) expect(response.statusCode, response.body).toBe(200);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.dedupe_key)).size).toBe(2);
    expect(rows.map((row) => row.changes)).toEqual(expect.arrayContaining([
      [{ kind: "renamed" }], [{ kind: "priority", from: "medium", to: "high" }],
    ]));
    expect((await q(`SELECT title, priority_id FROM issues WHERE id = $1`, [fx.issues.p1issue]))[0]).toEqual({
      title: "Concurrent title", priority_id: "high",
    });
  });

  test("три подписки создают одно событие, а не событие на подписку", async () => {
    for (let n = 0; n < 3; n++) await addWebhook(fx.projects.p1);
    await write("rename");
    expect(await events()).toHaveLength(1);
  });

  test("событие сохраняет снимок после удаления задачи и автора", async () => {
    const hook = await addWebhook(fx.projects.p1);
    await write("rename");
    const before = await events();
    await q(`DELETE FROM issues WHERE id = $1`, [fx.issues.p1issue]);
    await q(`DELETE FROM users WHERE id = $1`, [fx.users.mgr1]);
    expect(await events()).toEqual(before);
    expect(await q(`SELECT created_by FROM webhooks WHERE id = $1`, [hook])).toEqual([{ created_by: null }]);
  });

  test("удаление проекта каскадом удаляет подписки, события и доставки", async () => {
    const hook = await addWebhook(fx.projects.p1);
    await write("rename");
    const event = (await events())[0];
    await q(`INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2)`, [hook, event.id]);
    const admin = await login(app, "admin");
    const response = await app.inject({ method: "DELETE", url: `/api/projects/${fx.projects.p1}`, headers: auth(admin) });
    expect(response.statusCode, response.body).toBe(204);
    expect(await counts()).toEqual({ webhooks: 0, integration_events: 0, webhook_deliveries: 0 });
  });

  test("resetDb очищает все три таблицы с заполненными доставками", async () => {
    const hook = await addWebhook(fx.projects.p1);
    await write("comment");
    await q(`INSERT INTO webhook_deliveries (webhook_id, event_id) VALUES ($1, $2)`, [hook, (await events())[0].id]);
    expect(await counts()).toEqual({ webhooks: 1, integration_events: 1, webhook_deliveries: 1 });
    await resetDb();
    expect(await counts()).toEqual({ webhooks: 0, integration_events: 0, webhook_deliveries: 0 });
  });
});

test("индекс доставок запрещает повторную автоматическую доставку, но допускает ручные", async () => {
  const hook = await addWebhook(fx.projects.p1);
  await write("rename");
  const event = (await events())[0];
  const insert = (manual: boolean, excerpt: string | null = null) => q(
    `INSERT INTO webhook_deliveries (webhook_id, event_id, manual, response_excerpt) VALUES ($1, $2, $3, $4)`,
    [hook, event.id, manual, excerpt],
  );
  await insert(false);
  await expect(insert(false)).rejects.toMatchObject({ code: "23505" });
  await insert(true, "я".repeat(256));
  await insert(true);
  await expect(insert(true, "я".repeat(257))).rejects.toMatchObject({ code: "23514" });
  expect((await counts()).webhook_deliveries).toBe(3);
});
