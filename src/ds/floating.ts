/** Позиционирование поверхностей верхнего слоя (ADR-0014): элемент с атрибутом `popover` лежит в
 *  top layer — его не обрезает ни `overflow`, ни стеклянный предок; координаты считает
 *  `@floating-ui/dom` и пишет присваиваниями CSSOM (ADR-0010 п. 2). */
import { useLayoutEffect, type RefObject } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";

export type { Placement };

export function useAnchored(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  open: boolean,
  { placement = "bottom-start", gap = 6, matchWidth = false, anchorElement }: { placement?: Placement; gap?: number; matchWidth?: boolean; anchorElement?: HTMLElement | null } = {},
): void {
  useLayoutEffect(() => {
    const a = anchor.current;
    const f = floating.current;
    if (!open || !a || !f) return;
    let active = true;
    const cleanup = autoUpdate(a, f, () => {
      void computePosition(a, f, {
        strategy: "fixed",
        placement,
        middleware: [
          offset(gap),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ rects, availableHeight, elements }) {
              if (matchWidth) elements.floating.style.minWidth = `${rects.reference.width}px`;
              elements.floating.style.maxHeight = `${Math.max(120, availableHeight)}px`;
            },
          }),
        ],
      }).then(({ x, y, placement: p }) => {
        if (!active) return;
        f.style.left = `${x}px`;
        f.style.top = `${y}px`;
        f.dataset.side = p.split("-")[0];
      });
    });
    return () => { active = false; cleanup(); };
  }, [anchor, floating, open, placement, gap, matchWidth, anchorElement]);
}

/** showPopover/hidePopover бросают, если состояние уже такое; в jsdom их нет вовсе. */
export const showPop = (el: HTMLElement | null) => {
  try {
    if (el && !el.matches(":popover-open")) el.showPopover?.();
  } catch {
    /* уже открыт или API нет (jsdom) */
  }
};
export const hidePop = (el: HTMLElement | null) => {
  try {
    if (el?.matches(":popover-open")) el.hidePopover?.();
  } catch {
    /* уже закрыт или API нет */
  }
};

/** Стабильный id для связок aria-* (useId в React 19 даёт «:r1:», это валидно, но в селекторах неудобно). */
export { dsId } from "./ids";
