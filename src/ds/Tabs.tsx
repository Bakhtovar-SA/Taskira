/** Tabs with linked panels, pressed filter buttons, or navigable links; arrow keys skip disabled items. */
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { cssZoom, glideTo } from "../motion";

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; count?: number; disabled?: boolean; href?: string; panelId?: string; tabId?: string };

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  variant = "segmented",
  force,
  mode = "filter",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: "segmented" | "line";
  force?: { id: T; state: "hover" | "focus" };
  mode?: "tabs" | "filter" | "navigation";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const selected = items.findIndex(it => it.id === value && !it.disabled);
  const itemIds = items.map(it => it.id).join("\0");
  const firstEnabled = items.findIndex(it => !it.disabled);
  // Индикатор выбранной вкладки — один элемент, который пружиной переезжает между вкладками (ADR-0035, прототип).
  // Место — по getBoundingClientRect выбранной вкладки, запись — CSSOM/WAAPI в glideTo; ни одного состояния React.
  const glider = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);
  useLayoutEffect(() => {
    const box = ref.current;
    const ind = glider.current;
    if (!box || !ind) return;
    const tab = selected < 0 ? null : box.querySelectorAll<HTMLElement>("[data-tab]")[selected];
    // Navigation may be wider than its own scroll viewport (project views, dashboards).
    // Find only a local horizontal scroller; scrollIntoView would also move the page.
    let viewport: HTMLElement | null = null;
    if (mode === "navigation") {
      for (let parent: HTMLElement | null = box; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
        if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowX)) { viewport = parent; break; }
      }
    }
    let placed: { x: number; y: number; w: number; h: number } | null = null;
    const place = (animate: boolean) => {
      const r = tab?.getBoundingClientRect();
      if (!tab || !r || !r.width) {
        box.removeAttribute("data-glide");
        shown.current = false;
        return;
      }
      const b = box.getBoundingClientRect();
      const z = cssZoom(box);
      const x = (r.left - b.left) / z - box.clientLeft + box.scrollLeft;
      const y = (r.top - b.top) / z - box.clientTop + box.scrollTop;
      const w = r.width / z;
      const h = r.height / z;
      const target = variant === "line" ? { x, y: y + h - 2, w, h: 2 } : { x, y, w, h };
      // The first observer delivery may already include a loaded font or a new
      // density profile. Reconcile that geometry, without cancelling a running
      // navigation glide when its target has not changed.
      if (!placed || Object.keys(target).some(key => Math.abs(target[key as keyof typeof target] - placed![key as keyof typeof target]) > 0.1)) {
        glideTo(ind, target, { animate: animate && shown.current });
        placed = target;
      }
      box.setAttribute("data-glide", "");
      shown.current = true;
      if (viewport && viewport.clientWidth > 0) {
        const zoom = cssZoom(viewport);
        const left = viewport.getBoundingClientRect().left + viewport.clientLeft * zoom;
        const width = viewport.clientWidth * zoom;
        const delta = r.left < left || r.width > width ? r.left - left : r.right > left + width ? r.right - left - width : 0;
        if (Math.abs(delta) > 0.5) viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + delta / zoom));
      }
    };
    place(true);
    if (typeof ResizeObserver !== "function") return;
    // Ширина вкладок меняется (счётчик, язык, шрифт догрузился, окно): переставляем без движения.
    const ro = new ResizeObserver(() => place(false));
    ro.observe(box);
    if (tab) ro.observe(tab);
    // The max-content tab strip can retain its width while the local viewport narrows.
    if (viewport && viewport !== box) ro.observe(viewport);
    return () => ro.disconnect();
  }, [selected, variant, itemIds, mode]);
  const move = (from: number, dir: 1 | -1 | "home" | "end") => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    let k = enabled.indexOf(from);
    k = dir === "home" ? 0 : dir === "end" ? enabled.length - 1 : (k + dir + enabled.length) % enabled.length;
    const next = items[enabled[k]];
    if (mode !== "navigation") onChange(next.id);
    ref.current?.querySelectorAll<HTMLElement>("[data-tab]")[enabled[k]]?.focus();
  };
  return (
    <div ref={ref} role={mode === "tabs" ? "tablist" : "group"} aria-label={label} data-variant={variant} className="ds-tabs">
      <span ref={glider} className="ds-tab-glider" aria-hidden="true" />
      {items.map((it, i) => {
        const on = it.id === value;
        const Element = mode === "navigation" ? "a" : "button";
        return (
          <Element
            key={it.id}
            type={mode === "navigation" ? undefined : "button"}
            href={mode === "navigation" ? it.href : undefined}
            id={mode === "tabs" ? it.tabId ?? `${prefix}-${it.id}` : undefined}
            role={mode === "tabs" ? "tab" : undefined}
            data-tab
            aria-controls={mode === "tabs" ? it.panelId : undefined}
            aria-selected={mode === "tabs" ? on : undefined}
            aria-pressed={mode === "filter" ? on : undefined}
            aria-current={mode === "navigation" && on ? "page" : undefined}
            aria-disabled={it.disabled || undefined}
            tabIndex={it.disabled ? -1 : mode !== "tabs" || i === (selected < 0 ? firstEnabled : selected) ? 0 : -1}
            data-force={force?.id === it.id ? force.state : undefined}
            className="ds-tab ds-focus"
            onClick={(e) => {
              if (it.disabled) { e.preventDefault(); return; }
              if (mode === "navigation") {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
              }
              onChange(it.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(i, 1);
              else if (e.key === "ArrowLeft") move(i, -1);
              else if (e.key === "Home") move(i, "home");
              else if (e.key === "End") move(i, "end");
              else return;
              e.preventDefault();
            }}
          >
            {it.icon && <span className="flex">{it.icon}</span>}
            {it.label}
            {it.count !== undefined && <span className="ds-count">{it.count}</span>}
          </Element>
        );
      })}
    </div>
  );
}
