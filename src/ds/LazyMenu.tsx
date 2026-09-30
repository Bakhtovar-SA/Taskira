/** Меню для модулей входного чанка (доска): как LazyTooltip, само меню с @floating-ui/dom приходит отдельным
 *  чанком. Пока он не загружен, кнопка уже на месте. Нажатие в этот миг открывает меню только в управляемом режиме
 *  (open/onOpenChange): состояние живёт у вызывающего, и меню откроется, как только чанк придёт. Неуправляемое меню
 *  такое нажатие теряет — чанк грузится сразу после первой отрисовки, окно короткое. */
import { lazy, Suspense } from "react";
import type { MenuProps } from "./Overlay";

const Real = lazy(() => import("./Overlay").then((m) => ({ default: m.Menu })));

export function Menu(props: MenuProps) {
  const fallback = props.trigger(
    { ref: null, onClick: () => props.onOpenChange?.(true), "aria-expanded": false, "aria-haspopup": "menu" },
    false,
  );
  return (
    <Suspense fallback={fallback}>
      <Real {...props} />
    </Suspense>
  );
}

export type { MenuEntry, MenuProps } from "./Overlay";
