import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { withClient } from "../src/db.js";
import { IssueMutationResultDto, BulkIssueResultDto } from "../src/contract.js";
import { ISSUE_VERSION_SQL, setAssignees } from "../src/services/issues.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
let admin: string;
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); admin = await login(app, "admin"); });
const base = () => "/api/projects/" + fx.projects.p1 + "/issues";
const url = () => base() + "/" + fx.issues.p1issue;
const read = async () => (await app.inject({ url: url(), headers: auth(admin) })).json();
const patch = (body: unknown, token = admin) => app.inject({ method: "PATCH", url: url(), headers: auth(token), payload: body });
const move = (body: unknown, token = admin) => app.inject({ method: "POST", url: url() + "/transition", headers: auth(token), payload: body });

test("transition metadata captures previous status and final version; CAS undo preserves legacy DTO", async () => {
  const before = await read();
  const moved = await move({ to: fx.p1status.inprogress, expectedUpdatedAt: before.updatedAt });
  expect(moved.statusCode).toBe(200);
  const body = IssueMutationResultDto.parse(moved.json());
  expect(body.undo).toEqual({ issueId: before.id, statusId: before.statusId, updatedAt: body.updatedAt });
  expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  const undone = await move({ to: body.undo!.statusId, expectedUpdatedAt: body.undo!.updatedAt });
  expect(undone.statusCode).toBe(200);
  expect(undone.json().statusId).toBe(before.statusId);
});

test("stale transition CAS rejects changed and same-status requests without changing history", async () => {
  const before = await read();
  await patch({ title: "New title" });
  for (const to of [fx.p1status.todo, fx.p1status.inprogress]) {
    const response = await move({ to, expectedUpdatedAt: before.updatedAt });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  }
  expect((await read()).statusId).toBe(before.statusId);
  expect(await q("SELECT id FROM activity WHERE issue_id = $1 AND kind = 'status'", [before.id])).toHaveLength(0);
});

test("PATCH CAS checks a no-op path, rejects malformed tokens, and accepts legacy writes", async () => {
  const before = await read();
  const newer = await patch({ title: "New title" });
  expect(newer.statusCode).toBe(200);
  const stale = await patch({ title: "New title", expectedUpdatedAt: before.updatedAt });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe("CONFLICT");
  expect((await patch({ title: "Other", expectedUpdatedAt: "invalid" })).statusCode).toBe(400);
  expect((await patch({ expectedUpdatedAt: newer.json().updatedAt })).statusCode).toBe(400);
  expect((await patch({ title: "Legacy" })).statusCode).toBe(200);
});

test("two concurrent PATCH writes with the same version cannot both win", async () => {
  const before = await read();
  const responses = await Promise.all([patch({ title: "First", expectedUpdatedAt: before.updatedAt }), patch({ title: "Second", expectedUpdatedAt: before.updatedAt })]);
  expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
});

test("labels and assignees pure removals return actual previous arrays and final version", async () => {
  await patch({ labels: ["keep", "remove"], assigneeIds: [fx.users.emp1, fx.users.mgr1] });
  const before = await read();
  const removed = await patch({ labels: ["keep"], assigneeIds: [fx.users.emp1] });
  expect(removed.statusCode).toBe(200);
  const body = IssueMutationResultDto.parse(removed.json());
  expect(body.undo?.labels).toEqual(["keep", "remove"]);
  expect(body.undo?.assigneeIds?.sort()).toEqual([fx.users.emp1, fx.users.mgr1].sort());
  expect(body.undo?.updatedAt).toBe(body.updatedAt);
  expect(body.undo?.issueId).toBe(before.id);
  const restored = await patch({ labels: body.undo!.labels, assigneeIds: body.undo!.assigneeIds, expectedUpdatedAt: body.undo!.updatedAt });
  expect(restored.statusCode).toBe(200);
  expect(restored.json().undo).toBeUndefined(); // restoration adds values, never creates another removal undo
});

