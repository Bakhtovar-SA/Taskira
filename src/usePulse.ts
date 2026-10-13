/** ADR-0035 (прототип): «подпрыгивание» элемента при смене значения (число непрочитанных). Первый показ не анимируется —
 *  только последующие смены; движение — `enter(el, "pop")` (пружина, WAAPI), без состояния React. */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { enter } from "./motion";

export function usePulse<T extends HTMLElement>(value: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(value);
  useLayoutEffect(() => {
    if (prev.current !== value && ref.current) enter(ref.current, "pop");
    prev.current = value;
  }, [value]);
  return ref;
}
