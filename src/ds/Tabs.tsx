/** Вкладки по APG tabs: роving tabindex, стрелки ←/→, Home/End, активация сразу по стрелке. */
import { useRef, type ReactNode } from "react";

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; count?: number; disabled?: boolean };

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  variant = "segmented",
  force,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: "segmented" | "line";
  force?: { id: T; state: "hover" | "focus" };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (from: number, dir: 1 | -1 | "home" | "end") => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    let k = enabled.indexOf(from);
    k = dir === "home" ? 0 : dir === "end" ? enabled.length - 1 : (k + dir + enabled.length) % enabled.length;
    const next = items[enabled[k]];
    onChange(next.id);
    ref.current?.querySelectorAll<HTMLElement>("[role=tab]")[enabled[k]]?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} data-variant={variant} className="ds-tabs">
      {items.map((it, i) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-disabled={it.disabled || undefined}
            // Ни одна не выбрана (например, свой период в Отчётах) — в вкладки всё равно можно попасть Tab'ом.
            tabIndex={on || (i === 0 && !items.some((x) => x.id === value)) ? 0 : -1}
            data-force={force?.id === it.id ? force.state : undefined}
            className="ds-tab ds-focus"
            onClick={() => !it.disabled && onChange(it.id)}
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
          </button>
        );
      })}
    </div>
  );
}
