/**
 * Правка полей задачи (PATCH /issues/:id): сравнение с текущими значениями, запись полей и
 * исполнителей одним коммитом, история, отмена для «только убрали» и уведомления.
 * Маршрут проверяет право и схему тела, пишет аудит и собирает ответ.
 */
import type { PoolClient } from "pg";
import type { z } from "zod";
import { q, withTransaction } from "../db.js";
import { notFound } from "../middleware.js";
import type { AccessRole } from "../permissions.js";
import type { ActivityEvent, ComplexityId, IssuePatchBody, IssueUndoDto, PriorityId } from "../contract.js";
import {
  assignParentLocked,
  assertIssueWriteVersion,
  assertSelfAssignment,
  findIssueInProject,
  ISSUE_VERSION_SQL,
  listAssigneeIds,
  loadIssue,
  loadIssueForUpdate,
  logActivity,
  setAssignees,
  validateAssigneesInProject,
  withIssueParentLock,
  type IssueRow,
} from "./issues.js";
import { emit } from "./notify.js";
import { parseMentions, resolveVisibleMentions } from "./mentions.js";
import type { ProjectRow } from "./project.js";

type PatchBody = z.infer<typeof IssuePatchBody>;

export interface IssuePatchResult {
  /** true — ни одно поле не изменилось: проверена только версия, аудит и уведомления не нужны. */
  noop: boolean;
  /** Задача до правки. */
  issue: IssueRow;
  /** Задача после правки. */
  row: IssueRow;
  assigneeIds: string[];
  addedAssigneeIds: string[];
  undo?: IssueUndoDto;
}

