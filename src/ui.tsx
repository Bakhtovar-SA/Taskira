import { useEffect, useRef, useState } from "react";
import type { Status, User } from "./types";
import { useStore } from "./store";
import { IcX } from "./icons";

export const Avatar = ({ user, size = 26, ring = false }: { user: User | null | undefined; size?: number; ring?: boolean }) => {
  if (!user)
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-[#aeb9cb] bg-[#eef1f6] text-[#8b95a7]"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title="Не назначен"
      >
        –
      </span>
    );
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${ring ? "ring-2 ring-panel" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, background: user.color }}
      title={user.name}
    >
      {user.initials}
    </span>
  );
};

export const catColor = (cat: Status["category"]) =>
  cat === "done" ? { dot: "#22a06b", bg: "#ddf3e7", fg: "#116e46" } : cat === "inprogress" ? { dot: "#e2b203", bg: "#fdf0cf", fg: "#7a5c00" } : { dot: "#6b7a94", bg: "#e3e9f1", fg: "#44546f" };

export const Lozenge = ({ status, size = "md" }: { status: Status; size?: "sm" | "md" }) => {
  const c = catColor(status.category);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-semibold uppercase tracking-wide ${size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"}`}
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
      {status.name}
    </span>
  );
};

export const Chip = ({ text, color, onRemove }: { text: string; color?: string; onRemove?: () => void }) => (
  <span
    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
    style={color ? { background: `${color}1c`, color } : { background: "#e8edf4", color: "#44546f" }}
  >
    {text}
    {onRemove && (
      <button onClick={onRemove} className="rounded hover:bg-black/10" aria-label={`Убрать ${text}`}>
        <IcX size={10} />
      </button>
    )}
  </span>
);

/* Дропдаун: кнопка + панель, закрытие по клику вне и Esc */
export function Dropdown({ button, children, align = "left", width = 240 }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{button(open)}</div>
      {open && (
        <div
          className="anim-pop absolute z-40 mt-1.5 overflow-hidden rounded-lg border border-line bg-panel shadow-[0_10px_34px_rgba(20,35,64,0.16)]"
          style={{ width, [align]: 0 } as React.CSSProperties}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export const MenuItem = ({ onClick, children, danger, disabled, title }: { onClick?: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean; title?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
      disabled ? "cursor-not-allowed text-faint" : danger ? "text-danger hover:bg-dangersoft" : "text-ink hover:bg-accentsoft"
    }`}
  >
    {children}
  </button>
);

export function Modal({ onClose, children, w = 860 }: { onClose: () => void; children: React.ReactNode; w?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0c1626]/55 px-4 py-10 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="anim-pop w-full rounded-xl border border-line bg-panel shadow-[0_24px_70px_rgba(12,22,38,0.4)]" style={{ maxWidth: w }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export const Empty = ({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#c3ccda] px-4 py-7 text-center">
    <span className="text-[#a4b0c2]">{icon}</span>
    <p className="text-[13px] font-semibold text-sub">{title}</p>
    {sub && <p className="max-w-[240px] text-xs text-faint">{sub}</p>}
  </div>
);

export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-[#2c415f] bg-sidebar2 px-1.5 py-px font-mono text-[10px] font-medium text-[#8fa3c2]">{children}</kbd>
);

export function Toasts() {
  const { toasts } = useStore();
  const meta = {
    success: { border: "#22a06b", fg: "#116e46", bg: "#ddf3e7", label: "Готово" },
    error: { border: "#d23a2e", fg: "#a02a21", bg: "#fdeae8", label: "Ошибка" },
    info: { border: "#0b5fd9", fg: "#0a4cb0", bg: "#e8f0fd", label: "Инфо" },
  };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[340px] flex-col gap-2">
      {toasts.map((t) => {
        const m = meta[t.kind];
        return (
          <div key={t.id} className="anim-toast pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-panel py-2.5 pl-3 pr-3 shadow-[0_12px_36px_rgba(15,27,45,0.22)]" style={{ borderLeft: `4px solid ${m.border}` }}>
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: m.bg, color: m.fg }}>
              {t.kind === "error" ? "!" : "✓"}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: m.fg }}>{m.label}</p>
              <p className="text-[13px] leading-snug text-ink">{t.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
