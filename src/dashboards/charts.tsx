/** Графики дашбордов (ADR-0022) — свои SVG/HTML без библиотеки. Правила — методика dataviz:
 *  тонкие метки, зазор 2px цвета поверхности между соседними заливками, сетка — сплошные волосяные линии,
 *  подписи — цветом текста (никогда цветом серии), у каждого графика есть подписи со значениями, поэтому
 *  подсказка при наведении ничего не прячет. Цвета — `--chart-N` (категории) и `--status-*` (состояния),
 *  проверенные валидатором на наших поверхностях (tokens.css). Позиции в HTML — через cssVars (ADR-0010). */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cssVars } from "../cssVars";

/** Категориальный цвет слота: тон закреплён за местом сущности в списке данных, а не за её рангом. */
export const chartColor = (slot: number): string => `var(--chart-${(slot % 8) + 1})`;
/** «Прочее» и «без значения» — нейтральный, чтобы не выдавать себя за ещё одну серию. */
export const OTHER_COLOR = "var(--status-todo)";

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

export interface Part {
  key: string;
  label: string;
  value: number;
  color: string;
}

function Swatch({ color, line = false }: { color: string; line?: boolean }) {
  return (
    <svg width={line ? 14 : 10} height="10" viewBox={line ? "0 0 14 10" : "0 0 10 10"} aria-hidden="true" className="shrink-0">
      {line ? <path d="M1 5h12" stroke={color} strokeWidth="2" strokeLinecap="round" /> : <rect width="10" height="10" rx="3" fill={color} />}
    </svg>
  );
}

/** Кольцо «часть от целого». Не больше шести частей — иначе виджет сам рисует полосы (сравнивать близкие доли
 *  по дугам нельзя). В центре — итог, справа — легенда со значениями и долями. */
