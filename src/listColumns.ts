/** Колонки таблицы «Список задач» (ТЗ 5.12 e): какие показывать — настройка человека, только в этом браузере
 *  (localStorage, как тема). Ключ и название показываются всегда. Ширины — сетка CSS, одна на заголовок и строки. */
import type { TKey } from "./i18n";

export type ColumnId = "priority" | "type" | "direction" | "labels" | "due" | "status" | "assignee" | "updated";
export type SortKey = "priority" | "due" | "updated" | "key";

export const COLUMNS: { id: ColumnId; label: TKey; width: string; sort?: SortKey }[] = [
  { id: "priority", label: "field.priority", width: "28px", sort: "priority" },
  { id: "type", label: "field.type", width: "24px" },
  { id: "direction", label: "field.direction", width: "minmax(0,170px)" },
  { id: "labels", label: "field.labels", width: "minmax(0,180px)" },
  { id: "due", label: "field.dueDate", width: "92px", sort: "due" },
  { id: "status", label: "field.status", width: "136px" },
  { id: "assignee", label: "field.assignee", width: "76px" },
  { id: "updated", label: "backlog.sort.updated", width: "96px", sort: "updated" },
];
/** Порядок в строке: приоритет и тип — слева от ключа, остальное — справа от названия. */
export const LEFT: ColumnId[] = ["priority", "type"];
export const DEFAULT_COLUMNS: ColumnId[] = ["priority", "direction", "labels", "due", "status", "assignee"];

const KEY = "taskira.list.columns";
const known = new Set<string>(COLUMNS.map((c) => c.id));

export function readColumns(): ColumnId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) ? (v.filter((x) => known.has(x)) as ColumnId[]) : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}
export function writeColumns(cols: ColumnId[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cols));
  } catch {
    /* приватный режим — настройка просто не переживёт перезагрузку */
  }
}

/** Узкие ширины для телефона: там видны только название (с ключом над ним), статус и исполнитель (index.css, .list-grid). */
const COMPACT: Partial<Record<ColumnId, string>> = { status: "minmax(0,96px)", assignee: "36px" };

/** Шаблон колонок сетки: [выбор] [левые] ключ название [правые] [меню]. На телефоне (compact) колонок ключа и
 *  меню нет — ключ показывается над названием, а меню без наведения всё равно не открыть. */
export function gridTemplate(visible: ColumnId[], selectMode: boolean, compact = false): string {
  const on = new Set(visible);
  const w = (id: ColumnId) => (compact && COMPACT[id]) || COLUMNS.find((c) => c.id === id)!.width;
  return [
    selectMode ? "28px" : null,
    ...LEFT.filter((id) => on.has(id)).map(w),
    compact ? null : "76px",
    compact ? "minmax(0,1fr)" : "minmax(200px,1fr)",
    ...COLUMNS.filter((c) => !LEFT.includes(c.id) && on.has(c.id)).map((c) => w(c.id)),
    compact ? null : "32px",
  ]
    .filter(Boolean)
    .join(" ");
}
