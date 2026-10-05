import { describe, expect, it } from "vitest";
import { groupListRows, readListGroup } from "./listGroups";
import type { Issue } from "./types";

describe("list grouping", () => {
  const rows = [
    { id: "a", statusId: "review", assigneeIds: ["u2", "u1"], epicId: null },
    { id: "b", statusId: "todo", assigneeIds: ["u1", "u2"], epicId: "epic" },
    { id: "c", statusId: "unknown", assigneeIds: [], epicId: null },
    { id: "d", statusId: "review", assigneeIds: ["u1"], epicId: "epic" },
  ] as Issue[];
  it("uses workflow order, retains unknown statuses and server order within groups", () => {
    expect(groupListRows(rows, "status", ["todo", "review"]).map(g => g.items.map(i => i.id))).toEqual([["b"], ["a", "d"], ["c"]]);
  });
  it("groups the same assignment set once, without mutating assignees", () => {
    const groups = groupListRows(rows, "assignee", []);
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(rows[0].assigneeIds).toEqual(["u2", "u1"]);
    expect(groups.flatMap(g => g.items)).toHaveLength(rows.length);
  });
  it("restores explicit grouping and falls back safely for missing or invalid links", () => {
    expect(readListGroup("?group=none&q=foo")).toBe("none");
    expect(readListGroup("?group=epic")).toBe("epic");
    expect(readListGroup("?group=invalid")).toBe("status");
    expect(readListGroup("")).toBe("status");
  });
});
