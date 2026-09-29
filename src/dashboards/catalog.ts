/** Каталог виджетов и встроенные наборы (ADR-0022). Виджет — данные: тип + настройки + место в сетке; здесь —
 *  то, из чего человек выбирает в «Добавить виджет», и раскладки, с которых начинается новый дашборд или обзор. */
import type { DashboardWidget } from "../api";
import type { TKey } from "../i18n";
import { firstFit, type Box } from "./grid";

export type Widget = DashboardWidget;
type WidgetDraft = DistributiveOmit<Widget, "id" | "x" | "y">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface CatalogItem {
  key: string;
  group: "numbers" | "breakdowns" | "trends" | "lists" | "team";
  titleKey: TKey;
  make: () => WidgetDraft;
}

export const CATALOG: CatalogItem[] = [
  { key: "count-open", group: "numbers", titleKey: "dash.w.count.open", make: () => ({ type: "count", metric: "open", periodDays: 30, w: 3, h: 2 }) },
  { key: "count-overdue", group: "numbers", titleKey: "dash.w.count.overdue", make: () => ({ type: "count", metric: "overdue", periodDays: 30, w: 3, h: 2 }) },
  { key: "count-dueSoon", group: "numbers", titleKey: "dash.w.count.dueSoon", make: () => ({ type: "count", metric: "dueSoon", periodDays: 30, w: 3, h: 2 }) },
  { key: "count-unassigned", group: "numbers", titleKey: "dash.w.count.unassigned", make: () => ({ type: "count", metric: "unassigned", periodDays: 30, w: 3, h: 2 }) },
  { key: "count-closed", group: "numbers", titleKey: "dash.w.count.closed", make: () => ({ type: "count", metric: "closed", periodDays: 30, w: 3, h: 2 }) },
  { key: "count-created", group: "numbers", titleKey: "dash.w.count.created", make: () => ({ type: "count", metric: "created", periodDays: 30, w: 3, h: 2 }) },
  { key: "by-status", group: "breakdowns", titleKey: "dash.w.breakdown.status", make: () => ({ type: "breakdown", groupBy: "status", chart: "donut", w: 4, h: 4 }) },
  { key: "by-assignee", group: "breakdowns", titleKey: "dash.w.breakdown.assignee", make: () => ({ type: "breakdown", groupBy: "assignee", chart: "bars", w: 6, h: 4 }) },
  { key: "by-priority", group: "breakdowns", titleKey: "dash.w.breakdown.priority", make: () => ({ type: "breakdown", groupBy: "priority", chart: "bars", w: 4, h: 4 }) },
  { key: "by-type", group: "breakdowns", titleKey: "dash.w.breakdown.type", make: () => ({ type: "breakdown", groupBy: "type", chart: "donut", w: 4, h: 4 }) },
  { key: "by-project", group: "breakdowns", titleKey: "dash.w.breakdown.project", make: () => ({ type: "breakdown", groupBy: "project", chart: "bars", w: 6, h: 4 }) },
  { key: "trend", group: "trends", titleKey: "dash.w.trend", make: () => ({ type: "trend", periodDays: 90, w: 8, h: 4 }) },
  { key: "issues-mine", group: "lists", titleKey: "dash.w.issues.mine", make: () => ({ type: "issues", preset: "mine", limit: 8, w: 6, h: 4 }) },
  { key: "issues-overdue", group: "lists", titleKey: "dash.w.issues.overdue", make: () => ({ type: "issues", preset: "overdue", limit: 8, w: 6, h: 4 }) },
  { key: "issues-dueSoon", group: "lists", titleKey: "dash.w.issues.dueSoon", make: () => ({ type: "issues", preset: "dueSoon", limit: 8, w: 6, h: 4 }) },
  { key: "issues-unassigned", group: "lists", titleKey: "dash.w.issues.unassigned", make: () => ({ type: "issues", preset: "unassigned", limit: 8, w: 6, h: 4 }) },
  { key: "issues-recentlyCreated", group: "lists", titleKey: "dash.w.issues.recentlyCreated", make: () => ({ type: "issues", preset: "recentlyCreated", limit: 8, w: 6, h: 4 }) },
  { key: "issues-recentlyClosed", group: "lists", titleKey: "dash.w.issues.recentlyClosed", make: () => ({ type: "issues", preset: "recentlyClosed", limit: 8, w: 6, h: 4 }) },
  { key: "workload", group: "team", titleKey: "dash.w.workload", make: () => ({ type: "workload", limit: 8, w: 6, h: 4 }) },
  { key: "progress", group: "team", titleKey: "dash.w.progress", make: () => ({ type: "progress", limit: 10, w: 6, h: 4 }) },
  { key: "activity", group: "team", titleKey: "dash.w.activity", make: () => ({ type: "activity", limit: 10, w: 4, h: 5 }) },
];

