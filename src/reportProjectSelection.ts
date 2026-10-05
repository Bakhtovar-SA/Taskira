/** GET report filters must fit nginx's request line; null represents all visible projects. */
export const REPORT_PROJECT_LIMIT = 150;
export function selectReportProject(current: string[] | null, available: string[], id: string, checked: boolean): string[] | null {
  const ids = current ?? available;
  const next = checked ? [...ids, id] : ids.filter(value => value !== id);
  if (next.length > REPORT_PROJECT_LIMIT) return current;
  return next.length === available.length ? null : next;
}