export function Donut({ parts, total, centerLabel }: { parts: Part[]; total: number; centerLabel: string }) {
  const [hi, setHi] = useState<string | null>(null);
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const R = 38;
  const C = 2 * Math.PI * R;
  const GAP = sum > 0 && parts.length > 1 ? 1.6 : 0;
  let start = 0;
  const arcs = parts.map((p) => {
    const len = sum > 0 ? (p.value / sum) * C : 0;
    const a = { p, dash: `${Math.max(0, len - GAP).toFixed(2)} ${(C - Math.max(0, len - GAP)).toFixed(2)}`, offset: (-start).toFixed(2) };
    start += len;
    return a;
  });
  return (
    <div className="flex h-full min-h-0 items-center gap-4">
      <svg viewBox="0 0 100 100" className="aspect-square h-full max-h-[150px] min-h-[88px] max-w-[42%] shrink-0" role="img" aria-label={`${centerLabel}: ${total}`}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="11" />
        <g transform="rotate(-90 50 50)">
          {arcs.map(({ p, dash, offset }) => (
            <circle
              key={p.key}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={p.color}
              strokeWidth={hi === p.key ? 13 : 11}
              strokeDasharray={dash}
              strokeDashoffset={offset}
              opacity={hi && hi !== p.key ? 0.35 : 1}
              onPointerEnter={() => setHi(p.key)}
              onPointerLeave={() => setHi(null)}
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          ))}
        </g>
        <text x="50" y="49" textAnchor="middle" className="fill-[var(--text-1)] text-[20px] font-semibold">
          {total}
        </text>
        <text x="50" y="63" textAnchor="middle" className="fill-[var(--text-3)] text-[8.5px]">
          {centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1">
        {parts.map((p) => (
          <li
            key={p.key}
            onPointerEnter={() => setHi(p.key)}
            onPointerLeave={() => setHi(null)}
            className={`flex items-center gap-2 rounded px-1 text-[12px] transition-opacity ${hi && hi !== p.key ? "opacity-50" : ""}`}
          >
            <Swatch color={p.color} />
            <span className="min-w-0 flex-1 truncate text-sub" title={p.label}>
              {p.label}
            </span>
            <span className="tabular font-semibold text-ink">{p.value}</span>
            <span className="w-9 text-right tabular text-faint">{pct(p.value, sum)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Горизонтальные полосы одной серии: подпись, полоса от общей базы, значение на конце. Один цвет на все полосы
 *  (одна серия — один цвет); «прочее» — нейтральным. */
export function BarList({ rows, onPick }: { rows: (Part & { hint?: string; lead?: ReactNode })[]; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const body = (
          <>
            <span className="flex w-[38%] min-w-0 items-center gap-1.5 text-[12px] text-sub">
              {r.lead}
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
            </span>
            <span className="relative h-2.5 min-w-0 flex-1">
              <span ref={cssVars({ "--p": `${(r.value / max) * 100}%`, "--c": r.color })} className="absolute inset-y-0 left-0 w-[max(var(--p),2px)] rounded-r-[4px] bg-[var(--c)]" />
            </span>
            <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular text-ink">{r.value}</span>
          </>
        );
        return (
          <li key={r.key}>
            {onPick ? (
              <button type="button" onClick={() => onPick(r.key)} title={r.hint} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-hover">
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-2 py-0.5" title={r.hint}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Размер элемента — для графиков, которые рисуются в пикселях (окружности не должны растягиваться). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** «Красивый» верх шкалы: 1, 2, 5 × 10ⁿ — чтобы деления были круглыми. */
export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Две-три линии по неделям на одной оси. Наведение (и стрелки с клавиатуры) — вертикальная линия на ближайшей
 *  неделе и подсказка со всеми сериями; значения последней недели подписаны у концов линий; под графиком —
 *  таблица для скринридера. */
export function Lines({ xs, series, fmtX, height, label }: { xs: string[]; series: Series[]; fmtX: (x: string) => string; height: number; label: string }) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const n = xs.length;
  const LEFT = 26;
  const RIGHT = 30;
  const TOP = 8;
  const BOTTOM = 20;
  const H = Math.max(80, height);
  const plotW = Math.max(10, width - LEFT - RIGHT);
  const plotH = H - TOP - BOTTOM;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => LEFT + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => TOP + (1 - v / top) * plotH;
  const ticks = [0, top / 2, top];
  const last = n - 1;
  // Подписи у концов линий — только если не налезают друг на друга; иначе значения остаются в легенде и подсказке.
  const endYs = series.map((s) => y(s.values[last] ?? 0));
  const endLabels = endYs.every((a, i) => endYs.every((b, j) => i === j || Math.abs(a - b) >= 13));
  const idx = hover ?? last;

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - LEFT;
    setHover(Math.max(0, Math.min(last, Math.round((px / plotW) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHover((h) => Math.max(0, Math.min(last, (h ?? last) + (e.key === "ArrowLeft" ? -1 : 1))));
    }
  };
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const tipLeft = width > 0 ? Math.min(Math.max(0, x(idx) - 70), width - 150) : 0;

  return (
    <div ref={boxRef} className="relative w-full">
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          aria-describedby={tableId}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? "var(--border-default)" : "var(--border-subtle)"} strokeWidth="1" />
              <text x={LEFT - 6} y={y(tk) + 3.5} textAnchor="end" className="fill-[var(--text-3)] text-[10px] tabular">
                {Math.round(tk)}
              </text>
            </g>
          ))}
          {[0, Math.floor(last / 2), last]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((i) => (
              <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="fill-[var(--text-3)] text-[10px]">
                {fmtX(xs[i])}
              </text>
            ))}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(idx)} cy={y(s.values[idx] ?? 0)} r="4" fill={s.color} stroke="var(--bg-panel)" strokeWidth="2" />
              {endLabels && hover === null && (
                <text x={x(last) + 8} y={y(s.values[last] ?? 0) + 3.5} className="fill-[var(--text-2)] text-[10.5px] font-semibold tabular">
                  {s.values[last] ?? 0}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <line x1={x(idx)} x2={x(idx)} y1={TOP} y2={TOP + plotH} stroke="var(--border-strong)" strokeWidth="1" />}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div ref={cssVars({ "--tx": tipLeft })} className="glass pointer-events-none absolute left-[var(--tx)] top-0 z-10 w-[150px] rounded-lg px-2.5 py-2 text-[11.5px] shadow-lg">
          <p className="mb-1 text-faint">{fmtX(xs[idx])}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5">
              <Swatch color={s.color} line />
              <span className="font-semibold tabular text-ink">{s.values[idx] ?? 0}</span>
              <span className="truncate text-sub">{s.label}</span>
            </p>
          ))}
        </div>
      )}
      <table id={tableId} className="sr-only">
        <thead>
          <tr>
            <th scope="col" />
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xs.map((xv, i) => (
            <tr key={xv}>
              <th scope="row">{fmtX(xv)}</th>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Легенда над графиком: ключ повторяет метку (линия — для линий, квадрат — для заливок) и подпись цветом текста. */
export function Legend({ items, line = false }: { items: { key: string; label: string; color: string; value?: ReactNode }[]; line?: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-sub">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          <Swatch color={i.color} line={line} />
          {i.label}
          {i.value !== undefined && <span className="font-semibold tabular text-ink">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Составная полоса: сегменты одной строки через зазор 2px, итог — на конце. Ширина строки — доля от
 *  максимального итога среди строк, чтобы строки сравнивались между собой. */
export function StackedRow({ segments, max, label }: { segments: { key: string; value: number; color: string; label: string }[]; max: number; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const title = `${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" title={title}>
      <span className="relative h-2.5 min-w-0 flex-1">
        <span ref={cssVars({ "--p": `${max > 0 ? (total / max) * 100 : 0}%` })} className="absolute inset-y-0 left-0 flex w-[var(--p)] gap-[2px]">
          {segments
            .filter((s) => s.value > 0)
            .map((s, i, arr) => (
              <span
                key={s.key}
                ref={cssVars({ "--g": String(s.value), "--c": s.color })}
                className={`h-full min-w-[3px] grow-[var(--g)] basis-0 bg-[var(--c)] ${i === arr.length - 1 ? "rounded-r-[4px]" : ""}`}
              />
            ))}
        </span>
      </span>
      <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular text-ink">{total}</span>
    </span>
  );
}

/** Шкала доли: заливка акцентом по светлой ступени того же тона. */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const p = total > 0 ? value / total : 0;
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[var(--accent-subtle)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={label}>
      <span ref={cssVars({ "--p": `${p * 100}%` })} className="absolute inset-y-0 left-0 w-[var(--p)] rounded-full bg-[var(--accent-solid)]" />
    </span>
  );
}
