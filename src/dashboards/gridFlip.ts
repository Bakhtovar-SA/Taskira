/** NEW-05 (трек N, ADR-0035): FLIP виджетов дашборда в режиме правки. Когда один виджет двигают или растягивают, соседи
 *  съезжают и поджимаются (`grid.ts`) — без движения они прыгают в новые клетки. Здесь они плавно доезжают
 *  (`flipFrom`, как карточки доски и строки списка); тот, кого ведёт указатель (`active`), не анимируется — он должен
 *  идти за рукой. Вызывается из layout-эффекта после коммита; состояния React нет, стили пишет только WAAPI (ADR-0010).
 *
 *  Положения хранятся от угла сетки в CSS px (прокрутка страницы и zoom их не портят). Виджет, чья клетка не менялась,
 *  не измеряется вовсе: лишний коммит не трогает идущую анимацию. Сетка сменила ширину (окно, сайдбар) или виджетов
 *  больше `MAX_TRACKED` — только запоминаем, не анимируем (VDI: не десятки getBoundingClientRect за коммит). */
import { cssZoom, flipFrom, motionReduced, stopMotion } from "../motion";
import type { Box } from "./grid";

export const MAX_TRACKED = 40;

type Seen = { x: number; y: number; w: number; h: number; left: number; top: number };

/** `grid` — `null` вне режима правки: запомненное сбрасывается, следующая правка начнёт с чистой базовой линии. */
export type GridFlip = (grid: HTMLElement | null, widgets: readonly Box[], active: string | null) => void;

/** Виджет едет прямо сейчас: идёт анимация transform (пружина сдвига). Входная CSS-анимация и подсветка не в счёт. */
const isMoving = (el: HTMLElement): boolean =>
  !!el.getAnimations?.().some((a) => (a.effect as KeyframeEffect | null)?.getKeyframes?.().some((k) => "transform" in k));

export function createGridFlip(): GridFlip {
  let prev: { width: number; seen: Map<string, Seen> } | null = null;
  return (grid, widgets, active) => {
    if (!grid || widgets.length > MAX_TRACKED || motionReduced()) {
      prev = null;
      return;
    }
    const els = new Map<string, HTMLElement>();
    for (const el of grid.querySelectorAll<HTMLElement>(":scope > [data-widget]")) els.set(el.dataset.widget!, el);
    const g = grid.getBoundingClientRect();
    const z = cssZoom(grid);
    const before = prev && Math.abs(prev.width - g.width) < 1 ? prev.seen : null;
    const seen = new Map<string, Seen>();
    const flips: { el: HTMLElement; left: number; top: number }[] = [];
    for (const b of widgets) {
      const el = els.get(b.id);
      if (!el) continue;
      const old = before?.get(b.id);
      if (old && old.x === b.x && old.y === b.y && old.w === b.w && old.h === b.h) {
        seen.set(b.id, old);
        continue;
      }
      // Видимое положение (с текущим сдвигом пружины) и положение в раскладке: прерванное движение продолжается с того
      // места, где виджет виден, а не с прежней клетки.
      const v = el.getBoundingClientRect();
      let l = v;
      if (isMoving(el)) {
        stopMotion(el);
        l = el.getBoundingClientRect();
      }
      seen.set(b.id, { x: b.x, y: b.y, w: b.w, h: b.h, left: (l.left - g.left) / z, top: (l.top - g.top) / z });
      // Двигается/растягивается указателем — идёт за ним без анимации; изменивший размер — не просто сдвинутый сосед.
      if (!old || b.id === active || old.w !== b.w || old.h !== b.h) continue;
      flips.push({ el, left: g.left + old.left * z + (v.left - l.left), top: g.top + old.top * z + (v.top - l.top) });
    }
    prev = { width: g.width, seen };
    for (const f of flips) void flipFrom(f.el, f.left, f.top, { lift: false });
  };
}
