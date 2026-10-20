import { freshRows } from "./issuePages";
import type { Issue } from "./types";
import type { IssueFilterParams } from "./api";
import { DONE_WINDOW_DAYS } from "./boardFilters";

/** Bridge confirmed local moves while the paginated columns revalidate.
 * Only moves made in the current board query can introduce a row; unrelated
 * cached issues must never bypass the server's search/assignee filters. */
export function boardMoveRows(
  items: Issue[], byId: ReadonlyMap<string, Issue>, statusId: string,
  moves: ReadonlyMap<string, string>,
  { overdueOnly, doneStatus, today = new Date().toISOString().slice(0, 10), closed, closedDays = DONE_WINDOW_DAYS, now = Date.now() }: { overdueOnly: boolean; doneStatus: boolean; today?: string; closed?: IssueFilterParams["closed"]; closedDays?: number; now?: number },
): Issue[] {
  const visible = (i: Issue) => i.statusId === statusId && i.archivedAt == null &&
    (!overdueOnly || (!doneStatus && !!i.dueDate && i.dueDate < today));
  // Server rows stay authoritative. Only locally introduced rows need a window decision
  // while recent/older pages revalidate independently (a rank move must not duplicate an old card).
  const acceptsIncoming = (issue: Issue) => {
    if (!doneStatus || !closed) return true;
    if (closed === "hide") return false;
    const older = issue.doneAt != null && issue.doneAt < now - closedDays * 86_400_000;
    return closed === "older" ? older : !older;
  };
  const rows = freshRows(items, byId).filter(visible);
  const ids = new Set(rows.map(i => i.id));
  for (const [id, target] of moves) {
    const issue = byId.get(id);
    if (target === statusId && issue && visible(issue) && acceptsIncoming(issue) && !ids.has(id)) {
      rows.push(issue);
      ids.add(id);
    }
  }
  // Board queries use rank. Reposition only moved rows using the authoritative
  // transition rank; retain the server's relative order for every other row.
  const moved = rows.filter(i => moves.get(i.id) === statusId).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const ordered = rows.filter(i => moves.get(i.id) !== statusId);
  for (const issue of moved) {
    const before = ordered.findIndex(i => (i.rank ?? 0) > (issue.rank ?? 0));
    ordered.splice(before < 0 ? ordered.length : before, 0, issue);
  }
  return ordered;
}
