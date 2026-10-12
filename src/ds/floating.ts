/** Позиционирование поверхностей верхнего слоя (ADR-0014): элемент с атрибутом `popover` лежит в
 *  top layer — его не обрезает ни `overflow`, ни стеклянный предок; координаты считает
 *  `@floating-ui/dom` и пишет присваиваниями CSSOM (ADR-0010 п. 2). */
import { useLayoutEffect, type RefObject } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size, platform, type Placement } from "@floating-ui/dom";

export type { Placement };

export function useAnchored(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  open: boolean,
  { placement = "bottom-start", gap = 6, matchWidth = false, fitContent = false, anchorElement }: { placement?: Placement; gap?: number; matchWidth?: boolean; fitContent?: boolean; anchorElement?: HTMLElement | null } = {},
): void {
  useLayoutEffect(() => {
    const a = anchor.current;
    const f = floating.current;
    if (!open || !a || !f) return;
    let active = true;
    const cleanup = autoUpdate(a, f, () => {
      // The top layer uses viewport coordinates; the ultrawide root scales CSS pixels.
      const scale = Number(getComputedStyle(document.documentElement).zoom) || 1;
      // A popover inside a zoomed subtree (`.list-view { zoom: .9 }` on desktop) inherits that zoom too: its left/top and
      // sizes are multiplied by it. `k` converts root-zoom CSS px (what floating-ui returns below) into the popover's own
      // px. currentCSSZoom: Chrome 128 / Firefox 126 / Safari 18.2; without it k = 1 (root zoom only, as before).
      const own = (f as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
      const k = own ? own / scale : 1;
      // A loading placeholder must not permanently constrain the loaded panel to its original side.
      if (fitContent) f.style.maxHeight = `${(innerHeight / scale - 16) / k}px`;
      void computePosition(a, f, {
        strategy: "fixed",
        platform: scale !== 1 || k !== 1 ? {
          ...platform,
          getOffsetParent: () => document.documentElement,
          // flip/shift compare the popover's size with the viewport in root px.
          getDimensions: async (el) => { const d = await platform.getDimensions(el); return el === f ? { width: d.width * k, height: d.height * k } : d; },
        } : undefined,
        placement,
        middleware: [
          offset(gap),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ rects, availableHeight, elements }) {
              if (matchWidth) elements.floating.style.minWidth = `${rects.reference.width / k}px`;
              elements.floating.style.maxHeight = `${Math.max(120, Math.min(availableHeight, innerHeight / scale - 16)) / k}px`;
            },
          }),
        ],
      }).then(({ x, y, placement: p }) => {
        if (!active) return;
        f.style.left = `${Math.min(x, innerWidth / scale - f.offsetWidth * k - 8) / k}px`;
        f.style.top = `${Math.min(y, innerHeight / scale - f.offsetHeight * k - 8) / k}px`;
        f.dataset.side = p.split("-")[0];
      });
    });
    return () => { active = false; cleanup(); };
  }, [anchor, floating, open, placement, gap, matchWidth, fitContent, anchorElement]);
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
