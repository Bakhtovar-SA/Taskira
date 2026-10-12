/** Select (выбор одного значения из списка) по шаблону APG «select-only combobox»: кнопка role="combobox"
 *  держит фокус, активная строка — aria-activedescendant; ↑/↓, Home/End, PageUp/PageDown, набор первых букв (и в
 *  чужой раскладке), Enter/Space — открыть и выбрать, Esc — закрыть, не закрывая окно вокруг (preventDefault),
 *  Tab — закрыть без выбора. Заменяет нативный `<select>`, который выглядел по-разному в каждом браузере и не
 *  подстраивался под тему. Список — поверхность Popover API (`popover="manual"`, как у Combobox): клик мимо и
 *  потеря фокуса закрывают его, строки рисуются только пока он открыт. Значение может быть строкой или числом —
 *  `onChange` возвращает тот же тип, что в `options`. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { dsId, hidePop, showPop, useAnchored } from "./floating";
import { swapLayout } from "../palette/fuzzy";

export type SelectValue = string | number;
export type SelectOption<T extends SelectValue = string> = {
  value: T;
  label: ReactNode;
  /** Текст для набора первых букв, если `label` — не строка. */
  text?: string;
  disabled?: boolean;
};
export type SelectGroup<T extends SelectValue = string> = { group: string; options: SelectOption<T>[] };
export type SelectItem<T extends SelectValue = string> = SelectOption<T> | SelectGroup<T>;

export type SelectProps<T extends SelectValue> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectItem<T>[];
  /** id кнопки: внешний `<label htmlFor>` продолжает работать. */
  id?: string;
  /** Видимая подпись над полем (как у Input); без неё — внешний label, aria-label или aria-labelledby. */
  label?: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Недоступно; строка — причина (подсказка под полем при `label`, иначе title). */
  disabled?: boolean | string;
  /** Показывается, если `value` нет среди вариантов. */
  placeholder?: ReactNode;
  size?: "sm" | "md";
  /** Во всю ширину контейнера (по умолчанию) или по содержимому. */
  block?: boolean;
  className?: string;
  /** Для обычной отправки формы: скрытое поле с этим именем. */
  name?: string;
  force?: "hover" | "focus";
};

const isGroup = <T extends SelectValue>(it: SelectItem<T>): it is SelectGroup<T> => "group" in it;
/** «ё» = «е» при наборе букв (escape-кодами: страж кириллицы смотрит на строки в коде). */
const norm = (s: string) => s.toLowerCase().replace(/\u0451/g, "\u0435");

function textOf(o: SelectOption<SelectValue>): string {
  if (o.text !== undefined) return o.text;
  if (typeof o.label === "string" || typeof o.label === "number") return String(o.label);
  return String(o.value);
}

