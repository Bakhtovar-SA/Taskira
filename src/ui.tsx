import { useEffect, useId, useRef, useState } from "react";
import type { AccessRole, Status, User } from "./types";
import { useStore } from "./store";
import { IcX } from "./icons";
import { BG_PRESETS, effectiveTheme, readBgId, readTheme, setBg, setThemeMode, type ThemeMode } from "./theme";

/** Аватару достаточно имени/инициалов/цвета — принимаем любой такой объект
 *  (не только полный User: напр. `actor` в уведомлениях). */
type AvatarUser = Pick<User, "name" | "initials" | "color">;
export const Avatar = ({ user, size = 26, ring = false }: { user: AvatarUser | null | undefined; size?: number; ring?: boolean }) => {
  if (!user)
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-line2 bg-linesoft text-faint"
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
  cat === "done"
    ? { dot: "var(--c-ok)", bg: "var(--c-oksoft)", fg: "var(--c-ok-fg)" }
    : cat === "inprogress"
      ? { dot: "var(--c-warndot)", bg: "var(--c-warnsoft)", fg: "var(--c-warn-fg)" }
      : { dot: "var(--c-todo)", bg: "var(--c-todosoft)", fg: "var(--c-todo-fg)" };

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
    style={color ? { background: `${color}1c`, color } : { background: "var(--c-linesoft)", color: "var(--c-sub)" }}
  >
    {text}
    {onRemove && (
      <button onClick={onRemove} className="rounded hover:bg-black/10" aria-label={`Убрать ${text}`}>
        <IcX size={10} />
      </button>
    )}
  </span>
);

/** Событие «открылся какой-то дропдаун» — чтобы одновременно был открыт только
 *  один (ticket-scaling §2): каждый инстанс шлёт его при открытии со своим id,
 *  услышав чужой id — закрывается. */
const DROPDOWN_OPEN_EVT = "taskira:dropdown-open";

