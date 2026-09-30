import { expect, test } from "vitest";
import { boardMoveRows } from "./boardMoves";
import type { Issue } from "./types";

const issue = (id: string, rank: number, rest: Partial<Issue> = {}) => ({ id, rank, statusId: "s1", dueDate: "2026-09-28", doneAt: null, archivedAt: null, ...rest }) as Issue;
const options = { overdueOnly: true, doneStatus: false, today: "2026-09-30" };

test("same-column move under overdue filtering only repositions the moved card", () => {
  const rows = [issue("a", 30), issue("moved", 40), issue("b", 10), issue("c", 20)];
  const updated = issue("moved", 15);
  const result = boardMoveRows(rows, new Map([[updated.id, updated]]), "s1", new Map([[updated.id, "s1"]]), options);
  expect(result.map(i => i.id)).toEqual(["moved", "a", "b", "c"]);
  expect(result.filter(i => i.id !== "moved")).toEqual([rows[0], rows[2], rows[3]]);
  expect(result[0]).toBe(updated);
});

test("overdue projection excludes missing, today's and future deadlines, archived rows and done statuses", () => {
  const rows = [issue("past", 1), issue("none", 2, { dueDate: null }), issue("today", 3, { dueDate: options.today }), issue("future", 4, { dueDate: "2026-10-01" }), issue("archived", 5, { archivedAt: 1 })];
  const cached = new Map(rows.map(i => [i.id, i]));
  const moves = new Map(rows.map(i => [i.id, "s1"]));
  expect(boardMoveRows([], cached, "s1", moves, options).map(i => i.id)).toEqual(["past"]);
  expect(boardMoveRows([], cached, "s1", moves, { ...options, doneStatus: true })).toEqual([]);
});

test("failed/unconfirmed transitions cannot introduce a card into the destination", () => {
  const row = issue("moved", 1);
  expect(boardMoveRows([], new Map([[row.id, row]]), "s2", new Map([[row.id, "s2"]]), options)).toEqual([]);
});
