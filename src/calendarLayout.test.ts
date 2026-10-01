import { expect, test } from "vitest";
import { hiddenCount, issuesByDay, monday, movePeriod, periodDays, shiftDay } from "./calendarLayout";
import type { Issue } from "./types";
test("month has six Monday-based weeks including adjacent months", () => {
  const days = periodDays("2026-10-15", "month");
  expect(days).toHaveLength(42);
  expect(days[0]).toBe("2026-09-28");
  expect(days[41]).toBe("2026-11-08");
});
test("weeks and month navigation cross years and leap days", () => {
  expect(periodDays("2027-01-01", "week")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  expect(movePeriod("2026-12-31", "month", 1)).toBe("2027-01-01");
  expect(movePeriod("2027-01-01", "week", -1)).toBe("2026-12-25");
  expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
  expect(monday("2026-10-04")).toBe("2026-09-28");
});
test("groups by due date with critical issues first and computes overflow", () => {
  const issues = [{ id: "a", key: "A-1", priorityId: "low", dueDate: "2026-10-01" }, { id: "b", key: "A-2", priorityId: "critical", dueDate: "2026-10-01" }, { id: "c", dueDate: null }] as Issue[];
  expect([...issuesByDay(issues).values()][0].map(i => i.id)).toEqual(["b", "a"]);
  expect(hiddenCount(7, "month")).toBe(4);
  expect(hiddenCount(7, "week")).toBe(0);
});
