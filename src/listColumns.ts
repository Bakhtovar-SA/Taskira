/** Колонки таблицы «Список задач» (ТЗ 5.12 e): какие показывать — настройка человека, только в этом браузере
 *  (localStorage, как тема). Ключ и название показываются всегда. Ширины — сетка CSS, одна на заголовок и строки. */
import type { TKey } from "./i18n";

export type ColumnId = "priority" | "type" | "direction" | "labels" | "due" | "status" | "assignee" | "updated";
export type SortKey = "priority" | "due" | "updated" | "key";

export const COLUMNS: { id: ColumnId; label: TKey; width: string; sort?: SortKey }[] = [
  { id: "priority", label: "field.priority", width: "28px", sort: "priority" },
  { id: "type", label: "field.type", width: "24px" },
  { id: "direction", label: "field.direction", width: "230px" },
  { id: "labels", label: "field.labels", width: "160px" },
  { id: "due", label: "field.dueDate", width: "110px", sort: "due" },
  { id: "status", label: "field.status", width: "136px" },
  { id: "assignee", label: "field.assignee", width: "74px" },
  { id: "updated", label: "backlog.sort.updated", width: "96px", sort: "updated" },
];
/** Порядок в строке: приоритет и тип — слева от ключа, остальное — справа от названия. */
export const LEFT: ColumnId[] = ["priority", "type"];
export const DEFAULT_COLUMNS: ColumnId[] = ["priority", "direction", "due", "assignee"];

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

/** Desktop minimum keeps the title and actions usable; intermediate widths scroll inside the list. */
export function tableMinWidth(visible: ColumnId[], selectMode: boolean): number {
  const widths = visible.map(id => Number.parseInt(COLUMNS.find(c => c.id === id)!.width));
  const count = visible.length + 3 + Number(selectMode);
  return 32 + 12 * (count - 1) + 76 + 320 + 44 + widths.reduce((a, b) => a + b, 0) + (selectMode ? 28 : 0);
}

/** [Selection] [left fields] key title [right fields] menu. Mobile places key with the title,
 *  status on the second line, and always retains the action menu. */
export function gridTemplate(visible: ColumnId[], selectMode: boolean, compact = false): string {
  const on = new Set(visible);
  if (compact) return [selectMode ? "28px" : null, "minmax(0,1fr)", on.has("assignee") ? "72px" : null, "44px"].filter(Boolean).join(" ");
  const w = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!.width;
  return [
    selectMode ? "28px" : null,
    ...LEFT.filter((id) => on.has(id)).map(w),
    compact ? null : "76px",
    "minmax(0,1fr)",
    ...COLUMNS.filter((c) => !LEFT.includes(c.id) && on.has(c.id)).map((c) => w(c.id)),
    "44px",
  ]
    .filter(Boolean)
    .join(" ");
}
