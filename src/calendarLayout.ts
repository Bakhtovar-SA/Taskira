/** Calendar dates use civil dates, without UTC/local timezone conversion. */
import type { Issue } from "./types";
export type CalendarMode = "month" | "week";
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const dateOf = (iso: string) => new Date(`${iso}T12:00:00`);
export function shiftDay(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const monday = (iso: string) => shiftDay(iso, -((dateOf(iso).getDay() + 6) % 7));
export function periodDays(date: string, mode: CalendarMode): string[] {
  const start = monday(mode === "month" ? `${date.slice(0, 7)}-01` : date);
  return Array.from({ length: mode === "month" ? 42 : 7 }, (_, i) => shiftDay(start, i));
}
export function movePeriod(date: string, mode: CalendarMode, dir: number): string {
  if (mode === "week") return shiftDay(date, 7 * dir);
  const d = dateOf(`${date.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + dir);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
const priority = { critical: 0, high: 1, medium: 2, low: 3 };
export function issuesByDay(issues: Issue[]): Map<string, Issue[]> {
  const days = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.dueDate) continue;
    const list = days.get(i.dueDate) ?? [];
    list.push(i); days.set(i.dueDate, list);
  }
  for (const list of days.values()) list.sort((a, b) => priority[a.priorityId] - priority[b.priorityId] || a.key.localeCompare(b.key, undefined, { numeric: true }));
  return days;
}
export const hiddenCount = (count: number, mode: CalendarMode) => mode === "month" ? Math.max(0, count - 3) : 0;
