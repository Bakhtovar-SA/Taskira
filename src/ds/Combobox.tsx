/** Combobox с асинхронным поиском (для пикеров людей, задач) по APG combobox: фокус остаётся в поле,
 *  активная строка — aria-activedescendant, ↑/↓/Enter/Esc. Пауза 200 мс перед запросом, устаревший
 *  ответ отбрасывается. Состояния: пусто, идёт поиск, ничего не найдено, ошибка. */
import { useOptionalT } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { dsId, hidePop, showPop, useAnchored } from "./floating";
import { Spinner } from "./Button";

export type ComboOption = { id: string; label: string; description?: string; icon?: ReactNode };

export function Combobox({
  label,
  placeholder,
  load,
  onSelect,
  value,
  minChars = 0,
  emptyText,
  errorText,
  hint,
  clearOnSelect = false,
}: {
  label: ReactNode;
  placeholder?: string;
  /** Поиск: вернуть варианты по строке (пустая строка — «недавние»/первые). */
  load: (q: string) => Promise<ComboOption[]>;
  onSelect: (o: ComboOption) => void;
  value?: ComboOption | null;
  minChars?: number;
  emptyText?: string;
  errorText?: string;
  hint?: ReactNode;
  /** Multiple selection: clear the search after adding an option. */
  clearOnSelect?: boolean;
}) {
  const t = useOptionalT()?.t;
  emptyText ??= t ? t("ds.nothingFound") : "Ничего не найдено";
  errorText ??= t ? t("ds.loadFailed") : "Не удалось загрузить";
  const [id] = useState(() => dsId("cb"));
  const [q, setQ] = useState(value?.label ?? "");
  const query = value && q === value.label ? "" : q.trim();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "loading" | "ok" | "error"; query: string; items: ComboOption[] }>({ status: "idle", query: "", items: [] });
  const [active, setActive] = useState(0);
  const field = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);
  useAnchored(field, pop, open, { matchWidth: true, gap: 4 });
  useEffect(() => { if (value) setQ(value.label); }, [value?.id, value?.label]);

  useLayoutEffect(() => {
    if (open) showPop(pop.current);
    else hidePop(pop.current);
  }, [open]);

  useEffect(() => {
    const seq = ++reqSeq.current;
    if (!open) return;
    const s = query;
    if (s.length < minChars) {
      setState({ status: "idle", query: s, items: [] });
      return;
    }
    setState({ status: "loading", query: s, items: [] });
    const t = window.setTimeout(() => {
      load(s).then(
        (items) => seq === reqSeq.current && (setState({ status: "ok", query: s, items }), setActive(s === "" && value ? Math.max(0, items.findIndex(item => item.id === value.id)) : 0)),
        () => seq === reqSeq.current && setState({ status: "error", query: s, items: [] }),
      );
    }, 200);
    return () => { window.clearTimeout(t); reqSeq.current++; };
  }, [q, query, open, load, minChars, value?.id]);

  const pick = (o: ComboOption) => {
    if (state.status !== "ok" || state.query !== query) return;
    onSelect(o);
    setQ(clearOnSelect ? "" : o.label);
    setOpen(false);
  };
  const items = state.status === "ok" && state.query === query ? state.items : [];
  const optId = (i: number) => `${id}-o${i}`;

  return (
    <div className="ds-field">
      <label htmlFor={id} className="ds-label">
        {label}
      </label>
      <div ref={field} className="ds-input">
        <span className="ds-adorn">
          {state.status === "loading" ? (
            <Spinner />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? optId(active) : undefined}
          autoComplete="off"
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => { if (value) setQ(value.label); window.setTimeout(() => setOpen(false), 120); }}
          onChange={(e) => {
            reqSeq.current++;
            setActive(0);
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.max(0, Math.min(items.length - 1, a + 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (items[active]) pick(items[active]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
      </div>
      {hint && <p className="ds-hint">{hint}</p>}
      {open && (
        <div ref={pop} popover="manual" className="ds-pop">
          <div id={`${id}-list`} role="listbox" aria-label={typeof label === "string" ? label : undefined} aria-busy={state.status === "loading" || undefined}>
            {items.map((o, i) => (
              <div
                key={o.id}
                id={optId(i)}
                role="option"
                aria-selected={value?.id === o.id}
                data-active={i === active || undefined}
                className="ds-menu-item ds-option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o.icon && <span className="flex shrink-0">{o.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.description && <span className="block truncate text-[11.5px] text-faint">{o.description}</span>}
                </span>
                {value?.id === o.id && (
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            ))}
            {state.status === "ok" && items.length === 0 && <p className="px-2 py-3 text-center text-[12.5px] text-faint">{emptyText}</p>}
            {state.status === "error" && <p role="status" className="px-2 py-3 text-center text-[12.5px] text-[var(--status-danger-fg)]">{errorText}</p>}
            {state.status === "loading" && <span role="status" className="sr-only">{t ? t("common.loading") : "Загрузка"}</span>}
            {state.status === "loading" && items.length === 0 && (
              <div className="flex flex-col gap-2 p-2" aria-hidden="true">
                <div className="ds-sk h-3.5 w-3/4" />
                <div className="ds-sk h-3.5 w-1/2" />
                <div className="ds-sk h-3.5 w-2/3" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
