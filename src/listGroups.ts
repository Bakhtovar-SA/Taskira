import type { Issue } from "./types";

export const GROUP_MODES = ["none", "status", "epic", "assignee"] as const;
export type GroupMode = typeof GROUP_MODES[number];
export const readListGroup = (search: string): GroupMode => {
  const value = new URLSearchParams(search).get("group");
  return GROUP_MODES.includes(value as GroupMode) ? value as GroupMode : "status";
};

/** Group loaded pages without changing server filters/sort or duplicating a multi-assignee task. */
export function groupListRows(rows: Issue[], mode: GroupMode, statusOrder: string[]) {
  const groups = new Map<string, Issue[]>();
  for (const issue of rows) {
    const id = mode === "none" ? "" : mode === "status" ? issue.statusId : mode === "epic" ? issue.epicId ?? "" : [...issue.assigneeIds].sort().join("|");
    const items = groups.get(id) ?? [];
    items.push(issue); groups.set(id, items);
  }
  const result = [...groups].map(([id, items]) => ({ id, items }));
  if (mode === "status") result.sort((a, b) => (statusOrder.indexOf(a.id) + 1 || Infinity) - (statusOrder.indexOf(b.id) + 1 || Infinity));
  return result;
}
