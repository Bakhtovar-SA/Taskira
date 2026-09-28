/** Шкала времени (ТЗ 5.12 f): дата ↔ x и деления шапки. Общая для Таймлайна направлений и будущего роадмапа
 *  проектов (ТЗ 5.15 п.3 — «шкалу и сетку взять из примитивов Таймлайна, а не писать вторую реализацию»).
 *  Чистые функции без DOM и без i18n: подписи делений форматирует вызывающий (TickFormat). */

export type Zoom = "week" | "month" | "quarter";
export const ZOOMS: Zoom[] = ["week", "month", "quarter"];
/** Пикселей на день. Неделя — 56 px, как было у Таймлайна до масштабов. */
export const PX_PER_DAY: Record<Zoom, number> = { week: 8, month: 4, quarter: 1.5 };

const DAY = 864e5;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Разница в календарных днях; округление гасит час перехода на летнее время. */
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
/** Понедельник недели, в которой лежит d. */
export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

export interface TimeScale {
  origin: Date;
  days: number;
  pxPerDay: number;
  width: number;
  /** Левый край дня d, px от начала шкалы. */
  x(d: Date): number;
}

export function timeScale(origin: Date, days: number, zoom: Zoom): TimeScale {
  const o = startOfDay(origin);
  const pxPerDay = PX_PER_DAY[zoom];
  return { origin: o, days, pxPerDay, width: days * pxPerDay, x: (d) => daysBetween(o, d) * pxPerDay };
}

export interface Tick {
  date: Date;
  x: number;
  w: number;
  label: string;
}
export interface TickFormat {
  day(d: Date): string;
  month(d: Date): string;
  year(d: Date): string;
  quarter(d: Date): string;
}

type Unit = "week" | "month" | "quarter" | "year";
const next = (d: Date, u: Unit): Date =>
  u === "week" ? addDays(d, 7) : new Date(d.getFullYear() + (u === "year" ? 1 : 0), d.getMonth() + (u === "month" ? 1 : u === "quarter" ? 3 : 0), 1);
/** Первая граница единицы не раньше d. */
function firstBoundary(d: Date, u: Unit): Date {
  if (u === "week") {
    const m = startOfWeek(d);
    return daysBetween(m, d) === 0 ? m : addDays(m, 7);
  }
  const step = u === "year" ? 12 : u === "quarter" ? 3 : 1;
  const m0 = u === "year" ? 0 : d.getMonth() - (d.getMonth() % step);
  const b = new Date(d.getFullYear(), m0, 1);
  return daysBetween(b, d) === 0 ? b : next(b, u);
}

/** Отрезки единицы на шкале. Если шкала начинается внутри единицы, первый отрезок — её хвост от x = 0
 *  (подпись у левого края, иначе левая часть шапки осталась бы без подписи). */
function segments(s: TimeScale, u: Unit, label: (d: Date, first: boolean) => string): Tick[] {
  const end = addDays(s.origin, s.days);
  const starts: Date[] = [];
  const b = firstBoundary(s.origin, u);
  if (daysBetween(s.origin, b) > 0) starts.push(s.origin);
  for (let d = b; daysBetween(d, end) > 0; d = next(d, u)) starts.push(d);
  return starts.map((d, i) => {
    const x = s.x(d);
    const w = (i + 1 < starts.length ? s.x(starts[i + 1]) : s.width) - x;
    return { date: d, x, w, label: label(d, i === 0) };
  });
}

/** Деления шапки: мелкие (недели / месяцы / кварталы) и крупные над ними (месяцы / годы / годы). */
export function scaleTicks(s: TimeScale, zoom: Zoom, f: TickFormat): { major: Tick[]; minor: Tick[] } {
  if (zoom === "week")
    return {
      major: segments(s, "month", (d, first) => (d.getMonth() === 0 || first ? `${f.month(d)} ${f.year(d)}` : f.month(d))),
      minor: segments(s, "week", (d) => f.day(d)),
    };
  return {
    major: segments(s, "year", (d) => f.year(d)),
    minor: segments(s, zoom === "month" ? "month" : "quarter", (d) => (zoom === "month" ? f.month(d) : f.quarter(d))),
  };
}
