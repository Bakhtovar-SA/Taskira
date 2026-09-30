/** Отображение (ТЗ 5.7): Avatar и группа, Tag, Kbd, EmptyState, Progress, ProgressRing, Skeleton, Toast.
 *  Цвета — только токены и тоны `tk-tone-*` (currentColor), без значений из данных в разметке. */
import { useOptionalT } from "../i18n";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Tooltip } from "./LazyTooltip";

export type Tone = "violet" | "indigo" | "blue" | "sky" | "teal" | "green" | "amber" | "orange" | "red" | "pink" | "gray";
const TONES: Tone[] = ["violet", "indigo", "blue", "sky", "teal", "green", "amber", "orange", "red", "pink"];

/** Тон по строке — у одного имени всегда один цвет. */
export const toneOf = (s: string): Tone => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TONES[Math.abs(h) % TONES.length];
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/* ---------- Avatar ---------- */

export type AvatarPerson = { name: string; src?: string | null };

export function Avatar({ person, size = 24, ring, status }: { person: AvatarPerson; size?: 20 | 24 | 28 | 32 | 40 | 64; ring?: boolean; status?: "online" | "away" }) {
  const tone = toneOf(person.name);
  return (
    <span className={`ds-av tk-tone-${tone}`} data-size={size} data-ring={ring || undefined} role="img" aria-label={person.name}>
      {person.src ? <img src={person.src} alt="" /> : <span aria-hidden="true">{initials(person.name)}</span>}
      {status && <span className="ds-av-status" data-status={status} />}
    </span>
  );
}

export function AvatarGroup({ people, max = 4, size = 24 }: { people: AvatarPerson[]; max?: number; size?: 20 | 24 | 28 | 32 }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="ds-av-group" aria-label={people.map((p) => p.name).join(", ")} role="group">
      {shown.map((p) => (
        <Tooltip key={p.name} label={p.name}>
          <span className="flex" tabIndex={-1}>
            <Avatar person={p} size={size} ring />
          </span>
        </Tooltip>
      ))}
      {rest > 0 && (
        <span className="ds-av ds-av-more" data-size={size} data-ring aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ---------- Tag ---------- */

export function Tag({ children, tone = "gray", dot, strong, size = "md", onRemove, removeLabel }: { children: ReactNode; tone?: Tone; dot?: boolean; strong?: boolean; size?: "sm" | "md"; onRemove?: () => void; removeLabel?: string }) {
  const t = useOptionalT()?.t;
  removeLabel ??= t ? t("ds.remove") : "Убрать";
  return (
    <span className={`ds-tag tk-tone-${tone}`} data-size={size} data-strong={strong || undefined}>
      {dot && <span className="ds-tag-dot" />}
      <span className="ds-tag-text">{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`${removeLabel}: ${typeof children === "string" ? children : ""}`}>
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="ds-kbd">{children}</kbd>;

/* ---------- EmptyState ---------- */

export function EmptyState({ icon, title, sub, action }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-empty-art">{icon}</span>
      <p className="ds-empty-title">{title}</p>
      {sub && <p className="ds-empty-sub">{sub}</p>}
      {action && <div className="mt-3 flex gap-2">{action}</div>}
    </div>
  );
}

/* ---------- Progress ---------- */

/** Непрерывное значение — кастомным свойством через CSSOM (ADR-0010 п. 1), не классом на значение. */
function useCssVar<T extends HTMLElement | SVGElement>(name: string, value: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty(name, value);
  }, [name, value]);
  return ref;
}

export function Progress({ value, label, indeterminate }: { value?: number; label: string; indeterminate?: boolean }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const ref = useCssVar<HTMLDivElement>("--p", `${v}%`);
  return (
    <div
      ref={ref}
      className="ds-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : v}
      data-indeterminate={indeterminate || undefined}
    >
      <span />
    </div>
  );
}

export function ProgressRing({ value, size = 28, label }: { value: number; size?: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const ref = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty("stroke-dashoffset", `${c * (1 - v / 100)}`);
  }, [c, v]);
  return (
    <svg className="ds-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <circle className="ds-ring-track" cx={size / 2} cy={size / 2} r={r} />
      <circle ref={ref} className="ds-ring-val" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/* ---------- Skeleton: примитивы, из которых каждый экран собирает СВОЙ скелетон ---------- */

export const Skeleton = {
  Line: ({ w = "100%", h = 12 }: { w?: string; h?: number }) => {
    const ref = useCssVar<HTMLDivElement>("width", w);
    useLayoutEffect(() => {
      ref.current?.style.setProperty("height", `${h}px`);
    }, [h, ref]);
    return <div ref={ref} className="ds-sk" aria-hidden="true" />;
  },
  Block: ({ h = 64, round = false }: { h?: number; round?: boolean }) => {
    const ref = useCssVar<HTMLDivElement>("height", `${h}px`);
    return <div ref={ref} className={`ds-sk ${round ? "rounded-xl" : ""}`} aria-hidden="true" />;
  },
  Circle: ({ size = 24 }: { size?: number }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      ref.current?.style.setProperty("width", `${size}px`);
      ref.current?.style.setProperty("height", `${size}px`);
    }, [size]);
    return <div ref={ref} className="ds-sk shrink-0 rounded-full" aria-hidden="true" />;
  },
};

/** Скелетон карточки — пример сборки из примитивов (Доска делает свой из тех же деталей). */
export const SkeletonCard = () => (
  <div className="flex flex-col gap-2.5 rounded-[10px] bg-panel p-3 shadow-e1 ring-1 ring-inset ring-linesoft" aria-hidden="true">
    <div className="flex items-center gap-2">
      <Skeleton.Circle size={14} />
      <Skeleton.Line w="56px" h={10} />
      <span className="ml-auto">
        <Skeleton.Circle size={20} />
      </span>
    </div>
    <Skeleton.Line w="92%" h={12} />
    <Skeleton.Line w="64%" h={12} />
    <div className="flex gap-1.5">
      <Skeleton.Line w="72px" h={18} />
      <Skeleton.Line w="48px" h={18} />
    </div>
  </div>
);

/* ---------- Toast (вид; очередь — внешний стор useToasts(), ADR-0011) ---------- */

export function Toast({
  kind = "info",
  title,
  sub,
  action,
  onClose,
  durationMs = 5000,
  closeLabel,
}: {
  kind?: "info" | "success" | "error";
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  durationMs?: number;
  closeLabel?: string;
}) {
  const t = useOptionalT()?.t;
  closeLabel ??= t ? t("common.close") : "Закрыть";
  const ref = useCssVar<HTMLDivElement>("--toast-ms", `${durationMs}ms`);
  return (
    <div ref={ref} className="ds-toast" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      <span className="ds-toast-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12">
          {kind === "error" ? (
            <path d="M6 3v3.5M6 8.75v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : kind === "success" ? (
            <path d="m2.75 6.25 2.25 2.25 4.25-4.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M6 5.5V9M6 3.25v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <span className="min-w-0 flex-1 pt-px">
        {title}
        {sub && <span className="ds-toast-sub">{sub}</span>}
      </span>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={closeLabel} className="ds-focus -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {durationMs > 0 && <span className="ds-toast-bar" aria-hidden="true" />}
    </div>
  );
}
