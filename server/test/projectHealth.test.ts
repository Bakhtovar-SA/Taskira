import { expect, test } from "vitest";
import { projectHealth } from "../src/services/projectHealth.js";
const today = "2026-10-01";
test.each([
  [1, 0, 0, "2026-09-01", "completed"],
  [10, 1, 0, "2026-09-30", "overdue"],
  [0, 0, 0, null, "noDate"],
  [0, 0, 0, "2026-10-16", "onTrack"],
  [0, 0, 0, "2026-10-15", "atRisk"],
  [0, 0, 0, "2026-09-30", "atRisk"],
  [100, 21, 0, "2026-10-15", "atRisk"],
  [100, 20, 0, "2026-10-15", "onTrack"],
  [100, 21, 0, "2026-10-16", "onTrack"],
  [4, 4, 0, null, "noDate"], [4, 4, 1, null, "atRisk"],
  [8, 8, 1, null, "noDate"], [8, 8, 2, null, "atRisk"],
  [12, 12, 2, null, "noDate"], [12, 12, 3, null, "atRisk"],
  [100, 100, 24, null, "noDate"], [100, 100, 25, null, "atRisk"],
  [4, 4, 4, null, "atRisk"],
] as const)("health total=%i open=%i overdue=%i target=%s → %s", (total, open, overdue, targetDate, result) => {
  expect(projectHealth({ total, open, overdue, targetDate, today })).toBe(result);
});
