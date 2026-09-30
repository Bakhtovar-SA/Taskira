/** Меню для модулей входного чанка (доска): как LazyTooltip, само меню с @floating-ui/dom приходит отдельным
 *  чанком. Пока он не загружен, кнопка уже на месте. Нажатие в этот миг открывает меню только в управляемом режиме
 *  (open/onOpenChange): состояние живёт у вызывающего, и меню откроется, как только чанк придёт. Неуправляемое меню
 *  такое нажатие теряет — чанк грузится сразу после первой отрисовки, окно короткое. Кнопка-заглушка и настоящая —
 *  разные элементы: если фокус был на заглушке, он переходит на настоящую. */
import { lazy, Suspense, useLayoutEffect, useRef, type RefObject } from "react";
import type { MenuProps, TriggerProps } from "./Overlay";

const Real = lazy(() => import("./Overlay").then((m) => ({ default: m.Menu })));

/** Рисуется вместе с настоящим меню: возвращает фокус, если он был на заглушке. */
function KeepFocus({ box, had }: { box: RefObject<HTMLSpanElement | null>; had: RefObject<boolean> }) {
  useLayoutEffect(() => {
    if (!had.current) return;
    had.current = false;
    box.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  }, [box, had]);
  return null;
}

export function Menu(props: MenuProps) {
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
    "aria-haspopup": "menu",
  } as TriggerProps;
  return (
    <span ref={box} className="contents">
      <Suspense fallback={props.trigger(stub, false)}>
        <Real {...props} />
        <KeepFocus box={box} had={had} />
      </Suspense>
    </span>
  );
}

export type { MenuEntry, MenuProps } from "./Overlay";
