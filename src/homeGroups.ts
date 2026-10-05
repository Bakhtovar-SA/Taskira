import type { AssignedIssue } from "./types";
import { localToday, monday, shiftDay } from "./calendarLayout";
export type HomeGroup = "overdue" | "week" | "review" | "rework" | "other";
export function homeGroup(issue: AssignedIssue, admin: boolean, now = localToday()): HomeGroup {
  if (issue.dueDate && issue.dueDate < now) return "overdue";
  if (issue.dueDate && issue.dueDate <= shiftDay(monday(now), 6)) return "week";
  if (issue.statusSid === "review" && (admin || issue.projectRole === "manager")) return "review";
  if ((issue.statusSid === "rework" || issue.returnedForRework) && !admin && issue.projectRole === "employee") return "rework";
  return "other";
}