export function Dropdown({ button, children, align = "left", width = 240 }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const myId = useId();

  // Открытие другого дропдауна закрывает этот.
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== myId) setOpen(false);
    };
    window.addEventListener(DROPDOWN_OPEN_EVT, onOther);
    return () => window.removeEventListener(DROPDOWN_OPEN_EVT, onOther);
  }, [myId]);

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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVT, { detail: myId }));
  };

  return (
    <div className="relative" ref={ref}>
      <div onClick={toggle}>{button(open)}</div>
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

export const Empty = ({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line2 px-4 py-7 text-center">
    <span className="text-faint">{icon}</span>
    <p className="text-[13px] font-semibold text-sub">{title}</p>
    {sub && <p className="max-w-[240px] text-xs text-faint">{sub}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

/* ─── Скелет-заглушки на время bootstrap (round4 §1) ───────────────────── */

export const SkeletonRow = () => (
  <div className="flex items-center gap-3 border-b border-linesoft px-3.5 py-3 last:border-0">
    <div className="skeleton h-3.5 w-3.5 shrink-0 rounded" />
    <div className="skeleton h-3 w-14 shrink-0" />
    <div className="skeleton h-3 min-w-0 flex-1" style={{ maxWidth: 320 }} />
    <div className="skeleton hidden h-4 w-16 shrink-0 sm:block" />
    <div className="skeleton h-4 w-4 shrink-0 rounded-full" />
  </div>
);

export const SkeletonCard = () => (
  <div className="rounded-lg border border-line bg-panel p-2.5">
    <div className="mb-2 flex items-center gap-1.5">
      <div className="skeleton h-3.5 w-3.5 rounded" />
      <div className="skeleton h-2.5 w-12" />
    </div>
    <div className="skeleton h-3 w-full" />
    <div className="skeleton mt-1.5 h-3 w-2/3" />
    <div className="mt-3 flex items-center gap-2">
      <div className="skeleton h-3 w-16" />
      <div className="skeleton ml-auto h-5 w-5 rounded-full" />
    </div>
  </div>
);

export const SkeletonColumn = ({ cards = 3 }: { cards?: number }) => (
  <div className="flex w-[286px] shrink-0 flex-col gap-2">
    <div className="mb-1 flex items-center gap-2 px-1">
      <div className="skeleton h-2 w-2 rounded-sm" />
      <div className="skeleton h-3 w-24" />
    </div>
    {Array.from({ length: cards }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-[#2c415f] bg-sidebar2 px-1.5 py-px font-mono text-[10px] font-medium text-[#8fa3c2]">{children}</kbd>
);

export const Tip = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
  <span className={`group/tip relative inline-flex ${className}`}>
    {children}
    <span className="pointer-events-none absolute bottom-full left-1/2 z-[60] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-sidebar px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(12,22,38,0.35)] transition-opacity duration-150 group-hover/tip:opacity-100">
      {label}
    </span>
  </span>
);

export const roleBadgeColors: Record<AccessRole, string> = {
  admin: "var(--c-danger)",
  manager: "var(--c-accent)",
  employee: "var(--c-ok)",
  viewer: "var(--c-faint)",
};

export const RoleBadge = ({ role, size = "md" }: { role: AccessRole; size?: "sm" | "md" }) => {
  const meta = {
    admin: { name: "Администратор", color: "var(--c-danger)", bg: "var(--c-dangersoft)" },
    manager: { name: "Менеджер", color: "var(--c-accent)", bg: "var(--c-accentsoft)" },
    employee: { name: "Сотрудник", color: "var(--c-ok)", bg: "var(--c-oksoft)" },
    viewer: { name: "Наблюдатель", color: "var(--c-sub)", bg: "var(--c-linesoft)" },
  }[role];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-semibold ${size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: meta.bg, color: meta.color }}
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5l5.5 2v4.2c0 3.7-2.3 6-5.5 7-3.2-1-5.5-3.3-5.5-7V3.5L8 1.5z" />
      </svg>
      {meta.name}
    </span>
  );
};

export const LockedField = ({ children, reason }: { children: React.ReactNode; reason: string }) => (
  <Tip label={reason} className="w-full">
    <div className="flex w-full cursor-not-allowed items-center gap-2 rounded-md border border-linesoft bg-canvas/70 px-2.5 py-1.5 text-[13px] text-faint opacity-80">
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5.3a2.5 2.5 0 015 0V7" />
      </svg>
    </div>
  </Tip>
);

/** Попап «Оформление» — тема (3 варианта) + пресеты фона рабочей области.
 *  Живёт в меню профиля (Topbar) и в шапке HomeView. Хранение — localStorage
 *  (theme.ts), без сервера. */
export function AppearanceSettings() {
  const [mode, setMode] = useState<ThemeMode>(() => readTheme());
  const [bg, setBgState] = useState<string>(() => readBgId());
  const eff = effectiveTheme(mode);
  return (
    <div className="border-b border-linesoft px-3.5 py-3">
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Оформление</p>
      <div className="flex gap-1">
        {(
          [
            ["system", "Системная"],
            ["light", "Светлая"],
            ["dark", "Тёмная"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => {
              setThemeMode(v);
              setMode(v);
            }}
            className={`flex-1 rounded border px-1.5 py-1 text-[11px] font-semibold transition-colors ${
              mode === v ? "border-accent bg-accentsoft text-accent" : "border-line text-sub hover:border-line2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            title={p.name}
            aria-label={`Фон: ${p.name}`}
            onClick={() => {
              setBg(p.id);
              setBgState(p.id);
            }}
            className={`h-6 w-6 rounded-md border-2 transition-transform hover:scale-110 ${
              bg === p.id ? "border-accent" : "border-line"
            }`}
            style={{ background: eff === "dark" ? p.dark : p.light }}
          />
        ))}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  const meta = {
    success: { border: "var(--c-ok)", fg: "var(--c-ok-fg)", bg: "var(--c-oksoft)", label: "Готово" },
    error: { border: "var(--c-danger)", fg: "var(--c-danger)", bg: "var(--c-dangersoft)", label: "Ошибка" },
    info: { border: "var(--c-accent)", fg: "var(--c-accentdeep)", bg: "var(--c-accentsoft)", label: "Инфо" },
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