export const CATALOG_GROUPS: { id: CatalogItem["group"]; labelKey: TKey }[] = [
  { id: "numbers", labelKey: "dash.group.numbers" },
  { id: "breakdowns", labelKey: "dash.group.breakdowns" },
  { id: "trends", labelKey: "dash.group.trends" },
  { id: "lists", labelKey: "dash.group.lists" },
  { id: "team", labelKey: "dash.group.team" },
];

let seq = 0;
/** id виджета: уникален в пределах дашборда, из разрешённого сервером алфавита. */
export const newWidgetId = (): string => `w${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Новый виджет из каталога — в первое свободное место. */
export function addFromCatalog(widgets: Widget[], item: CatalogItem): Widget[] {
  const draft = item.make();
  const at = firstFit(widgets as Box[], draft.w, draft.h);
  return [...widgets, { ...draft, id: newWidgetId(), ...at } as Widget];
}

/** Название виджета по умолчанию — из каталога по типу и настройкам. */
export function defaultTitleKey(w: Widget): TKey {
  switch (w.type) {
    case "count":
      return `dash.w.count.${w.metric}`;
    case "breakdown":
      return `dash.w.breakdown.${w.groupBy}`;
    case "issues":
      return `dash.w.issues.${w.preset}`;
    case "trend":
      return "dash.w.trend";
    default:
      return `dash.w.${w.type}`;
  }
}

const at = (x: number, y: number) => ({ x, y });
const make = (key: string, pos: { x: number; y: number }, over: Partial<Widget> = {}): Widget => {
  const item = CATALOG.find((c) => c.key === key)!;
  return { ...item.make(), ...pos, ...over, id: key } as Widget;
};

/** Встроенный обзор проекта — пока менеджер не собрал свой. */
export const DEFAULT_PROJECT_OVERVIEW: Widget[] = [
  make("count-open", at(0, 0)),
  make("count-overdue", at(3, 0)),
  make("count-dueSoon", at(6, 0)),
  make("count-closed", at(9, 0)),
  make("trend", at(0, 2)),
  make("by-status", at(8, 2)),
  make("workload", at(0, 6)),
  make("issues-overdue", at(6, 6)),
  make("activity", at(0, 10), { w: 6, h: 4 }),
  make("issues-dueSoon", at(6, 10)),
];

/** id встроенного «Обзора организации» в адресе (`/dashboards/overview`). Серверные id — uuid, не пересекаются. */
export const ORG_OVERVIEW_ID = "overview";

/** Встроенный обзор организации: всё по проектам, которые видит смотрящий, без хранения на сервере. */
export const DEFAULT_ORG_OVERVIEW: Widget[] = [
  make("count-open", at(0, 0)),
  make("count-overdue", at(3, 0)),
  make("count-unassigned", at(6, 0)),
  make("count-closed", at(9, 0)),
  make("trend", at(0, 2)),
  make("by-status", at(8, 2)),
  make("by-project", at(0, 6)),
  make("progress", at(6, 6)),
  make("workload", at(0, 10)),
  make("activity", at(6, 10), { w: 6, h: 4 }),
];

/** С чего начать новый дашборд. */
export const DASHBOARD_TEMPLATES: { id: string; nameKey: TKey; descKey: TKey; widgets: () => Widget[] }[] = [
  {
    id: "mine",
    nameKey: "dash.tpl.mine",
    descKey: "dash.tpl.mineDesc",
    widgets: () => [make("issues-mine", at(0, 0), { w: 7, h: 5 }), make("issues-dueSoon", at(7, 0), { w: 5, h: 5 }), make("activity", at(0, 5), { w: 7, h: 4 }), make("count-overdue", at(7, 5), { w: 5, h: 2 })],
  },
  {
    id: "team",
    nameKey: "dash.tpl.team",
    descKey: "dash.tpl.teamDesc",
    widgets: () => [
      make("count-open", at(0, 0)),
      make("count-overdue", at(3, 0)),
      make("count-unassigned", at(6, 0)),
      make("count-closed", at(9, 0)),
      make("workload", at(0, 2), { h: 5 }),
      make("by-assignee", at(6, 2), { h: 5 }),
      make("progress", at(0, 7)),
      make("trend", at(6, 7), { w: 6 }),
    ],
  },
  { id: "empty", nameKey: "dash.tpl.empty", descKey: "dash.tpl.emptyDesc", widgets: () => [] },
];
