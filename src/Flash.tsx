/** ADR-0035 (прототип): обёртка, которая коротко подсвечивается, когда сменилось `value` (статус, приоритет, срок в
 *  карточке задачи). Первый показ — без подсветки. Состояния React нет, цвет — WAAPI (`flash`). */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { flash } from "./motion";

export function Flash({ value, className = "", children }: { value: unknown; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useLayoutEffect(() => {
    if (prev.current !== value && ref.current) flash(ref.current);
    prev.current = value;
  }, [value]);
  return (
    <span ref={ref} className={`rounded-md ${className}`}>
      {children}
    </span>
  );
}
