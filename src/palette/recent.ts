import type { StatusCategory } from "../types";

/** Недавно открытые задачи для пустой палитры (ТЗ 5.8 п.4 «недавнее»).
 *  Только localStorage этого браузера — удобство, а не данные: может
 *  вернуться пустым, и палитра без него работает так же. */
export interface RecentIssue {
  id: string;
  projectId: string;
  key: string;
  title: string;
  category: StatusCategory;
}

const KEY = "taskira.recentIssues";
const MAX = 6;

export function readRecent(): RecentIssue[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.key === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: RecentIssue): void {
  try {
    const next = [item, ...readRecent().filter((x) => x.id !== item.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* приватный режим — просто не запомним */
  }
}
