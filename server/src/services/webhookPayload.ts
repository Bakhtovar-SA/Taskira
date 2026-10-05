/** Тонкое тело вебхука: только явно разрешённые поля, без содержимого задач и комментариев. */
import { ActivityEvent } from "../contract.js";

export interface IntegrationEventRow {
  id: string; event_id: string; type: string; project_id: string;
  issue_id: string | null; issue_key: string | null; actor_id: string | null;
  occurred_at: Date | string; changes: unknown[]; data: Record<string, unknown>;
}
export interface PayloadContext {
  instanceName: string; appBaseUrl: string | null; projectKey: string;
  actorUsername: string | null; actorSource: string | null;
}

export function buildChanges(changes: unknown[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const raw of changes) {
    const parsed = ActivityEvent.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    let change: Record<string, unknown>;
    switch (e.kind) {
      case "created": continue;
      case "renamed": change = { field: "title" }; break;
      case "description": change = { field: "description" }; break;
      case "labels": change = { field: "labels" }; break;
      case "direction": change = { field: "epicId" }; break;
      case "priority": case "complexity": change = { field: e.kind, from: e.from, to: e.to }; break;
      case "due": change = { field: "dueDate", from: e.from, to: e.to }; break;
      case "parent": change = { field: "parentId", set: e.set }; break;
      case "status": change = { field: "status", from: { id: e.fromId ?? null, name: e.from }, to: { id: e.toId ?? null, name: e.to } }; break;
      case "assigneeAdded": change = { field: "assignees", added: e.userId ? [e.userId] : [] }; break;
      case "assigneeRemoved": change = { field: "assignees", removed: e.userId ? [e.userId] : [] }; break;
      case "assigneeBulk": change = { field: "assignees", cleared: e.cleared, userId: e.userId ?? null }; break;
      case "checklistAdded": case "checklistRemoved": change = { field: "checklist" }; break;
      case "link": change = { field: "links", type: e.type, key: e.key }; break;
    }
    if ("bulk" in e && e.bulk === true) change.bulk = true;
    result.push(change);
  }
  return result;
}

export function buildPayload(row: IntegrationEventRow, ctx: PayloadContext) {
  const base = ctx.appBaseUrl?.replace(/\/+$/, "") || null;
  const data = row.type === "issue.commented" && typeof row.data.commentId === "string" ? { commentId: row.data.commentId }
    : row.type === "issue.due" && typeof row.data.dueDate === "string" ? { dueDate: row.data.dueDate } : {};
  return {
    version: 1, id: row.event_id, sequence: Number(row.id), type: row.type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    instance: { name: ctx.instanceName, url: base },
    project: { id: row.project_id, key: ctx.projectKey },
    issue: row.issue_id && row.issue_key ? { id: row.issue_id, key: row.issue_key,
      url: base ? `${base}/p/${encodeURIComponent(ctx.projectKey)}/issue/${encodeURIComponent(row.issue_key)}` : null } : null,
    actor: row.type !== "issue.due" && row.actor_id ? { id: row.actor_id, username: ctx.actorUsername,
      kind: ctx.actorSource === "service" ? "service" : "user" } : null,
    changes: buildChanges(Array.isArray(row.changes) ? row.changes : []), data,
  };
}
