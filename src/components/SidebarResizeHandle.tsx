import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { useT } from "../i18n";

const KEY = "taskira.sidebar.width";
const MIN = 220, MAX = 420;
const clamp = (n: number) => Math.round(Math.max(MIN, Math.min(MAX, n)));
const savedWidth = () => {
  try {
    const raw = localStorage.getItem(KEY), n = Number(raw);
    return raw !== null && Number.isFinite(n) ? clamp(n) : null;
  } catch { return null; }
};

/** Updates only the pane's CSS variable during dragging, including the ultrawide CSS zoom. */
export function SidebarResizeHandle({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useT();
  const handle = useRef<HTMLDivElement>(null);
  const pane = () => handle.current?.parentElement;
  const [value, setValue] = useState(248);
  const drag = useRef<{ x: number; width: number; scale: number; saved: number | null; collapse: boolean } | null>(null);
  const frame = useRef(0), pending = useRef(248);
  const apply = (width: number) => {
    pending.current = clamp(width);
    pane()?.style.setProperty("--sidebar-width", pending.current + "px");
    handle.current?.setAttribute("aria-valuenow", String(pending.current));
  };
  const persist = (width: number | null) => {
    try { if (width === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(width)); } catch { /* private mode */ }
  };
  const clearDrag = () => {
    cancelAnimationFrame(frame.current); frame.current = 0; drag.current = null;
    pane()?.removeAttribute("data-resizing"); document.body.classList.remove("sidebar-resizing");
  };
  const reset = () => {
    clearDrag(); pane()?.style.removeProperty("--sidebar-width"); persist(null);
    setValue(pending.current = parseFloat(getComputedStyle(pane()!).getPropertyValue("--sidebar-default-width")) || 248);
  };
  useLayoutEffect(() => {
    const el = pane(); if (!el) return;
    const saved = savedWidth(); if (saved !== null) apply(saved);
    setValue(pending.current = Math.round(parseFloat(getComputedStyle(el).width)));
    const observer = new ResizeObserver(() => {
      if (!drag.current) setValue(pending.current = Math.round(parseFloat(getComputedStyle(el).width)));
    });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); document.body.classList.remove("sidebar-resizing"); };
  }, []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const el = pane(); if (!el) return;
    event.preventDefault();
    event.currentTarget.setAttribute("data-pointer", ""); event.currentTarget.removeAttribute("data-released"); event.currentTarget.focus();
    const width = parseFloat(getComputedStyle(el).width);
    drag.current = { x: event.clientX, width, scale: el.getBoundingClientRect().width / width, saved: savedWidth(), collapse: false };
    pending.current = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    el.setAttribute("data-resizing", ""); document.body.classList.add("sidebar-resizing");
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const raw = drag.current.width + (event.clientX - drag.current.x) / drag.current.scale;
    drag.current.collapse = raw <= MIN - 32; pending.current = clamp(raw);
    if (!frame.current) frame.current = requestAnimationFrame(() => { apply(pending.current); frame.current = 0; });
  };
  const finish = () => {
    if (!drag.current) return;
    const collapse = drag.current.collapse;
    apply(pending.current); clearDrag();
    handle.current?.setAttribute("data-released", ""); handle.current?.blur();
    if (collapse) onCollapse(); else { setValue(pending.current); persist(pending.current); }
  };
  const cancel = () => {
    const before = drag.current; if (!before) return;
    clearDrag();
    if (before.saved === null) pane()?.style.removeProperty("--sidebar-width"); else apply(before.saved);
    setValue(pending.current = Math.round(before.width));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    handle.current?.removeAttribute("data-pointer"); handle.current?.removeAttribute("data-released");
    if (event.key === "Escape") { cancel(); return; }
    if (event.key === "Enter") { event.preventDefault(); reset(); return; }
    const step = event.shiftKey ? 24 : 8;
    const next = event.key === "ArrowLeft" ? value - step : event.key === "ArrowRight" ? value + step : event.key === "Home" ? MIN : event.key === "End" ? MAX : null;
    if (next === null) return;
    event.preventDefault(); apply(next); setValue(pending.current); persist(pending.current);
  };
  return <div ref={handle} className="sidebar-resize-handle" role="separator" tabIndex={0}
    aria-orientation="vertical" aria-controls="taskira-sidebar" aria-label={t("sidebar.resize")}
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={value} title={t("sidebar.resizeHint")}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
    onPointerLeave={() => handle.current?.removeAttribute("data-released")} onLostPointerCapture={finish} onDoubleClick={reset} onKeyDown={key} />;
}