const Chevron = () => (
  <svg className="ds-select-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Select<T extends SelectValue>({
  value,
  onChange,
  options,
  id: idProp,
  label,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  hint,
  error,
  disabled,
  placeholder,
  size = "md",
  block = true,
  className = "",
  name,
  force,
}: SelectProps<T>) {
  const [auto] = useState(() => dsId("sel"));
  const id = idProp ?? auto;
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-o${i}`;
  // Плоский список вариантов (для клавиатуры) и номер каждого в нём — группы только для отрисовки.
  const flat = useMemo(() => options.flatMap((it) => (isGroup(it) ? it.options : [it])), [options]);
  const selectedIndex = flat.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? flat[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const wasOpen = useRef(false);
  const off = !!disabled;
  useAnchored(trigger, pop, open, { matchWidth: true, gap: 4 });

  useLayoutEffect(() => {
    if (open) showPop(pop.current);
    else hidePop(pop.current);
  }, [open]);
  // Активная строка видна: прокрутка внутри списка, не всей страницы.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    // Прокручивается сама поверхность (.ds-pop, position: fixed — offsetParent строк).
    const box = pop.current;
    const el = document.getElementById(optId(active));
    if (!box || !el) return;
    const top = el.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Клик мимо (вне кнопки и списка) закрывает; сама кнопка переключает в onClick.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => { if (off) setOpen(false); }, [off]);

  const enabled = (i: number) => i >= 0 && i < flat.length && !flat[i].disabled;
  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < flat.length; i += step) if (enabled(i)) return i;
    return -1;
  };
  const show = (at?: number) => {
    setActive(at ?? (enabled(selectedIndex) ? selectedIndex : firstEnabled(0, 1)));
    setOpen(true);
  };
  const choose = (i: number) => {
    if (!enabled(i)) return;
    setOpen(false);
    if (flat[i].value !== value) onChange(flat[i].value);
  };
  const move = (to: number, step: 1 | -1) => {
    const i = firstEnabled(Math.max(0, Math.min(flat.length - 1, to)), step);
    const j = i >= 0 ? i : firstEnabled(Math.max(0, Math.min(flat.length - 1, to)), step === 1 ? -1 : 1);
    if (j >= 0) setActive(j);
  };
  /** Набор букв: «ппп» перебирает варианты на «п»; ввод не в той раскладке («gj» → «по») тоже находит. */
  const typeahead = (key: string) => {
    const now = Date.now();
    const s = (now - typed.current.t < 600 ? typed.current.s : "") + key.toLowerCase();
    typed.current = { s, t: now };
    const from = open ? active : selectedIndex;
    const repeat = s.length > 1 && [...s].every((c) => c === s[0]);
    const queries = repeat ? [s[0], swapLayout(s[0])] : [s, swapLayout(s)];
    const start = repeat || s.length === 1 ? from + 1 : Math.max(from, 0);
    for (const q of queries.map(norm)) {
      for (let k = 0; k < flat.length; k++) {
        const i = (start + k) % flat.length;
        if (enabled(i) && norm(textOf(flat[i])).trim().startsWith(q)) return i;
      }
    }
    return -1;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (off || e.nativeEvent.isComposing) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        show();
      } else if (k === "Home" || k === "End") {
        e.preventDefault();
        show(k === "Home" ? firstEnabled(0, 1) : firstEnabled(flat.length - 1, -1));
      } else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const hit = typeahead(k);
        show(hit >= 0 ? hit : undefined);
      }
      return;
    }
    if (k === "Escape") {
      // Закрыть только список: Dialog/SidePanel и глобальный обработчик App не реагируют на обработанный Esc.
      e.preventDefault();
      setOpen(false);
    } else if (k === "ArrowDown") { e.preventDefault(); if (e.altKey) return; move(active + 1, 1); }
    else if (k === "ArrowUp") { e.preventDefault(); if (e.altKey) { choose(active); return; } move(active - 1, -1); }
    else if (k === "Home") { e.preventDefault(); move(0, 1); }
    else if (k === "End") { e.preventDefault(); move(flat.length - 1, -1); }
    else if (k === "PageDown") { e.preventDefault(); move(active + 10, 1); }
    else if (k === "PageUp") { e.preventDefault(); move(active - 10, -1); }
    else if (k === "Enter" || (k === " " && Date.now() - typed.current.t > 600)) { e.preventDefault(); choose(active); }
    else if (k === "Tab") setOpen(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const hit = typeahead(k);
      if (hit >= 0) setActive(hit);
    }
  };

  const reason = typeof disabled === "string" ? disabled : undefined;
  const note = error ?? (label ? reason : undefined) ?? hint;
  const noteId = note ? `${id}-note` : undefined;
  const describedBy = [ariaDescribedby, noteId].filter(Boolean).join(" ") || undefined;

  let n = -1;
  const renderOption = (o: SelectOption<T>) => {
    const i = ++n;
    const isSel = i === selectedIndex;
    return (
      <div
        key={`${typeof o.value}:${o.value}`}
        id={optId(i)}
        role="option"
        aria-selected={isSel}
        aria-disabled={o.disabled || undefined}
        data-active={i === active || undefined}
        className="ds-menu-item ds-option ds-select-option"
        onClick={() => { choose(i); trigger.current?.focus(); }}
        onPointerMove={() => { if (i !== active && enabled(i)) setActive(i); }}
      >
        <span className="min-w-0 flex-1 truncate">{o.label}</span>
        {isSel && <Check />}
      </div>
    );
  };

  const button = (
    <button
      ref={trigger}
      id={id}
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      disabled={off}
      title={!label ? reason : undefined}
      data-size={size}
      data-invalid={error ? "" : undefined}
      data-force={force}
      className={`ds-input ds-select ds-focus ${block ? "w-full" : ""} ${className}`}
      onPointerDown={() => { wasOpen.current = open; }}
      onClick={() => {
        if (off) return;
        if (wasOpen.current || open) { wasOpen.current = false; setOpen(false); }
        else show();
      }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!pop.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <span className={`ds-select-value ${selected ? "" : "text-faint"}`}>{selected ? selected.label : placeholder ?? " "}</span>
      <Chevron />
    </button>
  );
  // Имя списка: явная подпись, иначе текст внешнего <label for> (у кнопки он есть в .labels).
  const listName = ariaLabel ?? (typeof label === "string" ? label : undefined) ?? (open && !ariaLabelledby ? trigger.current?.labels?.[0]?.textContent?.trim() || undefined : undefined);

  return (
    <>
      {label || note ? (
        <div className="ds-field">
          {label && (
            <label htmlFor={id} className="ds-label">
              {label}
            </label>
          )}
          {button}
          {note && (
            <p id={noteId} className="ds-hint" data-tone={error ? "error" : undefined} role={error ? "alert" : undefined}>
              {note}
            </p>
          )}
        </div>
      ) : (
        button
      )}
      {name !== undefined && <input type="hidden" name={name} value={String(value)} />}
      {open && (
        // Нажатие в списке (строка, полоса прокрутки) не уводит фокус с кнопки.
        <div ref={pop} popover="manual" className="ds-pop ds-select-pop" onMouseDown={(e) => e.preventDefault()}>
          <div ref={list} id={listId} role="listbox" aria-labelledby={ariaLabelledby} aria-label={listName} className="ds-select-list">
            {options.map((it, gi) =>
              isGroup(it) ? (
                <div key={`g${gi}`} role="group" aria-labelledby={`${id}-g${gi}`}>
                  <div id={`${id}-g${gi}`} className="ds-menu-label" role="presentation">
                    {it.group}
                  </div>
                  {it.options.map(renderOption)}
                </div>
              ) : (
                renderOption(it)
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
