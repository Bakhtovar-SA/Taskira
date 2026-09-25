import type { IssueTypeId, PriorityId } from "./types";
import { useId } from "react";
import { useT } from "./i18n";


/** Иконки — собственный двухтоновый набор (ADR-0016). Сетка 16 px: прямые
 *  края и толщины — целые пиксели, поэтому на обычном экране (1x) значок не
 *  размывается, а на Retina/4K он векторный на любом размере.
 *  Слои (стили — .tk-ic в index.css): .s — рисунок (сплошной цвет),
 *  .t — тон (заливка ~24 % того же цвета), .k — редкие штрихи 2 px.
 *  `tone` — фирменный тон раздела (навигация); без него значок берёт цвет
 *  текста, чтобы служебный хром не пестрил. */
export type IconTone = "violet" | "indigo" | "blue" | "sky" | "teal" | "green" | "amber" | "orange" | "red" | "pink" | "gray";
type P = { size?: number; className?: string; tone?: IconTone };

const D = ({ size = 16, className = "", tone, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" className={`tk-ic ${tone ? `tk-tone-${tone}` : ""} ${className}`} aria-hidden="true">
    {children}
  </svg>
);
const R = ({ x, y, w, h, r = 1, c = "s" }: { x: number; y: number; w: number; h: number; r?: number; c?: "s" | "t" }) => (
  <rect className={c} x={x} y={y} width={w} height={h} rx={r} />
);
const Plate = () => <R x={1} y={1} w={14} h={14} r={3.5} c="t" />;

/** Знак Taskira «Отметка» (ТЗ 5.5, выбор владельца 25.09.2026, ADR-0016):
 *  перекладина — «Т», длинное плечо галочки становится ножкой буквы и
 *  упирается в перекладину. Основной знак — один цвет без плашки
 *  (`variant="mark"` — фирменный цвет `--logo`, `"mono"` — currentColor).
 *  `"app"` — иконка приложения на плашке: фавикон, ярлык, PWA; те же файлы
 *  лежат в public/ (scripts/generate-brand-assets.mjs). */
export const LOGO_MARK_PATHS = ["M3 5.05h18", "M5.86 14.6 9.68 18.94 15.08 5.05"] as const;
const LOGO_APP_PATHS = ["M7.5 9.4h17", "M10.2 18.4 13.8 22.5 18.9 9.4"] as const;

export const Logo = ({ size = 24, variant = "mark", className }: P & { variant?: "mark" | "mono" | "app" }) => {
  const id = useId().replace(/:/g, "");
  if (variant !== "app")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`${variant === "mark" ? "text-[var(--logo)]" : ""} ${className ?? ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {LOGO_MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.66 0.19 300)" />
          <stop offset="1" stopColor="oklch(0.45 0.21 278)" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(1 0 0)" stopOpacity="0.3" />
          <stop offset="0.55" stopColor="oklch(1 0 0)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-plate)`} />
      <rect width="32" height="32" rx="9" fill={`url(#${id}-sheen)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="oklch(1 0 0)" strokeOpacity="0.18" />
      <g fill="none" stroke="oklch(0.99 0.006 288)" strokeWidth={3.1} strokeLinecap="round" strokeLinejoin="round">
        {LOGO_APP_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
};

export const TypeIcon = ({ type, size = 15 }: { type: IssueTypeId | string; size?: number }) => {
  const { t } = useT();
  if (type === "bug")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="tk-ic tk-tone-red" role="img" aria-label={t("issueType.bug")}>
        <circle className="t" cx="8" cy="8" r="7" />
        <path className="s" d="M8 4.5a2.75 2.75 0 0 1 2.75 2.75v2.5a2.75 2.75 0 0 1-5.5 0v-2.5A2.75 2.75 0 0 1 8 4.5z" />
        <path className="k" d="M4 7h1.25M10.75 7H12M4.25 11h1M10.75 11h1" />
      </svg>
    );
  if (type === "request")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="tk-ic tk-tone-teal" role="img" aria-label={t("issueType.request")}>
        <path className="t" d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7l-4 3v-3.2A3 3 0 0 1 1 10z" />
        <rect className="s" x="4" y="5" width="8" height="2" rx="1" />
        <rect className="s" x="4" y="8" width="5" height="2" rx="1" />
      </svg>
    );
  /* task (и legacy story/epic → как задача) */
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="tk-ic tk-tone-violet" role="img" aria-label={t("issueType.task")}>
      <rect className="t" x="1" y="1" width="14" height="14" rx="4" />
      <path className="k" d="M4.75 8.25 7 10.5l4.25-4.75" />
    </svg>
  );
};

/** Цвет приоритета — токены темы var(--c-prio-*). */
export const PRIORITY_COLOR: Record<PriorityId, string> = {
  critical: "var(--c-prio-critical)",
  high: "var(--c-prio-high)",
  medium: "var(--c-prio-medium)",
  low: "var(--c-prio-low)",
};

/** Приоритет — ступени сигнала (1–3), «Критичный» — отдельная форма
 *  (плашка с «!»), а не четвёртая ступень: срочное читается формой, не
 *  подсчётом столбиков. Цвет — только у критичного; остальное — чернила. */
export const PriorityIcon = ({ p, size = 15 }: { p: PriorityId; size?: number }) => {
  const { t } = useT();
  if (p === "critical")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={t(`priority.${p}`)}>
        <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--c-prio-critical)" />
        <rect x="7" y="4" width="2" height="5" rx="1" fill="var(--text-on-accent)" />
        <rect x="7" y="10.5" width="2" height="2" rx="1" fill="var(--text-on-accent)" />
      </svg>
    );
  const lvl = p === "high" ? 3 : p === "medium" ? 2 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={t(`priority.${p}`)}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4.5}
          y={10 - i * 3.5}
          width="3"
          height={4 + i * 3.5}
          rx="1"
          fill={i < lvl ? "var(--text-2)" : "var(--text-3)"}
          opacity={i < lvl ? 1 : 0.35}
        />
      ))}
    </svg>
  );
};

/** Глиф статуса: доля заполненного круга = доля пути по процессу.
 *  `position` — место статуса в своём workflow (0…1); todo — пустой круг,
 *  done — закрытый круг с галочкой. */
export const StatusGlyph = ({ category, position = 0.5, size = 14 }: { category: "todo" | "inprogress" | "done"; position?: number; size?: number }) => {
  const color = category === "done" ? "var(--status-done)" : category === "inprogress" ? "var(--status-progress)" : "var(--status-todo)";
  if (category === "done")
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6.5" fill={color} />
        <path d="m4.3 7.2 1.9 1.9 3.5-3.7" fill="none" stroke="var(--bg-panel)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  const f = category === "todo" ? 0 : Math.min(0.85, Math.max(0.35, position));
  const r = 3.25;
  const a = f * 2 * Math.PI;
  const x = 7 + r * Math.sin(a);
  const y = 7 - r * Math.cos(a);
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.75" fill="none" stroke={color} strokeWidth="1.5" />
      {f > 0 && <path d={`M7 7 7 ${7 - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`} fill={color} />}
    </svg>
  );
};

/** Кольцо срока: дуга заполняется по мере приближения даты (окно 14 дней),
 *  тёплая — за 3 дня, красная — просрочено. Срочность видна без чтения цифр. */
export const DueRing = ({ due, today, size = 13, done = false }: { due: string; today: string; size?: number; done?: boolean }) => {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
  const late = !done && days < 0;
  const f = done ? 1 : late ? 1 : Math.max(0.08, Math.min(1, 1 - days / 14));
  const r = 4.75;
  const C = 2 * Math.PI * r;
  const color = done ? "var(--status-done)" : late ? "var(--status-danger)" : days <= 3 ? "var(--orange-solid)" : "var(--text-3)";
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeDasharray={`${(C * f).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 7 7)" />
    </svg>
  );
};

export const IcSearch = (p: P) => (
  <D {...p}>
    <circle className="t" cx="7" cy="7" r="3.5" />
    <path className="s" fillRule="evenodd" d="M7 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
    <path className="s" d="m10.4 11.8 1.4-1.4 3 3a1 1 0 0 1-1.4 1.4z" />
  </D>
);
export const IcPlus = (p: P) => (
  <D {...p}>
    <R x={7} y={2} w={2} h={12} />
    <R x={2} y={7} w={12} h={2} />
  </D>
);
export const IcX = (p: P) => (
  <D {...p}>
    <g transform="rotate(45 8 8)">
      <R x={7} y={1.5} w={2} h={13} />
      <R x={1.5} y={7} w={13} h={2} />
    </g>
  </D>
);
export const IcChevD = (p: P) => <D {...p}><path className="k" d="m4 6 4 4 4-4" /></D>;
export const IcChevR = (p: P) => <D {...p}><path className="k" d="m6 4 4 4-4 4" /></D>;
export const IcBoard = (p: P) => (
  <D {...p}>
    <Plate />
    <R x={3} y={3} w={3} h={10} />
    <R x={7} y={3} w={3} h={6} />
    <R x={11} y={3} w={2} h={8} />
  </D>
);
export const IcBacklog = (p: P) => (
  <D {...p}>
    <Plate />
    <R x={3} y={4} w={2} h={2} />
    <R x={6} y={4} w={7} h={2} />
    <R x={3} y={7} w={2} h={2} />
    <R x={6} y={7} w={7} h={2} />
    <R x={3} y={10} w={2} h={2} />
    <R x={6} y={10} w={5} h={2} />
  </D>
);
export const IcTimeline = (p: P) => (
  <D {...p}>
    <Plate />
    <R x={3} y={4} w={6} h={2} />
    <R x={6} y={7} w={7} h={2} />
    <R x={4} y={10} w={5} h={2} />
  </D>
);
export const IcRoadmap = (p: P) => (
  <D {...p}>
    <Plate />
    <R x={3} y={4} w={5} h={2} />
    <R x={6} y={7} w={7} h={2} />
    <path className="s" d="m6 9.5 2 2-2 2-2-2z" />
  </D>
);
export const IcFlow = (p: P) => (
  <D {...p}>
    <path className="k k-soft" d="M5 4h1.5A2.5 2.5 0 0 1 9 6.5v3A2.5 2.5 0 0 1 6.5 12H5M9 8h2" />
    <circle className="s" cx="4" cy="4" r="2.25" />
    <circle className="s" cx="4" cy="12" r="2.25" />
    <circle className="s" cx="12.5" cy="8" r="2.25" />
  </D>
);
export const IcBell = (p: P) => (
  <D {...p}>
    <path className="t" d="M3.5 11V7a4.5 4.5 0 0 1 9 0v4l1.5 1.5v.5H2v-.5z" />
    <R x={1} y={11} w={14} h={2} />
    <path className="s" d="M6.25 14h3.5a1.75 1.75 0 0 1-3.5 0z" />
  </D>
);
export const IcTrash = (p: P) => (
  <D {...p}>
    <path className="t" d="M3.5 5h9l-.75 8.6a1.5 1.5 0 0 1-1.5 1.4h-4.5a1.5 1.5 0 0 1-1.5-1.4z" />
    <R x={1.5} y={3} w={13} h={2} />
    <R x={6} y={1} w={4} h={2} />
    <R x={6} y={7.5} w={1.5} h={5} r={0.75} />
    <R x={8.5} y={7.5} w={1.5} h={5} r={0.75} />
  </D>
);
export const IcPencil = (p: P) => (
  <D {...p}>
    <path className="t" d="M1.75 14.25 2.6 11l2.4 2.4z" />
    <path className="s" d="M11 1.9a1.6 1.6 0 0 1 2.25 0l.85.85a1.6 1.6 0 0 1 0 2.25L6.4 12.7 3.3 9.6z" />
  </D>
);
export const IcCamera = (p: P) => (
  <D {...p}>
    <path className="t" d="M1 5.5a2 2 0 0 1 2-2h1.5l1-1.5h5l1 1.5H13a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
    <path className="s" fillRule="evenodd" d="M8 5.25a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 1.75a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z" />
  </D>
);
export const IcPhone = (p: P) => (
  <D {...p}>
    <path className="s" d="M3.6 1.6 5.8 1.3l1.2 3-1.3 1.3c.5 1.3 1.9 2.7 3.2 3.2l1.3-1.3 3 1.2-.3 2.2c-.2 1.1-1.2 1.8-2.3 1.7C6.4 12.1 2.9 8.6 2.4 4.4 2.3 3.2 2.6 2 3.6 1.6z" />
  </D>
);
export const IcBriefcase = (p: P) => (
  <D {...p}>
    <R x={1} y={4} w={14} h={10} r={2.5} c="t" />
    <path className="s" fillRule="evenodd" d="M5.5 4V3a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10.5 3v1H9V3H7v1z" />
    <R x={1} y={8} w={14} h={2} r={0} />
  </D>
);
export const IcLink = (p: P) => <D {...p}><path className="k" d="M6.75 9.25a3 3 0 0 0 4.25 0l2-2A3 3 0 0 0 8.75 3l-.5.5M9.25 6.75a3 3 0 0 0-4.25 0l-2 2A3 3 0 0 0 7.25 13l.5-.5" /></D>;
export const IcDots = (p: P) => (
  <D {...p}>
    <circle className="s" cx="3" cy="8" r="1.5" />
    <circle className="s" cx="8" cy="8" r="1.5" />
    <circle className="s" cx="13" cy="8" r="1.5" />
  </D>
);
export const IcCheck = (p: P) => <D {...p}><path className="k" d="m3 8.5 3.25 3.25L13 4.5" /></D>;
export const IcCalendar = (p: P) => (
  <D {...p}>
    <R x={1} y={3} w={14} h={12} r={2.5} c="t" />
    <path className="s" d="M1 5.5A2.5 2.5 0 0 1 3.5 3h9A2.5 2.5 0 0 1 15 5.5V7H1z" />
    <R x={4} y={1} w={2} h={4} />
    <R x={10} y={1} w={2} h={4} />
    <R x={4} y={9} w={2} h={2} r={0.5} />
    <R x={7} y={9} w={2} h={2} r={0.5} />
    <R x={10} y={9} w={2} h={2} r={0.5} />
  </D>
);
export const IcBolt = (p: P) => <D {...p}><path className="s" d="M9.5 1 3 9h4.5L6.5 15 13 7H8.5z" /></D>;
export const IcStar = (p: P & { filled?: boolean }) => (
  <D {...p}>
    <path className={p.filled ? "s" : "t"} d="m8 1.5 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  </D>
);
export const IcSend = (p: P) => (
  <D {...p}>
    <path className="t" d="M14.5 1.5 1.5 6.75 6.5 9z" />
    <path className="s" d="M14.5 1.5 6.9 9.4l2.2 5.1z" />
  </D>
);
export const IcFilter = (p: P) => (
  <D {...p}>
    <R x={2} y={3} w={12} h={2} />
    <R x={4} y={7} w={8} h={2} />
    <R x={6} y={11} w={4} h={2} />
  </D>
);
export const IcUndo = (p: P) => (
  <D {...p}>
    <path className="k" d="M4.5 6.5h6a3.5 3.5 0 0 1 0 7H7" />
    <path className="s" d="M1.5 6.5 5.5 3v7z" />
  </D>
);
export const IcLock = (p: P) => (
  <D {...p}>
    <path className="k" d="M5 7V5a3 3 0 0 1 6 0v2" />
    <R x={2.5} y={7} w={11} h={8} r={2.5} c="t" />
    <R x={7} y={9.5} w={2} h={3} />
  </D>
);
export const IcFlag = (p: P) => (
  <D {...p}>
    <path className="t" d="M4.5 2h9l-2 3.25 2 3.25h-9z" />
    <R x={2.5} y={1.5} w={2} h={13} />
  </D>
);
export const IcInbox = (p: P) => (
  <D {...p}>
    <path className="t" d="M2 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    <path className="s" d="M2 9h3.25l1 1.5h3.5l1-1.5H14v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
  </D>
);
export const IcShield = (p: P) => (
  <D {...p}>
    <path className="t" d="M8 1 14 3.2v4.3c0 3.5-2.4 6-6 7.5-3.6-1.5-6-4-6-7.5V3.2z" />
    <path className="k" d="M5.25 7.75 7.25 9.75 10.75 6.25" />
  </D>
);
export const IcBook = (p: P) => (
  <D {...p}>
    <path className="s" d="M1 3a1 1 0 0 1 1-1h4a2 2 0 0 1 2 2v10.25C7.5 13.5 6.75 13 6 13H1z" />
    <path className="t" d="M15 3a1 1 0 0 0-1-1h-4a2 2 0 0 0-2 2v10.25c.5-.75 1.25-1.25 2-1.25h5z" />
  </D>
);
export const IcUsers = (p: P) => (
  <D {...p}>
    <circle className="t" cx="11" cy="5" r="2.5" />
    <path className="t" d="M9 14c.25-2.5 1.5-4 3.5-4S15.75 11.5 16 14z" />
    <circle className="s" cx="6" cy="5" r="3" />
    <path className="s" d="M.75 14.75C1 11.75 3 10 6 10s5 1.75 5.25 4.75z" />
  </D>
);
export const IcEye = (p: P) => (
  <D {...p}>
    <path className="t" d="M.75 8S3.5 3 8 3s7.25 5 7.25 5S12.5 13 8 13 .75 8 .75 8z" />
    <circle className="s" cx="8" cy="8" r="2.5" />
  </D>
);
/** Перемещение задачи между колонками (кнопка «переместить» на карточке доски). */
export const IcMove = (p: P) => (
  <D {...p}>
    <path className="s" d="M2 3.5h7V1.5l4.5 3-4.5 3v-2H2z" />
    <path className="t" d="M14 10.5H7v-2l-4.5 3 4.5 3v-2h7z" />
  </D>
);
/** Отчёты (столбики). */
export const IcReport = (p: P) => (
  <D {...p}>
    <Plate />
    <R x={3} y={9} w={2} h={4} r={0.75} />
    <R x={7} y={6} w={2} h={7} r={0.75} />
    <R x={11} y={3} w={2} h={10} r={0.75} />
  </D>
);
/** Скачать файл. */
export const IcDownload = (p: P) => (
  <D {...p}>
    <path className="s" d="M7 1.5h2V8h2.5L8 11.5 4.5 8H7z" />
    <R x={1.5} y={12.5} w={13} h={2} c="t" />
  </D>
);
/** Архив (закрытые задачи, убранные из активного набора). */
export const IcArchive = (p: P) => (
  <D {...p}>
    <R x={2} y={6} w={12} h={9} r={1.5} c="t" />
    <R x={1} y={2} w={14} h={4} r={1.5} />
    <R x={6} y={8} w={4} h={2} />
  </D>
);
export const IcHome = (p: P) => (
  <D {...p}>
    <path className="t" d="M2 7.5 8 2.5l6 5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    <path className="s" d="M1 7.2 8 1.4l7 5.8-1 1.2L8 3.4 2 8.4z" />
    <path className="s" d="M6.5 14v-3a1.5 1.5 0 0 1 3 0v3z" />
  </D>
);
export const IcMyIssues = (p: P) => (
  <D {...p}>
    <circle className="t" cx="8" cy="8" r="7" />
    <path className="k" d="M5 8.25 7 10.25 11 6" />
  </D>
);
export const IcSettings = (p: P) => (
  <D {...p}>
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <rect key={a} className="s" x="6.75" y=".75" width="2.5" height="3" rx=".75" transform={`rotate(${a} 8 8)`} />
    ))}
    <path className="s" fillRule="evenodd" d="M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
  </D>
);
export const IcCompose = (p: P) => (
  <D {...p}>
    <R x={1} y={3} w={12} h={12} r={3} c="t" />
    <path className="s" d="M12.25 1.5a1.5 1.5 0 0 1 2.25 2.25L9 9.25 6 10l.75-3z" />
  </D>
);
export const IcComment = (p: P) => (
  <D {...p}>
    <path className="t" d="M1 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-4 3v-3a2 2 0 0 1-2-2z" />
    <circle className="s" cx="5" cy="7" r="1.25" />
    <circle className="s" cx="8" cy="7" r="1.25" />
    <circle className="s" cx="11" cy="7" r="1.25" />
  </D>
);
export const IcDiamond = (p: P) => (
  <D {...p}>
    <path className="t" d="M8 1 15 8l-7 7-7-7z" />
    <path className="s" d="M8 4.5 11.5 8 8 11.5 4.5 8z" />
  </D>
);
export const IcDisplay = (p: P) => (
  <D {...p}>
    <R x={1} y={4} w={14} h={2} c="t" />
    <R x={1} y={10} w={14} h={2} c="t" />
    <circle className="s" cx="10.5" cy="5" r="2.5" />
    <circle className="s" cx="5.5" cy="11" r="2.5" />
  </D>
);
export const IcSparkle = (p: P) => (
  <D {...p}>
    <path className="s" d="M7 1c.5 3.25 1.5 4.25 4.75 4.75C8.5 6.25 7.5 7.25 7 10.5 6.5 7.25 5.5 6.25 2.25 5.75 5.5 5.25 6.5 4.25 7 1z" />
    <path className="t" d="M12 9c.25 1.75.75 2.25 2.5 2.5-1.75.25-2.25.75-2.5 2.5-.25-1.75-.75-2.25-2.5-2.5 1.75-.25 2.25-.75 2.5-2.5z" />
  </D>
);
export const IcSun = (p: P) => (
  <D {...p}>
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <rect key={a} className="s" x="7.25" y=".5" width="1.5" height="2.5" rx=".75" transform={`rotate(${a} 8 8)`} />
    ))}
    <circle className="s" cx="8" cy="8" r="3.25" />
  </D>
);
export const IcMoon = (p: P) => <D {...p}><path className="s" d="M14 9.75A6.25 6.25 0 0 1 6.25 2 6.25 6.25 0 1 0 14 9.75z" /></D>;
export const IcKeyboard = (p: P) => (
  <D {...p}>
    <R x={0.5} y={3} w={15} h={10} r={2.5} c="t" />
    {[2.5, 5.5, 8.5, 11.5].map((x) => (
      <R key={x} x={x} y={5.25} w={2} h={2} r={0.6} />
    ))}
    <R x={4} y={9.5} w={8} h={1.75} r={0.875} />
  </D>
);
export const IcGlobe = (p: P) => (
  <D {...p}>
    <circle className="t" cx="8" cy="8" r="7" />
    <path className="s" fillRule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.6c-.55.5-1.3 1.9-1.52 4.65h3.04C9.3 4.5 8.55 3.1 8 2.6zm1.52 6.15H6.48C6.7 11.5 7.45 12.9 8 13.4c.55-.5 1.3-1.9 1.52-4.65zM2.65 8.75a5.4 5.4 0 0 0 2.6 3.9c-.4-1-.7-2.3-.8-3.9zm0-1.5h1.8c.1-1.6.4-2.9.8-3.9a5.4 5.4 0 0 0-2.6 3.9zm8.9 1.5c-.1 1.6-.4 2.9-.8 3.9a5.4 5.4 0 0 0 2.6-3.9zm1.8-1.5a5.4 5.4 0 0 0-2.6-3.9c.4 1 .7 2.3.8 3.9z" />
  </D>
);
