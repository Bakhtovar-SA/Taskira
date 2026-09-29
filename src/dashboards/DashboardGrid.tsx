/** Сетка дашборда на 12 колонок (ADR-0022). Просмотр — CSS Grid, место виджета — CSS-переменная через CSSOM
 *  (ADR-0010). Правка — нативный drag-and-drop за шапку виджета, растягивание за угол указателем и клавиатура:
 *  на рамке виджета стрелки двигают, Shift+стрелки меняют размер, Delete убирает. Уже ниже 768 px сетка
 *  становится одной колонкой, виджеты идут в порядке чтения. */
import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { cssVars } from "../cssVars";
import { IcMove, IcSettings, IcTrash } from "../icons";
import { byReadingOrder, cellAt, moveTo, nudge, resizeTo, spanFor } from "./grid";
import type { Widget } from "./catalog";

export const ROW_H = 56;
export const GAP = 12;
const DRAG_TYPE = "application/x-taskira-widget";

export function DashboardGrid({
  widgets,
  editing,
  onChange,
  onRemove,
  renderFrame,
}: {
  widgets: Widget[];
  editing: boolean;
  onChange: (next: Widget[]) => void;
  onRemove: (id: string) => void;
  renderFrame: (w: Widget, dragProps: DragHandleProps) => ReactNode;
}) {
  const { t } = useT();
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Где внутри виджета его «взяли» — в клетках, чтобы виджет не прыгал левым верхним углом под указатель.
  const grab = useRef({ dx: 0, dy: 0 });
  const [announce, setAnnounce] = useState("");
  const ordered = [...widgets].sort(byReadingOrder);
  const maxRow = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);

  const onDragStart = (w: Widget) => (e: DragEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    e.dataTransfer.setData(DRAG_TYPE, w.id);
    e.dataTransfer.effectAllowed = "move";
    const r = grid.getBoundingClientRect();
    const c = cellAt(e.clientX - r.left, e.clientY - r.top, r.width, ROW_H, GAP);
    grab.current = { dx: c.col - w.x, dy: c.row - w.y };
    setDragging(w.id);
  };
  const onDragOver = (e: DragEvent) => {
    if (!dragging || !gridRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = gridRef.current.getBoundingClientRect();
    const c = cellAt(e.clientX - r.left, e.clientY - r.top, r.width, ROW_H, GAP);
    const cur = widgets.find((w) => w.id === dragging);
    if (!cur) return;
    const x = c.col - grab.current.dx;
    const y = c.row - grab.current.dy;
    if (x !== cur.x || y !== cur.y) {
      const next = moveTo(widgets, dragging, x, y);
      if (next.some((n, i) => n.x !== widgets[i].x || n.y !== widgets[i].y)) onChange(next);
    }
  };
  const endDrag = () => setDragging(null);

  // Растягивание за угол: указатель захватывается, размер — в клетках от левого верхнего угла виджета.
  const startResize = (w: Widget) => (e: RPointerEvent<HTMLButtonElement>) => {
    const grid = gridRef.current;
    const frame = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-widget]");
    if (!grid || !frame) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const g = grid.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    let last = { w: w.w, h: w.h };
    let current = widgets;
    const move = (ev: PointerEvent) => {
      const s = spanFor(ev.clientX - f.left, ev.clientY - f.top, g.width, ROW_H, GAP);
      if (s.w === last.w && s.h === last.h) return;
      last = s;
      current = resizeTo(current, w.id, s.w, s.h);
      onChange(current);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onFrameKey = (w: Widget) => (e: KeyboardEvent<HTMLElement>) => {
    if (!editing || e.target !== e.currentTarget) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(w.id);
      return;
    }
    const next = nudge(widgets, w.id, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    const me = next.find((n) => n.id === w.id)!;
    setAnnounce(e.shiftKey ? t("dash.a11y.resized", { w: me.w, h: me.h }) : t("dash.a11y.moved", { x: me.x + 1, y: me.y + 1 }));
    // Фокус остаётся на том же виджете, хотя в порядке чтения он мог переехать.
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-widget="${w.id}"]`)?.focus());
  };

  return (
    <>
      <div
        ref={(el) => {
          gridRef.current = el;
          cssVars({ "--rows": String(Math.max(maxRow, 1)), "--row-h": ROW_H, "--gap": GAP })(el);
        }}
        onDragOver={onDragOver}
        onDrop={(e) => {
          e.preventDefault();
          endDrag();
        }}
        className={`dash-grid ${editing ? "dash-grid-editing" : ""}`}
        data-dragging={dragging ? "true" : undefined}
      >
        {ordered.map((w) => (
          <section
            key={w.id}
            data-widget={w.id}
            data-drag={dragging === w.id ? "true" : undefined}
            ref={cssVars({ "--gc": `${w.x + 1} / span ${w.w}`, "--gr": `${w.y + 1} / span ${w.h}`, "--h": String(w.h) })}
            tabIndex={editing ? 0 : undefined}
            onKeyDown={onFrameKey(w)}
            aria-roledescription={editing ? t("dash.a11y.widget") : undefined}
            className="dash-cell"
          >
            {renderFrame(w, { draggable: editing, onDragStart: onDragStart(w), onDragEnd: endDrag, onResizeStart: startResize(w) })}
          </section>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </>
  );
}

export interface DragHandleProps {
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onResizeStart: (e: RPointerEvent<HTMLButtonElement>) => void;
}

/** Рамка виджета: заголовок (в правке — ручка переноса), кнопки настройки и удаления, угол растягивания. */
export function WidgetFrame({
  title,
  hint,
  editing,
  drag,
  onConfigure,
  onRemove,
  loading,
  children,
}: {
  title: string;
  hint?: string;
  editing: boolean;
  drag: DragHandleProps;
  onConfigure?: (anchor: HTMLElement) => void;
  onRemove?: () => void;
  loading?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className={`surface-raised flex h-full min-h-0 flex-col rounded-xl ring-1 ring-inset ring-line/70 ${editing ? "dash-frame-edit" : ""}`}>
      <header
        draggable={drag.draggable}
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
        className={`flex items-center gap-2 px-3.5 pb-1 pt-3 ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {editing && <IcMove size={13} className="shrink-0 text-faint" />}
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-sub" title={title}>
          {title}
        </h3>
        {hint && <span className="shrink-0 truncate text-[11px] text-faint">{hint}</span>}
        {editing && onConfigure && (
          <button type="button" onClick={(e) => onConfigure(e.currentTarget)} className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("dash.configure", { name: title })} title={t("dash.configureShort")}>
            <IcSettings size={13} />
          </button>
        )}
        {editing && onRemove && (
          <button type="button" onClick={onRemove} className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-dangersoft hover:text-danger" aria-label={t("dash.remove", { name: title })} title={t("dash.removeShort")}>
            <IcTrash size={13} />
          </button>
        )}
      </header>
      <div className={`relative min-h-0 flex-1 px-3.5 pb-3 pt-1 transition-opacity ${loading ? "opacity-60" : ""}`}>{children}</div>
      {editing && (
        <button
          type="button"
          onPointerDown={drag.onResizeStart}
          className="dash-resize"
          aria-label={t("dash.resizeHandle", { name: title })}
          title={t("dash.resizeHint")}
          tabIndex={-1}
        />
      )}
    </div>
  );
}
