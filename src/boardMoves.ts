import { freshRows } from "./issuePages";
import type { Issue } from "./types";

/** Bridge confirmed local moves while the paginated columns revalidate.
 * Only moves made in the current board query can introduce a row; unrelated
 * cached issues must never bypass the server's search/assignee filters. */
export function boardMoveRows(
  items: Issue[], byId: ReadonlyMap<string, Issue>, statusId: string,
  moves: ReadonlyMap<string, string>, overdueOnly: boolean,
): Issue[] {
  const visible = (i: Issue) => i.statusId === statusId && (!overdueOnly || !i.doneAt);
  const rows = freshRows(items, byId).filter(visible);
  const ids = new Set(rows.map(i => i.id));
  for (const [id, target] of moves) {
    const issue = byId.get(id);
    if (target === statusId && issue && visible(issue) && !ids.has(id)) {
      rows.push(issue);
      ids.add(id);
    }
  }
  // The transition DTO has the authoritative rank, including same-column moves.
  if (rows.some(i => moves.get(i.id) === statusId)) rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return rows;
}
