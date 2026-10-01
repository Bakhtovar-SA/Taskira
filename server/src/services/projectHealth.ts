/** One ordered rule for all portfolio widgets; today is supplied by CURRENT_DATE. */
export type ProjectHealth = "completed" | "overdue" | "atRisk" | "onTrack" | "noDate";
export function projectHealth({ total, open, overdue, targetDate, today }: { total: number; open: number; overdue: number; targetDate: string | null; today: string }): ProjectHealth {
  if (total > 0 && open === 0) return "completed";
  if (targetDate && targetDate < today && open > 0) return "overdue";
  const until = targetDate ? Math.round((Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5) : null;
  if ((until !== null && until <= 14 && (total === 0 || (total - open) * 5 < total * 4)) || (open > 0 && overdue * 4 >= open)) return "atRisk";
  return targetDate ? "onTrack" : "noDate";
}
