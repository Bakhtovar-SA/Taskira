import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { acquireClient, q, withTransaction } from "../src/db.js";
import { materializeRealtimeChanges, readRealtimeChanges } from "../src/services/realtime.js";
import { auth, getApp, login, newIssue, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
let token: string;
let baselineCursor: string;
beforeAll(async () => { app = await getApp(); });
afterAll(() => stopApp());
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  token = await login(app, "mgr1");
  await materializeRealtimeChanges();
  baselineCursor = (await readRealtimeChanges(fx.projects.p1, null)).cursor;
});

async function createIssue(title: string) {
  const response = await app.inject({
    method: "POST", url: `/api/projects/${fx.projects.p1}/issues`,
    headers: auth(token), payload: newIssue({ title }),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; updatedAt: string }>();
}

async function withDispatcherPaused(fn: () => Promise<void>): Promise<void> {
  const lock = await acquireClient();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext('taskira:realtime-dispatch'))");
    await fn();
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('taskira:realtime-dispatch'))");
    lock.release();
  }
}

describe("durable realtime journal", () => {
  test("a rolled-back mutation is invisible to readers and leaves no event", async () => {
    const writer = await acquireClient();
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE issues SET title = 'not committed' WHERE id = $1", [fx.issues.p1issue]);
      expect((await writer.query("SELECT id FROM realtime_pending")).rows).toHaveLength(1);
      expect(await q("SELECT id FROM realtime_pending")).toHaveLength(0);
      await writer.query("ROLLBACK");
      await materializeRealtimeChanges();
      expect((await readRealtimeChanges(fx.projects.p1, baselineCursor)).issueIds).toHaveLength(0);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });

  test("issue and related writes in one transaction produce one invalidation without webhooks", async () => {
    await withDispatcherPaused(async () => {
      await withTransaction(async client => {
        await client.query("UPDATE issues SET title = 'committed' WHERE id = $1", [fx.issues.p1issue]);
        await client.query("INSERT INTO comments(issue_id, author_id, body) VALUES ($1, $2, 'new comment')",
          [fx.issues.p1issue, fx.users.emp1]);
        await client.query("UPDATE issues SET priority_id = 'high' WHERE id = $1", [fx.issues.p1issue]);
      });
      expect(await q("SELECT id FROM webhooks")).toHaveLength(0);
      expect(await q("SELECT id FROM realtime_pending")).toHaveLength(1);
    });
    const update = await readRealtimeChanges(fx.projects.p1, baselineCursor);
    expect(update.reset).toBe(false);
    expect(update.issueIds).toEqual([fx.issues.p1issue]);
    expect(await q("SELECT id FROM realtime_pending")).toHaveLength(0);
  });

  test("a smaller pending id committed later is replayed after an acknowledged newer transaction", async () => {
    const second = await createIssue("second writer");
    await materializeRealtimeChanges();
    const baseline = await readRealtimeChanges(fx.projects.p1, null);
    const early = await acquireClient();
    const late = await acquireClient();
    try {
      await early.query("BEGIN");
      await late.query("BEGIN");
      await early.query("UPDATE issues SET title = 'early id, late commit' WHERE id = $1", [fx.issues.p1issue]);
      await late.query("UPDATE issues SET title = 'late id, early commit' WHERE id = $1", [second.id]);
      await late.query("COMMIT");
      const firstBatch = await readRealtimeChanges(fx.projects.p1, baseline.cursor);
      expect(firstBatch.reset).toBe(false);
      expect(firstBatch.issueIds).toEqual([second.id]);
      await early.query("COMMIT");
      const recovered = await readRealtimeChanges(fx.projects.p1, firstBatch.cursor);
      expect(recovered.reset).toBe(false);
      expect(recovered.issueIds).toEqual([fx.issues.p1issue]);
      expect(BigInt(recovered.cursor)).toBeGreaterThan(BigInt(firstBatch.cursor));
    } finally {
      await early.query("ROLLBACK");
      await late.query("ROLLBACK");
      early.release();
      late.release();
    }
  });

  test("rank/archive writes are captured even when updatedAt does not change", async () => {
    const baseline = await readRealtimeChanges(fx.projects.p1, null);
    await q("UPDATE issues SET rank = rank + 1, archived_at = now() WHERE id = $1", [fx.issues.p1issue]);
    const update = await readRealtimeChanges(fx.projects.p1, baseline.cursor);
    expect(update.issueIds).toEqual([fx.issues.p1issue]);
  });

  test("deletion keeps the issue id and a second reader receives the same durable event", async () => {
    const baseline = await readRealtimeChanges(fx.projects.p1, null);
    await q("DELETE FROM issues WHERE id = $1", [fx.issues.p1issue]);
    const first = await readRealtimeChanges(fx.projects.p1, baseline.cursor);
    const second = await readRealtimeChanges(fx.projects.p1, baseline.cursor);
    expect(first.issueIds).toEqual([fx.issues.p1issue]);
    expect(second).toMatchObject({ cursor: first.cursor, issueIds: first.issueIds, reset: false });
  });

  test("project metadata requests a full revalidation", async () => {
    const baseline = await readRealtimeChanges(fx.projects.p1, null);
    await q("UPDATE workflow_statuses SET name = 'Renamed' WHERE id = $1", [fx.p1status.todo]);
    const update = await readRealtimeChanges(fx.projects.p1, baseline.cursor);
    expect(update.reset).toBe(true);
  });

  test("expired and future cursors recover through a snapshot instead of skipping data", async () => {
    await q("UPDATE issues SET title = 'first update' WHERE id = $1", [fx.issues.p1issue]);
    await materializeRealtimeChanges();
    await q("UPDATE issues SET title = 'second update' WHERE id = $1", [fx.issues.p1issue]);
    await materializeRealtimeChanges();
    const latest = await readRealtimeChanges(fx.projects.p1, null);
    await q("DELETE FROM realtime_events WHERE project_id = $1 AND project_sequence < $2", [fx.projects.p1, latest.cursor]);
    expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({ reset: true, issueIds: [] });
    expect(await readRealtimeChanges(fx.projects.p1, "9223372036854775807")).toMatchObject({ reset: true, cursor: latest.cursor });
  });

  test("large catch-up is bounded and requests a snapshot", async () => {
    await q(`INSERT INTO realtime_events(project_id, issue_ids)
      SELECT $1, ARRAY[$2::uuid] FROM generate_series(1, 501)`, [fx.projects.p1, fx.issues.p1issue]);
    expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({ reset: true, issueIds: [] });
  });

  test("a locked project's full pending batch cannot starve another project", async () => {
    const otherBaseline = await readRealtimeChanges(fx.projects.p2, null);
    const deletion = await acquireClient();
    let dispatch: Promise<void> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await withDispatcherPaused(async () => {
        await q(`INSERT INTO realtime_pending(project_id, issue_id, dedupe_key)
          SELECT $1, $2, 'blocked:' || n FROM generate_series(1, 1000) AS n`,
          [fx.projects.p1, fx.issues.p1issue]);
        await q("UPDATE issues SET title = 'must be delivered' WHERE id = $1", [fx.issues.p2issue]);
        await deletion.query("BEGIN");
        await deletion.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [fx.projects.p1]);
      });
      dispatch = materializeRealtimeChanges();
      await Promise.race([dispatch, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Dispatcher waited on a locked backlog")), 1500);
      })]);
      const delivered = await readRealtimeChanges(fx.projects.p2, otherBaseline.cursor, { materialize: false });
      expect(delivered).toMatchObject({ reset: false, issueIds: [fx.issues.p2issue] });
      expect(await q("SELECT id FROM realtime_pending WHERE project_id = $1", [fx.projects.p1])).toHaveLength(1000);
      expect(await q("SELECT id FROM realtime_pending WHERE project_id = $1", [fx.projects.p2])).toHaveLength(0);
      await deletion.query("ROLLBACK");
      expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({ reset: false, issueIds: [fx.issues.p1issue] });
      expect(await q("SELECT id FROM realtime_pending")).toHaveLength(0);
    } finally {
      clearTimeout(timeout);
      await deletion.query("ROLLBACK");
      deletion.release();
      await dispatch;
    }
  });

  test("foreign writes neither advance a project's cursor nor leave gaps in its next cursor", async () => {
    await q(`INSERT INTO realtime_events(project_id, issue_ids)
      SELECT $1, ARRAY[$2::uuid] FROM generate_series(1, 20)`, [fx.projects.p2, fx.issues.p2issue]);
    expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({
      cursor: baselineCursor, reset: false, issueIds: [],
    });
    await q("UPDATE issues SET title = 'own change' WHERE id = $1", [fx.issues.p1issue]);
    expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({
      cursor: (BigInt(baselineCursor) + 1n).toString(), reset: false, issueIds: [fx.issues.p1issue],
    });
  });

  test("a project watermark survives cleanup of all retained events", async () => {
    await q("UPDATE issues SET title = 'expired update' WHERE id = $1", [fx.issues.p1issue]);
    const latest = await readRealtimeChanges(fx.projects.p1, baselineCursor);
    await q("UPDATE realtime_events SET created_at = now() - interval '8 days'");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    try { await materializeRealtimeChanges(); } finally { clock.mockRestore(); }
    expect(await q("SELECT sequence FROM realtime_events")).toHaveLength(0);
    expect(await readRealtimeChanges(fx.projects.p1, baselineCursor)).toMatchObject({ cursor: latest.cursor, reset: true, issueIds: [] });
    expect(await readRealtimeChanges(fx.projects.p1, latest.cursor)).toMatchObject({ cursor: latest.cursor, reset: false, issueIds: [] });
    await q("UPDATE issues SET title = 'after quiet week' WHERE id = $1", [fx.issues.p1issue]);
    expect(await readRealtimeChanges(fx.projects.p1, latest.cursor)).toMatchObject({
      cursor: (BigInt(latest.cursor) + 1n).toString(), reset: false, issueIds: [fx.issues.p1issue],
    });
  });

  test("cursor migration preserves populated history and keeps old-style inserts transactional", async () => {
    const client = await acquireClient();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA realtime_cursor_upgrade");
      await client.query("SET LOCAL search_path TO realtime_cursor_upgrade");
      await client.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
        CREATE TABLE realtime_pending(id bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id));
        CREATE TABLE realtime_events(sequence bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
          issue_ids uuid[] NOT NULL DEFAULT '{}', reset boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await client.query("INSERT INTO projects(id) VALUES ($1), ($2)", [fx.projects.p1, fx.projects.p2]);
      await client.query(`INSERT INTO realtime_events(sequence, project_id) VALUES (7, $1), (11, $2), (12, $1)`,
        [fx.projects.p1, fx.projects.p2]);
      await client.query(readFileSync(new URL("../migrations/20261102T1130_realtime_project_cursors.sql", import.meta.url), "utf8"));
      expect((await client.query("SELECT project_sequence FROM realtime_events ORDER BY sequence")).rows)
        .toEqual([{ project_sequence: "7" }, { project_sequence: "11" }, { project_sequence: "12" }]);
      await client.query("INSERT INTO realtime_events(project_id) VALUES ($1)", [fx.projects.p2]);
      expect((await client.query("INSERT INTO realtime_events(project_id) VALUES ($1) RETURNING project_sequence", [fx.projects.p1])).rows)
        .toEqual([{ project_sequence: "13" }]);
      await client.query("SAVEPOINT aborted_event");
      await client.query("INSERT INTO realtime_events(project_id) VALUES ($1)", [fx.projects.p1]);
      await client.query("ROLLBACK TO SAVEPOINT aborted_event");
      expect((await client.query("SELECT high FROM realtime_project_cursors WHERE project_id = $1", [fx.projects.p1])).rows)
        .toEqual([{ high: "13" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  test("dispatch skips a locked project so concurrent deletion cannot deadlock", async () => {
    await q("UPDATE issues SET title = 'pending' WHERE id = $1", [fx.issues.p1issue]);
    const deletion = await acquireClient();
    let dispatch: Promise<void> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await deletion.query("BEGIN");
      await deletion.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [fx.projects.p1]);
      dispatch = materializeRealtimeChanges();
      await Promise.race([dispatch, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Dispatcher waited on a locked parent")), 1500);
      })]);
      await deletion.query("DELETE FROM projects WHERE id = $1", [fx.projects.p1]);
      await deletion.query("COMMIT");
      expect(await q("SELECT id FROM realtime_pending WHERE project_id = $1", [fx.projects.p1])).toHaveLength(0);
      expect(await q("SELECT sequence FROM realtime_events WHERE project_id = $1", [fx.projects.p1])).toHaveLength(0);
    } finally {
      clearTimeout(timeout);
      await deletion.query("ROLLBACK");
      deletion.release();
      await dispatch;
    }
  });

  test("monitoring exposes the realtime backlog before dispatch", async () => {
    await withDispatcherPaused(async () => {
      await q("UPDATE issues SET title = 'awaiting dispatch' WHERE id = $1", [fx.issues.p1issue]);
      const scrape = await app.inject({ url: "/metrics" });
      expect(scrape.statusCode).toBe(200);
      expect(scrape.body).toContain('taskira_background_queue_size{queue="realtime"} 1');
      expect(scrape.body).toMatch(/taskira_realtime_pending_oldest_seconds [\d.]+/);
    });
  });
});

