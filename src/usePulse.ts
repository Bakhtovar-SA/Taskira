/** ADR-0035 (прототип): «подпрыгивание» элемента, когда число выросло (новые непрочитанные). Первый показ и уменьшение
 *  (прочитал, открыл «Входящие») не анимируются — подпрыгивание привлекает внимание и на спаде читалось бы неверно.
 *  Движение — `enter(el, "pop")` (пружина, WAAPI), без состояния React. */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { enter } from "./motion";

export function usePulse<T extends HTMLElement>(value: number): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(value);
  useLayoutEffect(() => {
    if (value > prev.current && ref.current) enter(ref.current, "pop");
    prev.current = value;
  }, [value]);
  return ref;
}