export async function patchIssue(project: ProjectRow, id: string, body: PatchBody, actor: { id: string; role: AccessRole | null | undefined }): Promise<IssuePatchResult> {
  const iss = await loadIssue(project.id, id);
  const beforeAssigneeIds = await listAssigneeIds(iss.id);

  // Дедуп сразу — и для валидации, и для diff/записи ниже используем одно
  // и то же нормализованное значение (см. аналогичный комментарий в POST /issues).
  const newAssigneeIds = body.assigneeIds !== undefined ? [...new Set(body.assigneeIds)] : undefined;
  if (newAssigneeIds !== undefined && actor.role === "employee") assertSelfAssignment(actor.id, beforeAssigneeIds, newAssigneeIds);
  if (newAssigneeIds !== undefined) await validateAssigneesInProject(project.id, newAssigneeIds);
  if (body.epicId !== undefined && body.epicId !== null) {
    const e = await findIssueInProject(project.id, body.epicId);
    if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  };
  const log: ActivityEvent[] = [];

  if (body.title !== undefined && body.title !== iss.title) {
    push("title", body.title);
    log.push({ kind: "renamed" });
  }
  if (body.description !== undefined && body.description !== iss.description) {
    push("description", body.description);
    log.push({ kind: "description" });
  }
  if (body.priorityId !== undefined && body.priorityId !== iss.priority_id) {
    push("priority_id", body.priorityId);
    log.push({ kind: "priority", from: iss.priority_id as PriorityId, to: body.priorityId });
  }
  // Исполнители (миграция 025) — не колонка issues, отдельная запись в
  // issue_assignees ниже, после того как известно, действительно ли
  // список изменился (added/removed для activity/уведомлений).
  let addedAssigneeIds: string[] = [];
  let removedAssigneeIds: string[] = [];
  if (newAssigneeIds !== undefined) {
    const beforeSet = new Set(beforeAssigneeIds);
    const afterSet = new Set(newAssigneeIds);
    addedAssigneeIds = newAssigneeIds.filter((x) => !beforeSet.has(x));
    removedAssigneeIds = beforeAssigneeIds.filter((x) => !afterSet.has(x));
    if (addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0) {
      const names = await q<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...addedAssigneeIds, ...removedAssigneeIds],
      ]);
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      for (const uid of addedAssigneeIds) log.push({ kind: "assigneeAdded", name: nameOf.get(uid) ?? "?", userId: uid });
      for (const uid of removedAssigneeIds) log.push({ kind: "assigneeRemoved", name: nameOf.get(uid) ?? "?", userId: uid });
    }
  }
  if (body.epicId !== undefined && body.epicId !== iss.epic_id) {
    push("epic_id", body.epicId);
    log.push({ kind: "direction" });
  }
  // parentChanging — parentId реально меняется (не просто прислан тем же
  // значением). newParentId — ветка назначения НОВОГО родителя (нужна
  // повторная валидация под локом в assignParentLocked); isUnsettingParent —
  // ветка снятия (парentId → null; инвариант глубины она не затрагивает,
  // но собственный лок всё равно нужен — см. withIssueParentLock ниже).
  const parentChanging = body.parentId !== undefined && body.parentId !== iss.parent_id;
  const newParentId = parentChanging && body.parentId !== null ? body.parentId : null;
  const isUnsettingParent = parentChanging && body.parentId === null;
  if (parentChanging) {
    push("parent_id", body.parentId);
    log.push({ kind: "parent", set: !!body.parentId });
  }
  if (body.labels !== undefined && JSON.stringify(body.labels) !== JSON.stringify(iss.labels)) {
    push("labels", body.labels);
    log.push({ kind: "labels" });
  }
  if (body.complexity !== undefined && body.complexity !== iss.complexity) {
    push("complexity", body.complexity);
    log.push({ kind: "complexity", from: (iss.complexity as ComplexityId | null) ?? null, to: body.complexity });
  }
  if (body.dueDate !== undefined && body.dueDate !== iss.due_date) {
    push("due_date", body.dueDate);
    log.push({ kind: "due", from: iss.due_date ?? null, to: body.dueDate ?? null });
  }
  if (body.tStart !== undefined) push("t_start", body.tStart);
  if (body.tSpan !== undefined) push("t_span", body.tSpan);
  if (body.color !== undefined) push("color", body.color);

  // Исполнители — отдельная таблица (миграция 025), не участвуют в sets
  // (issues-колонках), поэтому "пустой патч" проверяем по обоим сразу.
  if (sets.length === 0 && newAssigneeIds === undefined) {
    const current = await withTransaction(async client => {
      const locked = await loadIssueForUpdate(client, project.id, id, body.expectedUpdatedAt);
      assertIssueWriteVersion(locked, body.expectedVersion);
      return locked;
    });
    return { noop: true, issue: iss, row: current, assigneeIds: beforeAssigneeIds, addedAssigneeIds: [] };
  }

  let updateSql: string | null = null;
  if (sets.length > 0) {
    vals.push(iss.id);
    updateSql = `UPDATE issues SET ${sets.join(", ")}, updated_at = ${ISSUE_VERSION_SQL} WHERE id = $${vals.length} RETURNING *`;
  }
  const mutate = async (client: PoolClient): Promise<{ row: IssueRow; undo?: IssueUndoDto }> => {
    const previous = await loadIssueForUpdate(client, project.id, id, body.expectedUpdatedAt);
    assertIssueWriteVersion(previous, body.expectedVersion);
    const previousAssignees = newAssigneeIds !== undefined
      ? (await client.query<{ user_id: string }>("SELECT user_id FROM issue_assignees WHERE issue_id = $1 ORDER BY added_at, user_id", [id])).rows.map(item => item.user_id)
      : [];
    const row = updateSql ? (await client.query<IssueRow>(updateSql, vals)).rows[0] : previous;
    if (newAssigneeIds !== undefined) {
      const assignedAt = await setAssignees(iss.id, newAssigneeIds, actor.id, client, actor.role === "employee");
      if (assignedAt) row.updated_at = assignedAt;
    }
    for (const event of log) await logActivity(iss.id, actor.id, event, client);
    // Offer undo only for removal-only writes, using the actual locked values, never the outer read/UI snapshot.
    const onlyRemovalFields = Object.keys(body).every(key => ["labels", "assigneeIds", "expectedUpdatedAt", "expectedVersion"].includes(key));
    const noAdditions = (next: string[] | undefined, before: string[]) => !next || next.every(value => before.includes(value));
    const removed = (next: string[] | undefined, before: string[]) => next !== undefined && before.some(value => !next.includes(value));
    const labelsRemoved = removed(body.labels, previous.labels) && JSON.stringify(row.labels) === JSON.stringify(body.labels);
    const assigneesRemoved = removed(newAssigneeIds, previousAssignees);
    const undo = onlyRemovalFields && noAdditions(body.labels, previous.labels) && noAdditions(newAssigneeIds, previousAssignees) && (labelsRemoved || assigneesRemoved)
      ? { issueId: id, ...(labelsRemoved ? { labels: previous.labels } : {}), ...(assigneesRemoved ? { assigneeIds: previousAssignees } : {}), updatedAt: new Date(row.updated_at).toISOString() }
      : undefined;
    return { row, ...(undo ? { undo } : {}) };
  };
  // Поля задачи, полный список исполнителей и activity фиксируются одним
  // коммитом; parent-ветки дополнительно используют прежние advisory locks.
  const { row, undo } = newParentId
    ? await assignParentLocked(project.id, newParentId, iss.id, mutate)
    : isUnsettingParent
      ? await withIssueParentLock(iss.id, mutate)
      : await withTransaction(mutate);
  return { noop: false, issue: iss, row, assigneeIds: newAssigneeIds ?? beforeAssigneeIds, addedAssigneeIds, ...(undo ? { undo } : {}) };
}

/** Уведомления после успешной правки: новым исполнителям и новым упоминаниям в описании. */
export async function notifyIssuePatched(projectId: string, actorId: string, body: PatchBody, result: IssuePatchResult): Promise<void> {
  if (result.addedAssigneeIds.length > 0 && body.expectedUpdatedAt === undefined) {
    await emit({
      type: "issue.assigned",
      actorId: actorId,
      projectId: projectId,
      issueId: result.issue.id,
      recipientIds: result.addedAssigneeIds,
      payload: { key: result.issue.key, title: result.row.title },
    });
  }
  if (body.description !== undefined && body.description !== result.issue.description) {
    // Уведомляем только НОВЫЕ упоминания — правка описания (фикс опечатки)
    // не должна повторно пинговать уже упомянутых (review PR #19).
    const was = new Set(parseMentions(result.issue.description));
    const added = parseMentions(body.description).filter((l) => !was.has(l));
    const mentionIds = await resolveVisibleMentions(projectId, result.issue.id, added);
    if (mentionIds.length > 0) {
      await emit({
        type: "issue.mention",
        actorId: actorId,
        projectId: projectId,
        issueId: result.issue.id,
        recipientIds: mentionIds,
        payload: { key: result.issue.key, title: result.row.title, in: "description" },
      });
    }
  }
}
