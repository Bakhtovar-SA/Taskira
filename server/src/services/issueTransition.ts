import { withTransaction } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { assertTransition, conflict } from "./workflow.js";
import { computeRank, lockRankColumn } from "./rank.js";
import { logActivity, type IssueRow } from "./issues.js";

/** Lock columns in sorted order BEFORE rows (including rows touched by rebalance).
 * Recheck the source after locking: a concurrent move must never validate an old edge. */
export async function transitionIssue(
  projectId: string, issueId: string, toStatusId: string, beforeId: string | null,
  actorId: string, reorder = true,
) {
  return withTransaction(async (client) => {
    const observed = (await client.query<{ status_id: string }>(
      `SELECT status_id FROM issues WHERE id = $1 AND project_id = $2`, [issueId, projectId],
    )).rows[0];
    if (!observed) throw notFound("Задача не найдена");
    for (const statusId of [...new Set([observed.status_id, toStatusId])].sort()) {
      await lockRankColumn(client, statusId);
    }
    const previous = (await client.query<IssueRow>(
      `SELECT * FROM issues WHERE id = $1 AND project_id = $2 FOR UPDATE`, [issueId, projectId],
    )).rows[0];
    if (!previous) throw notFound("Задача не найдена");
    if (previous.status_id !== observed.status_id) {
      throw conflict("Статус задачи изменился. Обновите задачу и повторите переход");
    }
    await assertTransition(projectId, previous.status_id, toStatusId, client);
    if (beforeId) {
      const anchor = (await client.query<{ status_id: string }>(
        `SELECT status_id FROM issues WHERE id = $1 AND project_id = $2`, [beforeId, projectId],
      )).rows[0];
      if (!anchor) throw notFound("Задача-ориентир (beforeId) не найдена");
      if (anchor.status_id !== toStatusId) throw badRequest("Позиция «перед» указывает на задачу из другой колонки");
    }
    const changed = previous.status_id !== toStatusId;
    const statuses = (await client.query<{ id: string; name: string; category: string }>(
      `SELECT id, name, category FROM workflow_statuses WHERE id = ANY($1::uuid[])`,
      [[previous.status_id, toStatusId]],
    )).rows;
    const from = statuses.find((s) => s.id === previous.status_id)!.name;
    const target = statuses.find((s) => s.id === toStatusId)!;
    if (!changed && !reorder) return { previous, row: previous, changed, from, to: target.name };
    const rank = await computeRank(client, projectId, toStatusId, beforeId, issueId);
    const row = (await client.query<IssueRow>(
      `UPDATE issues SET status_id = $1, rank = $2, updated_at = now(),
          done_at = CASE WHEN $4 THEN COALESCE(done_at, now()) ELSE NULL END,
          archived_at = CASE WHEN $4 THEN archived_at ELSE NULL END
        WHERE id = $3 RETURNING *`, [toStatusId, rank, issueId, target.category === "done"],
    )).rows[0];
    if (changed) await logActivity(issueId, actorId, {
      kind: "status", from, to: target.name, fromId: previous.status_id, toId: toStatusId,
      ...(!reorder ? { bulk: true } : {}),
    }, client);
    return { previous, row, changed, from, to: target.name };
  });
}
