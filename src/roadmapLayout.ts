/** Раскладка роадмапа проектов (ТЗ 5.15) — чистые функции без DOM: какие дни занимает полоса, какая её часть
 *  подтверждена датами, диапазон шкалы, вертикальные позиции строк для линий зависимостей. Шкала — timeScale.ts. */
import type { RoadmapDto, RoadmapProjectDto } from "../server/src/contract";
import { addDays, daysBetween, startOfDay, startOfWeek } from "./timeScale";

/** Сколько дней полосы рисуется «на глаз» за известной датой, если второй нет (штриховка). */
export const TENTATIVE_DAYS = 28;

export const parseDay = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Полоса проекта: [from, to] — все дни полосы включительно; [solidFrom, solidTo] — подтверждённая часть
 *  (null — вся полоса предварительная). Без дат — null: строка есть, полосы нет. */
export interface BarSpan {
  from: Date;
  to: Date;
  solidFrom: Date | null;
  solidTo: Date | null;
}

export function barSpan(p: Pick<RoadmapProjectDto, "startDate" | "targetDate">, today: Date): BarSpan | null {
  const t0 = startOfDay(today);
  const s = p.startDate ? parseDay(p.startDate) : null;
  const t = p.targetDate ? parseDay(p.targetDate) : null;
  if (s && t) return { from: s, to: t, solidFrom: s, solidTo: t };
  if (s) {
    // Начало есть, цели нет: подтверждено от начала до сегодня (идёт работа), дальше — месяц штриховкой.
    const known = daysBetween(s, t0) > 0 ? t0 : s;
    return { from: s, to: addDays(known, TENTATIVE_DAYS), solidFrom: s, solidTo: known };
  }
  if (t) return { from: addDays(t, -TENTATIVE_DAYS), to: t, solidFrom: null, solidTo: null };
  return null;
}

/** Начало шкалы и число дней: все полосы и вехи с запасом, не меньше года, начало — понедельник. */
export function roadmapRange(projects: RoadmapProjectDto[], today: Date): { origin: Date; days: number } {
  let min = startOfDay(today);
  let max = startOfDay(today);
  const see = (d: Date) => {
    if (d < min) min = d;
    if (d > max) max = d;
  };
  for (const p of projects) {
    const b = barSpan(p, today);
    if (b) {
      see(b.from);
      see(b.to);
    }
    for (const m of p.milestones) see(parseDay(m.date));
  }
  const origin = startOfWeek(addDays(min, -14));
  return { origin, days: Math.max(365, daysBetween(origin, max) + 60) };
}

/** Высоты строк — одна константа для разметки и для линий зависимостей (SVG рисуется по тем же числам). */
export const ROW_H = 56;
export const GROUP_H = 40;
/** Геометрия полосы совпадает с CSS роадмапа. */
export const BAR_TOP = 15;
export const BAR_H = 26;

export interface Group<T> {
  id: string;
  name: string;
  projects: T[];
}

/** y центра полосы каждого проекта (от верха списка строк) и общая высота. */
export function rowPositions<T extends { id: string }>(groups: Group<T>[]): { y: Map<string, number>; height: number } {
  const y = new Map<string, number>();
  let top = 0;
  for (const g of groups) {
    top += GROUP_H;
    for (const p of g.projects) {
      y.set(p.id, top + BAR_TOP + BAR_H / 2);
      top += ROW_H;
    }
  }
  return { y, height: top };
}

/** Зависимость «опаздывает»: источник ещё не закончен (его последний день) к первому дню зависимого. */
export function isLate(dep: RoadmapDto["dependencies"][number], spans: Map<string, BarSpan | null>): boolean {
  const s = spans.get(dep.sourceId);
  const d = spans.get(dep.dependentId);
  return !!s && !!d && daysBetween(d.from, s.to) > 0;
}

export type LayoutItem<T> = { kind: "group"; group: Group<T>; y: number } | { kind: "row"; item: T; y: number };

/** Заголовки отделов и строки, попадающие в окно [top − overscan, top + h + overscan] (y — верх элемента от начала
 *  списка). Высоты фиксированы, поэтому окно считается без измерений DOM. */
export function visibleItems<T>(groups: Group<T>[], top: number, h: number, overscan: number): LayoutItem<T>[] {
  const lo = top - overscan;
  const hi = top + h + overscan;
  const out: LayoutItem<T>[] = [];
  let y = 0;
  for (const g of groups) {
    if (y + GROUP_H > lo && y < hi) out.push({ kind: "group", group: g, y });
    y += GROUP_H;
    for (const item of g.projects) {
      if (y + ROW_H > lo && y < hi) out.push({ kind: "row", item, y });
      y += ROW_H;
    }
  }
  return out;
}
