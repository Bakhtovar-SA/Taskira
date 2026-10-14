/** COV-01 (ADR-0035): число KPI, которое «дорастает» при росте по обновлению данных. Как `usePulse`: первый показ и
 *  убывание — мгновенно. Смена `resetKey` (фильтр, период, метрика, проект — то, что меняет число «само по себе») —
 *  новая точка отсчёта без движения. Итоговое число всегда в тексте (доступность, `textContent`); кадры — только
 *  `data-shown` для `::after` (см. `countTo`). Не использовать там, где фильтр меняет все числа разом («Отчёты»). */
import { useLayoutEffect, useRef } from "react";
import { countTo } from "./motion";

export function CountUp({ value, resetKey, format = String, className }: { value: number; resetKey?: string; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef({ value, key: resetKey });
  const fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { value, key: resetKey };
    if (!ref.current || p.key !== resetKey || !(value > p.value)) return;
    return countTo(ref.current, p.value, value, (n) => fmt.current(n));
  }, [value, resetKey]);
  return (
    <span ref={ref} className={`count-up tabular${className ? ` ${className}` : ""}`}>
      <span className="count-up-text">{format(value)}</span>
    </span>
  );
}
