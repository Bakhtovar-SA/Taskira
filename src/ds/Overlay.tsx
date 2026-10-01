/** Поверхности верхнего слоя (ADR-0014): Popover, Menu, Tooltip — на Popover API + `@floating-ui/dom`.
 *  `popover="auto"` сам закрывает по клику мимо и по Esc и держит открытым только один —
 *  широковещательный DROPDOWN_OPEN_EVT (ui.tsx) здесь не нужен. */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { dsId, hidePop, showPop, useAnchored, type Placement } from "./floating";

/* ---------- Popover ---------- */

export type TriggerProps = {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog" | "menu" | "listbox";
  /** Нет, пока содержимое не отрисовано (заглушка LazyOverlay до загрузки чанка). */
  "aria-controls"?: string;
};

export type PopoverProps = {
  trigger: (p: TriggerProps, open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  /** Роль содержимого: обычная панель или меню (тогда управление — у Menu). */
  role?: "dialog" | "menu" | "listbox";
  label?: string;
  className?: string;
  matchWidth?: boolean;
  /** Управляемый режим (для Menu/Combobox/DatePicker). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  initialFocus?: "first" | "none";
};

export function Popover({
  trigger,
  children,
  placement = "bottom-start",
  role = "dialog",
  label,
  className = "",
  matchWidth,
  open: openProp,
  onOpenChange,
  onKeyDown,
  initialFocus = "first",
}: PopoverProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setOpenState(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const [id] = useState(() => dsId("pop"));
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useAnchored(anchor, pop, open, { placement, matchWidth });

  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    showPop(el);
    if (initialFocus === "first") el.querySelector<HTMLElement>("[data-autofocus], button:not([aria-disabled=true]), [href], input, [tabindex]:not([tabindex='-1'])")?.focus();
    // Закрыли снаружи (клик мимо, Esc, открылся другой) — синхронизируем состояние.
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") setOpen(false);
    };
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("toggle", onToggle);
      hidePop(el);
    };
  }, [open, initialFocus, setOpen]);

  const close = useCallback(() => {
    setOpen(false);
    anchor.current?.focus();
  }, [setOpen]);

  return (
    <>
      {trigger(
        { ref: anchor, onClick: () => setOpen(!open), "aria-expanded": open, "aria-haspopup": role, "aria-controls": id },
        open,
      )}
      {open && (
        <div
          ref={pop}
          id={id}
          popover="auto"
          role={role === "listbox" ? undefined : role}
          aria-label={label}
          className={`ds-pop ${className}`}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented) {
              e.preventDefault();
              close();
            }
            onKeyDown?.(e);
          }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </>
  );
}

/* ---------- Menu ---------- */

export type MenuEntry =
  | { kind?: "item"; id: string; label: ReactNode; icon?: ReactNode; hint?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void; text?: string }
  | { kind: "sep"; id: string }
  | { kind: "label"; id: string; label: string };

/** Меню действий по шаблону APG menu button: стрелки, Home/End, набор первых букв, Enter/Space,
 *  фокус возвращается на кнопку. */
export type MenuProps = {
  trigger: PopoverProps["trigger"];
  items: MenuEntry[];
  placement?: Placement;
  label?: string;
  /** Управляемый режим: меню открывают и снаружи (клавиша M на карточке доски). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Menu({ trigger, items, placement = "bottom-start", label, open: openProp, onOpenChange }: MenuProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setOpenState(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const focusables = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = focusables();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const to = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") to(i + 1);
    else if (e.key === "ArrowUp") to(i - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(els.length - 1);
    else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 600 ? typed.current.s : "") + e.key.toLowerCase(), t: now };
      const hit = els.findIndex((el) => (el.dataset.text ?? el.textContent ?? "").trim().toLowerCase().startsWith(typed.current.s));
      if (hit >= 0) to(hit);
    }
  };

  return (
    <Popover trigger={trigger} role="menu" label={label} placement={placement} open={open} onOpenChange={setOpen} onKeyDown={onKeyDown}>
      {(close) => (
        <div ref={listRef} className="flex flex-col">
          {items.map((it) =>
            it.kind === "sep" ? (
              <div key={it.id} role="separator" className="ds-menu-sep" />
            ) : it.kind === "label" ? (
              <div key={it.id} className="ds-menu-label">
                {it.label}
              </div>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-text={it.text}
                aria-disabled={it.disabled || undefined}
                data-tone={it.danger ? "danger" : undefined}
                className="ds-menu-item"
                onClick={() => {
                  if (it.disabled) return;
                  close();
                  it.onSelect();
                }}
              >
                {it.icon && <span className="flex shrink-0">{it.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="ds-menu-hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </Popover>
  );
}

/* ---------- Tooltip ---------- */

type TipChildProps = {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: unknown) => void;
  onPointerLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  "aria-describedby"?: string;
};

/** Подсказка: наведение (400 мс) или фокус с клавиатуры; Esc прячет. Ребёнок — один элемент,
 *  принимающий ref (кнопка). Для кнопки без подписи `label` — ещё и её доступное имя (IconButton). */
export function Tooltip({ label, kbd, children, placement = "top", open: forced }: { label: ReactNode; kbd?: string; children: ReactElement; placement?: Placement; open?: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = forced ?? open;
  const [id] = useState(() => dsId("tip"));
  const anchor = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useAnchored(anchor, tip, shown, { placement, gap: 6 });

  useLayoutEffect(() => {
    if (shown) showPop(tip.current);
    else hidePop(tip.current);
  }, [shown]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Свой ref и обработчики ребёнка не затираются, а дополняются: IconButton передаёт сюда ref кнопки, а Popover/Menu
  // вешают на неё ref якоря и onFocus/onBlur. Раньше Tooltip их подменял — якорь Popover терял кнопку, и фокус после
  // закрытия некуда было вернуть (запрос трека H).
  const own: TipChildProps = isValidElement<TipChildProps>(children) ? children.props : {};
  const ownRef = useRef(own.ref);
  ownRef.current = own.ref;
  const setAnchor = useCallback((el: HTMLElement | null) => {
    anchor.current = el;
    const r = ownRef.current;
    if (typeof r === "function") r(el);
    else if (r) (r as { current: HTMLElement | null }).current = el;
  }, []);

  if (!isValidElement<TipChildProps>(children)) return children;
  const show = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const child = cloneElement(children, {
    ref: setAnchor,
    onPointerEnter: (e: unknown) => {
      own.onPointerEnter?.(e);
      show(400);
    },
    onPointerLeave: (e: unknown) => {
      own.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      own.onFocus?.(e);
      // Только фокус с клавиатуры: клик мышью тоже фокусирует, но подсказка при клике мешает.
      if ((e as { target: HTMLElement }).target.matches(":focus-visible")) show(0);
    },
    onBlur: (e: unknown) => {
      own.onBlur?.(e);
      hide();
    },
    "aria-describedby": own["aria-describedby"] ? `${own["aria-describedby"]} ${id}` : id,
  });
  return (
    <>
      {child}
      <div ref={tip} id={id} role="tooltip" popover="manual" className="ds-tip">
        {label}
        {kbd && <span className="ds-kbd">{kbd}</span>}
      </div>
    </>
  );
}
