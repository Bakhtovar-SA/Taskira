/** Menu и Popover для модулей входного чанка (доска, боковая панель): как LazyTooltip, сами поверхности с
 *  @floating-ui/dom приходят отдельным чанком. Пока он не загружен, кнопка уже на месте. Нажатие в этот миг открывает
 *  поверхность только в управляемом режиме (open/onOpenChange): состояние живёт у вызывающего, и она откроется, как
 *  только чанк придёт. Неуправляемая такое нажатие теряет — чанк грузится сразу после первой отрисовки, окно короткое.
 *  Кнопка-заглушка и настоящая — разные элементы: если фокус был на заглушке, он переходит на настоящую. */
import { lazy, Suspense, useLayoutEffect, useRef, type ComponentType, type RefObject } from "react";
import type { MenuProps, PopoverProps, TriggerProps } from "./Overlay";

const RealMenu = lazy(() => import("./Overlay").then((m) => ({ default: m.Menu })));
const RealPopover = lazy(() => import("./Overlay").then((m) => ({ default: m.Popover })));

/** Рисуется вместе с настоящей поверхностью: возвращает фокус, если он был на заглушке. */
function KeepFocus({ box, had }: { box: RefObject<HTMLSpanElement | null>; had: RefObject<boolean> }) {
  useLayoutEffect(() => {
    if (!had.current) return;
    had.current = false;
    box.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  }, [box, had]);
  return null;
}

function withFallback<P extends { trigger: PopoverProps["trigger"]; onOpenChange?: (open: boolean) => void }>(Real: ComponentType<P>, haspopup: TriggerProps["aria-haspopup"]) {
  return function Lazy(props: P) {
    const box = useRef<HTMLSpanElement>(null);
    const had = useRef(false);
    const stub = {
      ref: null,
      onClick: () => props.onOpenChange?.(true),
      "aria-expanded": false,
      "aria-haspopup": haspopup,
    } as TriggerProps;
    // Focus is tracked on the wrapper, not on the stub's handlers: a trigger may compose several overlays (the issue
    // card's «Действия» is a lazy Menu inside a lazy Popover) and spread only one set of props onto the button.
    // Removing the stub also blurs, but without relatedTarget; focus moving to another element comes with it.
    return (
      <span ref={box} className="contents" onFocus={() => (had.current = true)}
        onBlur={(e) => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) had.current = false; }}>
        <Suspense fallback={props.trigger(stub, false)}>
          <Real {...props} />
          <KeepFocus box={box} had={had} />
        </Suspense>
      </span>
    );
  };
}

export const Menu = withFallback<MenuProps>(RealMenu, "menu");
export const Popover = withFallback<PopoverProps>(RealPopover, "dialog");

export type { MenuEntry, MenuProps, PopoverProps } from "./Overlay";
