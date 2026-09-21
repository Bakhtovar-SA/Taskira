import type { IssueCounts, IssueFilterParams } from "./api";

/**
 * Фильтры доски → параметры серверного набора (PERF-05, шаг 3).
 *
 * Доска больше не фильтрует «по загруженному»: она видит лишь первые страницы
 * колонок, и клиентский фильтр искал бы только в них. Всё, что раньше делали
 * `visible`/`byStatus`/`hiddenDone` над data.issues, считает сервер; здесь — только
 * перевод состояния UI в запрос и арифметика над ответами `counts`.
 */

export type QuickChip = "mine" | "overdue" | "unassigned";

/** Окно «Готово» доски. Совпадает с `closedDays` сервера по умолчанию (14). */
export const DONE_WINDOW_DAYS = 14;

/** id, которого нет ни у одного пользователя: набор заведомо пуст. */
export const NO_ONE = "00000000-0000-4000-8000-000000000000";

export interface BoardFilterState {
  /** Выбранный аватар: id, "none" (без исполнителя) или null. */
  filterUser: string | null;
  chips: ReadonlySet<QuickChip>;
  /** Текст поиска, уже без лишних пробелов и обрезанный до лимита сервера. */
  q: string;
  currentUserId: string;
}

/**
 * Аватар и чипы «Мои»/«Без исполнителя» раньше складывались через И над
 * загруженными задачами. У сервера один параметр assignee, поэтому условия
 * сводятся к одному значению: одинаковые — это оно же, противоречащие
 * (например, чужой аватар + «Мои») — пустой набор, как и раньше.
 */
export function effectiveAssignee(s: BoardFilterState): string | undefined {
  const wanted = new Set<string>();
  if (s.filterUser) wanted.add(s.filterUser);
  if (s.chips.has("mine")) wanted.add(s.currentUserId);
  if (s.chips.has("unassigned")) wanted.add("none");
  if (wanted.size === 0) return undefined;
  if (wanted.size > 1) return NO_ONE;
  return [...wanted][0];
}

/** Фильтры без статуса и без окна закрытых: общие для колонок и счётчиков. */
export function boardFilterParams(s: BoardFilterState): IssueFilterParams {
  return {
    assignee: effectiveAssignee(s),
    q: s.q || undefined,
    overdue: s.chips.has("overdue") ? "1" : undefined,
  };
}

export function hasBoardFilters(s: BoardFilterState): boolean {
  return !!(s.filterUser || s.chips.size > 0 || s.q);
}

/** Параметры набора карточек одной колонки. */
export function columnFilterParams(
  base: IssueFilterParams,
  statusId: string,
  opts: { isDone: boolean; showAllDone: boolean },
): IssueFilterParams {
  return {
    ...base,
    status: statusId,
    // Колонка «Готово» — только закрытое за окно; остальное за строкой «Ранее закрыто».
    closed: opts.isDone && !opts.showAllDone ? "recent" : undefined,
    closedDays: opts.isDone && !opts.showAllDone ? DONE_WINDOW_DAYS : undefined,
  };
}

/** Сколько закрытого спрятано окном в колонке (строка «Ранее закрыто»). */
export function hiddenDoneCount(older: IssueCounts | null, statusId: string, opts: { isDone: boolean; showAllDone: boolean }): number {
  if (!opts.isDone || opts.showAllDone || !older) return 0;
  return older.byStatus[statusId] ?? 0;
}

/**
 * Число карточек в заголовке колонки — реальное, а не число загруженных
 * (требование ТЗ 5.2). counts без `closed` включает всё закрытое; из «Готово»
 * вычитаем спрятанное окном. До ответа сервера — null (показываем прочерк).
 */
export function columnTotal(
  all: IssueCounts | null,
  older: IssueCounts | null,
  statusId: string,
  opts: { isDone: boolean; showAllDone: boolean },
): number | null {
  if (!all) return null;
  const n = all.byStatus[statusId] ?? 0;
  if (!opts.isDone || opts.showAllDone) return n;
  if (!older) return null;
  return Math.max(0, n - (older.byStatus[statusId] ?? 0));
}

/** Число незакрытых задач по счётчикам проекта (для состояния «всё сделано»). */
export function openTotal(all: IssueCounts | null, doneStatusIds: ReadonlySet<string>): number | null {
  if (!all) return null;
  let n = 0;
  for (const [sid, c] of Object.entries(all.byStatus)) if (!doneStatusIds.has(sid)) n += c;
  return n;
}
