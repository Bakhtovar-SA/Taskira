/** DatePicker (ТЗ 5.7): кнопка-поле → поповер с вводом словами (concept: `parseDateInput`), быстрыми
 *  пресетами и календарём-сеткой (APG date picker dialog: стрелки ±день/неделя, PageUp/PageDown — месяц,
 *  Home/End — начало/конец недели, Enter — выбрать). Значение — ISO `YYYY-MM-DD` или null. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "./Overlay";
import { parseDateInput } from "./dateParse";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const localToday = () => {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
};
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];
const shift = (s: string, days: number) => {
  const [y, m, d] = parts(s);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

export function DatePicker({
  value,
  onChange,
  label,
  placeholder,
  lang = "ru",
  today: todayProp,
  clearLabel,
  markOverdue = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  placeholder?: string;
  lang?: "ru" | "en";
  /** Для тестов и /dev/ui — фиксированное «сегодня». */
  today?: string;
  clearLabel?: string;
  /** Прошедшая дата красным — для срока задачи; для даты начала или вехи прошлое — не ошибка. */
  markOverdue?: boolean;
}) {
  placeholder ??= lang === "en" ? "No due date" : "Без срока";
  clearLabel ??= lang === "en" ? "Remove due date" : "Убрать срок";
  const today = todayProp ?? localToday();
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(value ?? today);
  const [cy, cm] = parts(cursor);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setCursor(value ?? today);
      setText("");
    }
  }, [open, value, today]);

  const parsed = text ? parseDateInput(text, today) : null;
  const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`));

  // Сетка месяца с понедельника; 6 строк — высота не прыгает между месяцами.
  const days = useMemo(() => {
    const first = new Date(Date.UTC(cy, cm - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(cy, cm - 1, 1 - lead + i));
      return { iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), out: d.getUTCMonth() !== cm - 1 };
    });
  }, [cy, cm]);
  const dows = useMemo(() => Array.from({ length: 7 }, (_, i) => fmt(isoOf(2026, 8, 21 + i), { weekday: "short" })), [loc]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveTo = (s: string) => {
    setCursor(s);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-iso="${s}"]`)?.focus());
  };
  const monthShift = (n: number) => {
    const [y, m, d] = parts(cursor);
    const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
    return isoOf(new Date(Date.UTC(y, m - 1 + n, 1)).getUTCFullYear(), new Date(Date.UTC(y, m - 1 + n, 1)).getUTCMonth(), Math.min(d, last));
  };

  const presets: [string, string][] = [
    [lang === "en" ? "Today" : "Сегодня", today],
    [lang === "en" ? "Tomorrow" : "Завтра", shift(today, 1)],
    [lang === "en" ? "Friday" : "Пятница", parseDateInput("fri", today)!],
    [lang === "en" ? "In a week" : "Через неделю", shift(today, 7)],
    [lang === "en" ? "In a month" : "Через месяц", parseDateInput("+1m", today)!],
  ];
  const overdue = markOverdue && !!value && value < today;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      initialFocus="first"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`${label}: ${value ? fmt(value, { day: "numeric", month: "long", year: "numeric" }) : placeholder}`}
          className={`ds-input ds-focus min-w-[168px] cursor-pointer text-left ${overdue ? "text-[var(--status-danger-fg)]" : ""}`}
        >
          <span className="ds-adorn">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2.5 6.75h11M5.5 1.75v3M10.5 1.75v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className={`flex-1 truncate text-[13px] font-medium ${value ? "" : "text-faint"}`}>{value ? fmt(value, { day: "numeric", month: "short", year: value.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }) : placeholder}</span>
        </button>
      )}
    >
      {(close) => {
        const commit = (v: string | null) => {
          onChange(v);
          close();
        };
        return (
          <div className="flex w-[260px] flex-col gap-2 p-1">
            <div className="ds-input">
              <input
                data-autofocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && parsed) {
                    e.preventDefault();
                    commit(parsed);
                  }
                }}
                placeholder={lang === "en" ? "tomorrow, fri, +3, 15.10…" : "завтра, пт, +3, 15.10…"}
                aria-label={label}
                aria-describedby="ds-date-preview"
              />
            </div>
            <p id="ds-date-preview" className="-mt-1 min-h-[16px] px-1 text-[11.5px] text-faint" aria-live="polite">
              {text ? (parsed ? <span className="font-semibold text-accenttext">{fmt(parsed, { weekday: "long", day: "numeric", month: "long" })} · Enter</span> : lang === "en" ? "Not a date" : "Не похоже на дату") : ""}
            </p>
            <div className="flex flex-wrap gap-1">
              {presets.map(([l, v]) => (
                <button key={l} type="button" onClick={() => commit(v)} className="ds-focus rounded-md px-2 py-1 text-[12px] font-semibold text-sub ring-1 ring-inset ring-linesoft hover:bg-hover hover:text-ink">
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center justify-between px-1">
              <button type="button" className="ds-focus grid h-7 w-7 place-items-center rounded-md text-sub hover:bg-hover" aria-label={lang === "en" ? "Previous month" : "Предыдущий месяц"} onClick={() => setCursor(monthShift(-1))}>
                ‹
              </button>
              <span className="text-[13px] font-bold text-ink first-letter:uppercase" aria-live="polite">
                {fmt(isoOf(cy, cm - 1, 1), { month: "long", year: "numeric" })}
              </span>
              <button type="button" className="ds-focus grid h-7 w-7 place-items-center rounded-md text-sub hover:bg-hover" aria-label={lang === "en" ? "Next month" : "Следующий месяц"} onClick={() => setCursor(monthShift(1))}>
                ›
              </button>
            </div>
            <div ref={grid} role="grid" aria-label={fmt(isoOf(cy, cm - 1, 1), { month: "long", year: "numeric" })} className="ds-cal self-center">
              {dows.map((d) => (
                <span key={d} className="ds-cal-dow" aria-hidden="true">
                  {d}
                </span>
              ))}
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  role="gridcell"
                  data-iso={d.iso}
                  data-out={d.out || undefined}
                  data-today={d.iso === today || undefined}
                  aria-selected={d.iso === value}
                  aria-label={fmt(d.iso, { weekday: "long", day: "numeric", month: "long" })}
                  tabIndex={d.iso === cursor ? 0 : -1}
                  className="ds-cal-day"
                  onClick={() => commit(d.iso)}
                  onKeyDown={(e) => {
                    const [y, m, dd] = parts(d.iso);
                    const wd = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
                    const k: Record<string, () => string> = {
                      ArrowRight: () => shift(d.iso, 1),
                      ArrowLeft: () => shift(d.iso, -1),
                      ArrowDown: () => shift(d.iso, 7),
                      ArrowUp: () => shift(d.iso, -7),
                      Home: () => shift(d.iso, -wd),
                      End: () => shift(d.iso, 6 - wd),
                      PageDown: () => monthShift(1),
                      PageUp: () => monthShift(-1),
                    };
                    if (k[e.key]) {
                      e.preventDefault();
                      moveTo(k[e.key]());
                    }
                  }}
                >
                  {d.day}
                </button>
              ))}
            </div>
            {value && (
              <button type="button" onClick={() => commit(null)} className="ds-focus mt-1 rounded-md py-1.5 text-[12px] font-semibold text-faint hover:bg-hover hover:text-[var(--status-danger-fg)]">
                {clearLabel}
              </button>
            )}
          </div>
        );
      }}
    </Popover>
  );
}
