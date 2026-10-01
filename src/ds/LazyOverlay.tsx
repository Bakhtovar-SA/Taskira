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
      onFocus: () => (had.current = true),
      // Снятие самой заглушки тоже может дать blur, но без relatedTarget; уход фокуса на другой элемент — с ним.
      onBlur: (e: { relatedTarget: EventTarget | null }) => {
        if (e.relatedTarget) had.current = false;
      },
      "aria-expanded": false,
      "aria-haspopup": haspopup,
    } as TriggerProps;
    return (
      <span ref={box} className="contents">
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