test("assignment-only changes bump version; equal membership does not, and creation returns the final version", async () => {
  const before = await read();
  const removed = await patch({ assigneeIds: [] });
  expect(removed.statusCode).toBe(200);
  expect(new Date(removed.json().updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  expect((await patch({ assigneeIds: [fx.users.emp1], expectedUpdatedAt: before.updatedAt })).statusCode).toBe(409);
  const unchanged = await patch({ assigneeIds: [] });
  expect(unchanged.json().updatedAt).toBe(removed.json().updatedAt);
  expect(unchanged.json().undo).toBeUndefined();
  const created = await app.inject({ method: "POST", url: base(), headers: auth(admin), payload: { title: "Assigned", typeId: "task", priorityId: "medium", assigneeIds: [fx.users.emp1], epicId: null, complexity: null } });
  expect(created.statusCode).toBe(201);
  const fetched = await app.inject({ url: base() + "/" + created.json().id, headers: auth(admin) });
  expect(created.json().updatedAt).toBe(fetched.json().updatedAt);
});

test.each([
  { labels: ["keep", "added"] },
  { labels: [], title: "Also renamed" },
])("PATCH does not offer undo for additions or mixed edits %j", async body => {
  await patch({ labels: ["keep", "remove"] });
  const response = await patch(body);
  expect(response.statusCode).toBe(200);
  expect(response.json().undo).toBeUndefined();
});

test("stale removal undo cannot overwrite later changes, including bulk assignment", async () => {
  await patch({ labels: ["keep", "remove"] });
  const removed = (await patch({ labels: ["keep"] })).json();
  const assigned = await app.inject({ method: "PATCH", url: base() + "/bulk", headers: auth(admin), payload: { action: "assignee", issueIds: [fx.issues.p1issue], assigneeId: fx.users.mgr1 } });
  expect(assigned.statusCode).toBe(200);
  const response = await patch({ labels: removed.undo.labels, expectedUpdatedAt: removed.undo.updatedAt });
  expect(response.statusCode).toBe(409);
  expect((await read()).labels).toEqual(["keep"]);
});

test("Undo still checks permission and workflow; no-op transition has no undo", async () => {
  const viewer = await login(app, "viw1");
  const before = await read();
  expect((await patch({ labels: [], expectedUpdatedAt: before.updatedAt }, viewer)).statusCode).toBe(403);
  expect((await move({ to: fx.p1status.inprogress, expectedUpdatedAt: before.updatedAt }, viewer)).statusCode).toBe(403);
  const noOp = await move({ to: fx.p1status.todo, expectedUpdatedAt: before.updatedAt });
  expect(noOp.statusCode).toBe(200); expect(noOp.json().undo).toBeUndefined();
  const current = await read();
  await q("DELETE FROM workflow_transitions WHERE project_id = $1 AND from_status_id = $2 AND to_status_id = $3", [fx.projects.p1, fx.p1status.todo, fx.p1status.inprogress]);
  expect((await move({ to: fx.p1status.inprogress, expectedUpdatedAt: current.updatedAt })).statusCode).toBe(409);
});

test("bulk status undo contains only successful changed rows, never no-op or failed IDs", async () => {
  const created = await app.inject({ method: "POST", url: base(), headers: auth(admin), payload: { title: "Already there", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, complexity: null, statusId: fx.p1status.inprogress } });
  const same = created.json().id;
  const missing = "99999999-9999-4999-8999-999999999999";
  const response = await app.inject({ method: "PATCH", url: base() + "/bulk", headers: auth(admin), payload: { action: "status", issueIds: [fx.issues.p1issue, same, missing], statusId: fx.p1status.inprogress } });
  expect(response.statusCode).toBe(200);
  const body = BulkIssueResultDto.parse(response.json());
  expect(body.succeeded.sort()).toEqual([fx.issues.p1issue, same].sort());
  expect(body.failed.map(item => item.issueId)).toEqual([missing]);
  const current = await read();
  expect(body.undo).toEqual([{ issueId: fx.issues.p1issue, statusId: fx.p1status.todo, updatedAt: current.updatedAt }]);
});

// Force the request's outer read to be stale while its actual mutation waits for the issue lock.
test.each(["labels", "assignees"])("removal metadata uses locked previous %s rather than the early read", async field => {
  await patch({ labels: ["keep", "old"] });
  await withClient(async gate => {
    await gate.query("BEGIN");
    await gate.query("SELECT id FROM issues WHERE id = $1 FOR UPDATE", [fx.issues.p1issue]);
    const pending = patch(field === "labels" ? { labels: ["keep"] } : { assigneeIds: [] }).then(response => response);
    try {
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [row] = await q<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND pid <> pg_backend_pid()");
        if (row.n > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      if (field === "labels") await gate.query("UPDATE issues SET labels = ARRAY['keep','fresh'], updated_at = " + ISSUE_VERSION_SQL + " WHERE id = $1", [fx.issues.p1issue]);
      else await setAssignees(fx.issues.p1issue, [fx.users.mgr1], fx.users.admin, gate);
      await gate.query("COMMIT");
      const response = await pending;
      expect(response.statusCode).toBe(200);
      const body = IssueMutationResultDto.parse(response.json());
      if (field === "labels") expect(body.undo?.labels).toEqual(["keep", "fresh"]);
      else expect(body.undo?.assigneeIds).toEqual([fx.users.mgr1]);
    } finally {
      await gate.query("ROLLBACK");
      await pending.catch(() => undefined);
    }
  });
});


test("matching version cannot undo an issue archived by maintenance", async () => {
  const moved = (await move({ to: fx.p1status.inprogress })).json();
  const token = moved.undo.updatedAt;
  // This is the existing maintenance write: archived_at changes, updated_at stays untouched.
  await q("UPDATE issues SET archived_at = now() WHERE id = $1", [fx.issues.p1issue]);
  const archived = await read();
  expect(archived.updatedAt).toBe(token);
  expect(archived.archivedAt).not.toBeNull();
  const transition = await move({ to: moved.undo.statusId, expectedUpdatedAt: token });
  const fields = await patch({ labels: ["stale undo"], expectedUpdatedAt: token });
  expect(transition.statusCode).toBe(409); expect(transition.json().error.code).toBe("CONFLICT");
  expect(fields.statusCode).toBe(409); expect(fields.json().error.code).toBe("CONFLICT");
  // The unchanged-label path must also run the shared archived/version check.
  expect((await patch({ labels: archived.labels, expectedUpdatedAt: token })).statusCode).toBe(409);
  const after = await read();
  expect(after.archivedAt).toBe(archived.archivedAt);
  expect(after.statusId).toBe(fx.p1status.inprogress);
  expect(after.labels).toEqual(archived.labels);
});

test.each([false, true])("sprint mutation invalidates an older Undo token (remove=%s)", async remove => {
  const enabled = await app.inject({ method: "PATCH", url: "/api/projects/" + fx.projects.p1, headers: auth(admin), payload: { sprintsEnabled: true } });
  expect(enabled.statusCode).toBe(200);
  const created = await app.inject({ method: "POST", url: "/api/projects/" + fx.projects.p1 + "/sprints", headers: auth(admin), payload: { name: "Undo version" } });
  expect(created.statusCode).toBe(201);
  const sprintId = created.json().id;
  const setSprint = (value: string | null) => app.inject({ method: "PATCH", url: url() + "/sprint", headers: auth(admin), payload: { sprintId: value } });
  if (remove) expect((await setSprint(sprintId)).statusCode).toBe(200);
  const moved = (await move({ to: fx.p1status.inprogress })).json();
  const updated = await setSprint(remove ? null : sprintId);
  expect(updated.statusCode).toBe(200);
  expect(new Date(updated.json().updatedAt).getTime()).toBeGreaterThan(new Date(moved.undo.updatedAt).getTime());
  const rejected = await move({ to: moved.undo.statusId, expectedUpdatedAt: moved.undo.updatedAt });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().error.code).toBe("CONFLICT");
  const unchanged = await setSprint(remove ? null : sprintId);
  expect(unchanged.json().updatedAt).toBe(updated.json().updatedAt);
  expect((await read()).statusId).toBe(fx.p1status.inprogress);
});
