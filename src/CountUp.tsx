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
  // Число, которое сейчас на экране во время счёта: новое обновление продолжает с него, а не с прежней цели (иначе 14 → 20 → 25).
  const onScreen = useRef<number | null>(null);
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { value, key: resetKey };
    const from = onScreen.current ?? p.value;
    onScreen.current = null;
    if (!ref.current || p.key !== resetKey || !(value > p.value) || !(value > from)) return;
    const el = ref.current;
    const stop = countTo(el, from, value, (n) => {
      onScreen.current = n;
      return fmt.current(n);
    });
    return () => {
      // Счёт ещё шёл (атрибут снимает `stop`) — следующий запуск продолжит с видимого числа; закончился — нет.
      if (!el.hasAttribute("data-counting")) onScreen.current = null;
      stop();
    };
  }, [value, resetKey]);
  return (
    <span ref={ref} className={`count-up tabular${className ? ` ${className}` : ""}`}>
      <span className="count-up-text">{format(value)}</span>
    </span>
  );
}
