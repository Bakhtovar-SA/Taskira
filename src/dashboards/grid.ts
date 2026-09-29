/** Сетка дашборда (ADR-0022): 12 колонок, высота — в строках. Чистые функции без DOM — тестируются отдельно.
 *
 *  Правило раскладки как у привычных конструкторов: виджеты не перекрываются, «всплывают» вверх до первого
 *  препятствия (compact), а тот, кого двигают или растягивают, имеет приоритет — мешающие ему съезжают вниз. */
import { DASHBOARD_GRID } from "./spec";

export const COLS = DASHBOARD_GRID.cols;
export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const collides = (a: Box, b: Box): boolean => a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Порядок чтения: сверху вниз, слева направо. Им же идут виджеты в DOM — для клавиатуры и узкого экрана. */
export const byReadingOrder = <T extends Box>(a: T, b: T): number => a.y - b.y || a.x - b.x;

/** Поднять всё, что можно, вверх. `first` — виджет, который при равной строке ставится раньше (его двигают). */
export function compact<T extends Box>(items: T[], first?: string): T[] {
  const sorted = items
    .map((i) => ({ ...i }))
    .sort((a, b) => byReadingOrder(a, b) || (a.id === first ? -1 : b.id === first ? 1 : 0));
  const placed: T[] = [];
  for (const it of sorted) {
    it.y = 0;
    for (;;) {
      const hit = placed.filter((p) => collides(p, it));
      if (!hit.length) break;
      it.y = Math.max(...hit.map((p) => p.y + p.h));
    }
    placed.push(it);
  }
  // Возвращаем в исходном порядке массива — у сохранения и DOM свой порядок, раскладка его не меняет.
  const pos = new Map(placed.map((p) => [p.id, p]));
  return items.map((i) => ({ ...i, x: pos.get(i.id)!.x, y: pos.get(i.id)!.y }));
}

/** Поставить виджет `id` на (x, y) с размером (w, h); мешающие съезжают вниз, затем всё поджимается вверх. */
function place<T extends Box>(items: T[], id: string, next: Pick<Box, "x" | "y" | "w" | "h">): T[] {
  const w = clamp(Math.round(next.w), 1, COLS);
  const h = clamp(Math.round(next.h), DASHBOARD_GRID.minH, DASHBOARD_GRID.maxH);
  const x = clamp(Math.round(next.x), 0, COLS - w);
  const y = clamp(Math.round(next.y), 0, DASHBOARD_GRID.maxRows);
  const moved = items.map((i) => (i.id === id ? { ...i, x, y, w, h } : { ...i }));
  const self = moved.find((i) => i.id === id);
  if (!self) return items;
  // Сначала — тот, кого двигают, затем остальные сверху вниз; каждый следующий спускается ниже всех, с кем
  // пересёкся среди уже поставленных.
  const placed: T[] = [self];
  for (const it of moved.filter((i) => i.id !== id).sort(byReadingOrder)) {
    for (;;) {
      const hit = placed.filter((p) => collides(p, it));
      if (!hit.length) break;
      it.y = Math.max(...hit.map((p) => p.y + p.h));
    }
    placed.push(it);
  }
  return compact(moved, id);
}

export const moveTo = <T extends Box>(items: T[], id: string, x: number, y: number): T[] => {
  const cur = items.find((i) => i.id === id);
  return cur ? place(items, id, { x, y, w: cur.w, h: cur.h }) : items;
};

export const resizeTo = <T extends Box>(items: T[], id: string, w: number, h: number): T[] => {
  const cur = items.find((i) => i.id === id);
  return cur ? place(items, id, { x: Math.min(cur.x, COLS - clamp(w, 1, COLS)), y: cur.y, w, h }) : items;
};

/** Клавиатура: стрелки двигают на клетку, со Shift — меняют размер. null — клавиша не наша. */
export function nudge<T extends Box>(items: T[], id: string, key: string, resize: boolean): T[] | null {
  const cur = items.find((i) => i.id === id);
  if (!cur) return null;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!d) return null;
  if (resize) return resizeTo(items, id, cur.w + d[0], cur.h + d[1]);
  // Вверх — встать над соседом сверху: поднимаемся на его высоту, иначе compact вернёт виджет обратно.
  if (d[1] < 0) {
    const above = items.filter((i) => i.id !== id && i.y + i.h <= cur.y && i.x < cur.x + cur.w && cur.x < i.x + i.w).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    return moveTo(items, id, cur.x, above ? above.y : cur.y - 1);
  }
  if (d[1] > 0) {
    const below = items.filter((i) => i.id !== id && i.y >= cur.y + cur.h && i.x < cur.x + cur.w && cur.x < i.x + i.w).sort((a, b) => a.y - b.y)[0];
    return moveTo(items, id, cur.x, below ? below.y + below.h : cur.y + 1);
  }
  return moveTo(items, id, cur.x + d[0], cur.y);
}

/** Первое свободное место под виджет w×h: сверху вниз, слева направо. */
export function firstFit(items: Box[], w: number, h: number): { x: number; y: number } {
  const ww = clamp(w, 1, COLS);
  for (let y = 0; y <= DASHBOARD_GRID.maxRows; y++) {
    for (let x = 0; x + ww <= COLS; x++) {
      const probe = { id: "\u0000", x, y, w: ww, h };
      if (!items.some((i) => collides(i, probe))) return { x, y };
    }
  }
  return { x: 0, y: items.reduce((m, i) => Math.max(m, i.y + i.h), 0) };
}

/** Клетка сетки под точкой (px от левого верхнего угла сетки). */
export function cellAt(px: number, py: number, gridWidth: number, rowH: number, gap: number): { col: number; row: number } {
  const colW = (gridWidth - gap * (COLS - 1)) / COLS;
  return { col: clamp(Math.floor(px / (colW + gap)), 0, COLS - 1), row: Math.max(0, Math.floor(py / (rowH + gap))) };
}

/** Сколько колонок и строк занимает прямоугольник в пикселях — для растягивания за угол. */
export function spanFor(widthPx: number, heightPx: number, gridWidth: number, rowH: number, gap: number): { w: number; h: number } {
  const colW = (gridWidth - gap * (COLS - 1)) / COLS;
  return { w: Math.max(1, Math.round((widthPx + gap) / (colW + gap))), h: Math.max(1, Math.round((heightPx + gap) / (rowH + gap))) };
}
