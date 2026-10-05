import { expect, test } from "vitest";
import { buildChanges, buildPayload, type IntegrationEventRow } from "../src/services/webhookPayload.js";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const changes = [
  { kind: "created", title: "PRIVATE_TITLE" }, { kind: "renamed", title: "PRIVATE_TITLE" },
  { kind: "description", description: "PRIVATE_DESCRIPTION" }, { kind: "labels", labels: ["PRIVATE_LABEL"] },
  { kind: "direction", title: "PRIVATE_EPIC" }, { kind: "priority", from: "low", to: "high", bulk: true },
  { kind: "complexity", from: null, to: "hard" }, { kind: "due", from: null, to: "2026-10-05" },
  { kind: "parent", set: true }, { kind: "status", from: "В работе", to: "Готово", fromId: id, toId: other, bulk: true },
  { kind: "assigneeAdded", name: "PRIVATE_PERSON_NAME", userId: id }, { kind: "assigneeRemoved", name: "PRIVATE_PERSON_NAME", userId: other },
  { kind: "assigneeBulk", cleared: true, userId: null }, { kind: "checklistAdded", text: "PRIVATE_CHECKLIST" },
  { kind: "checklistRemoved" }, { kind: "link", type: "blocks", key: "CORP-2" },
];
const row: IntegrationEventRow = { id: "123", event_id: id, type: "issue.updated", project_id: other,
  issue_id: id, issue_key: "CORP-1", actor_id: other, occurred_at: "2026-10-05T04:00:00.000Z", changes,
  data: { title: "PRIVATE_TITLE", body: "PRIVATE_COMMENT", token: "PRIVATE_TOKEN" } };
const ctx = { instanceName: "Taskira", appBaseUrl: "https://taskira.example/", projectKey: "CORP", actorUsername: "operator", actorSource: "local" };

test("every history kind maps to the thin public fields in stable order", () => {
  expect(buildChanges(changes)).toEqual([
    { field: "title" }, { field: "description" }, { field: "labels" }, { field: "epicId" },
    { field: "priority", from: "low", to: "high", bulk: true }, { field: "complexity", from: null, to: "hard" },
    { field: "dueDate", from: null, to: "2026-10-05" }, { field: "parentId", set: true },
    { field: "status", from: { id, name: "В работе" }, to: { id: other, name: "Готово" }, bulk: true },
    { field: "assignees", added: [id] }, { field: "assignees", removed: [other] },
    { field: "assignees", cleared: true, userId: null }, { field: "checklist" }, { field: "checklist" },
    { field: "links", type: "blocks", key: "CORP-2" },
  ]);
});
test("unknown or malformed history is ignored and legacy IDs remain nullable", () => {
  expect(buildChanges([{ kind: "unknown", text: "private" }, { kind: "priority", from: "invalid", to: "high" }, null,
    { kind: "status", from: "A", to: "B" }, { kind: "assigneeAdded", name: "private" }])).toEqual([
    { field: "status", from: { id: null, name: "A" }, to: { id: null, name: "B" } }, { field: "assignees", added: [] },
  ]);
});
test("payload snapshot is deterministic and recursively excludes task content", () => {
  const payload = buildPayload(row, ctx);
  const scan = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { expect(["title", "description", "text", "body"]).not.toContain(key); scan(child); }
  };
  scan(payload);
  expect(JSON.stringify(payload)).not.toContain("PRIVATE_");
  expect(Object.keys(payload)).toEqual(["version", "id", "sequence", "type", "occurredAt", "instance", "project", "issue", "actor", "changes", "data"]);
  expect(payload).toEqual({ version: 1, id, sequence: 123, type: "issue.updated", occurredAt: "2026-10-05T04:00:00.000Z",
    instance: { name: "Taskira", url: "https://taskira.example" }, project: { id: other, key: "CORP" },
    issue: { id, key: "CORP-1", url: "https://taskira.example/p/CORP/issue/CORP-1" },
    actor: { id: other, username: "operator", kind: "user" }, changes: buildChanges(changes), data: {} });
  expect(JSON.stringify(buildPayload(row, ctx))).toBe(JSON.stringify(payload));
});
test("only comment ID or due date reaches event data, and due events have no actor", () => {
  expect(buildPayload({ ...row, type: "issue.commented", data: { commentId: id, body: "private" } }, ctx).data).toEqual({ commentId: id });
  const due = buildPayload({ ...row, type: "issue.due", data: { dueDate: "2026-10-05", body: "private" } }, ctx);
  expect(due.actor).toBeNull(); expect(due.data).toEqual({ dueDate: "2026-10-05" });
  expect(buildPayload({ ...row, type: "ping", issue_id: null, data: { webhookId: id } }, ctx)).toMatchObject({ issue: null, data: {} });
});
test("service actors and absent base URL retain the public shape", () => {
  expect(buildPayload(row, { ...ctx, actorSource: "service", appBaseUrl: null })).toMatchObject({ actor: { kind: "service" }, instance: { url: null }, issue: { url: null } });
});
