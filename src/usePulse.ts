/** ADR-0035 (прототип): «подпрыгивание» элемента при смене числа. По умолчанию (`"up"`) — только при росте (новые
 *  непрочитанные): на спаде (прочитал, открыл «Входящие») подпрыгивание-сигнал читалось бы неверно. `"any"` — на любое
 *  изменение (счётчики колонок и «Мои задачи»). Первый показ и значение `null` (ещё грузится) не анимируются. Движение — `enter(el, "pop")` (пружина,
 *  WAAPI), без состояния React. */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { enter } from "./motion";

export function usePulse<T extends HTMLElement>(value: number | null, when: "up" | "any" = "up"): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(value);
  useLayoutEffect(() => {
    if (value !== null && prev.current !== null && (when === "any" ? value !== prev.current : value > prev.current) && ref.current) enter(ref.current, "pop");
    prev.current = value;
  }, [value]);
  return ref;
}