describe("optimistic write conflicts", () => {
  test("two simultaneous stale editors cannot both overwrite the same version", async () => {
    const issue = await createIssue("initial");
    const responses = await Promise.all(["first author", "second author"].map(title => app.inject({
      method: "PATCH", url: `/api/projects/${fx.projects.p1}/issues/${issue.id}`,
      headers: auth(token), payload: { title, expectedVersion: issue.updatedAt },
    })));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(response => response.statusCode === 409)!.json().error.code).toBe("STALE_VERSION");
    const saved = await q<{ title: string }>("SELECT title FROM issues WHERE id = $1", [issue.id]);
    expect(saved[0].title).toBe(responses.find(response => response.statusCode === 200)!.json().title);
  });

  test("stale status changes are rejected after another edit", async () => {
    const issue = await createIssue("initial");
    const edited = await app.inject({ method: "PATCH", url: `/api/projects/${fx.projects.p1}/issues/${issue.id}`,
      headers: auth(token), payload: { title: "new title", expectedVersion: issue.updatedAt } });
    expect(edited.statusCode).toBe(200);
    const moved = await app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/issues/${issue.id}/transition`,
      headers: auth(token), payload: { to: fx.p1status.inprogress, expectedVersion: issue.updatedAt } });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(moved.json().error.code).toBe("STALE_VERSION");
  });

  test("normal guarded assignment still emits assignment notifications", async () => {
    const issue = await createIssue("assignment");
    const assigned = await app.inject({ method: "PATCH", url: `/api/projects/${fx.projects.p1}/issues/${issue.id}`,
      headers: auth(token), payload: { assigneeIds: [fx.users.emp1], expectedVersion: issue.updatedAt } });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(await q("SELECT id FROM notifications WHERE user_id = $1 AND issue_id = $2 AND type = 'issue.assigned'",
      [fx.users.emp1, issue.id])).toHaveLength(1);
  });

  test("guard-only PATCH remains invalid", async () => {
    const issue = await createIssue("initial");
    const response = await app.inject({ method: "PATCH", url: `/api/projects/${fx.projects.p1}/issues/${issue.id}`,
      headers: auth(token), payload: { expectedVersion: issue.updatedAt } });
    expect(response.statusCode).toBe(400);
  });

  test("simultaneous first writes to an empty custom field do not silently overwrite", async () => {
    const field = (await q<{ id: string }>(`INSERT INTO custom_fields(project_id, name, field_type, position)
      VALUES ($1, 'Concurrent field', 'text', 0) RETURNING id`, [fx.projects.p1]))[0];
    const responses = await Promise.all(["first value", "second value"].map(value => app.inject({
      method: "PUT", url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/custom-fields/${field.id}`,
      headers: auth(token), payload: { value, expectedValue: null },
    })));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect(await q("SELECT value FROM custom_field_values WHERE issue_id = $1 AND custom_field_id = $2",
      [fx.issues.p1issue, field.id])).toHaveLength(1);
  });
});
