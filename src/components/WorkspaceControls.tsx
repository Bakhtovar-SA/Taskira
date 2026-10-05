import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { IcCheck, IcChevD, IcDisplay, IcFilter, IcSearch, IcX } from "../icons";
import { Button } from "../ds/Button";

export function WorkspaceSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useT();
  return <div className="workspace-search flex min-w-0 items-center gap-2 rounded-md border border-line bg-panel px-3">
    <IcSearch size={14} className="text-faint" />
    <input aria-label={t("board.searchPlaceholder")} value={value} onChange={e => onChange(e.target.value)} placeholder={t("board.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint" />
    {!value && <kbd className="ds-kbd">/</kbd>}
    {value && <button onClick={() => onChange("")} className="text-faint hover:text-ink" aria-label={t("common.clear")}><IcX size={12} /></button>}
  </div>;
}

export function WorkspaceQuickFilters({ active, onToggle, overdue }: { active: (id: "mine" | "overdue" | "unassigned") => boolean; onToggle: (id: "mine" | "overdue" | "unassigned") => void; overdue: number | null | undefined }) {
  const { t } = useT();
  return <div className="board-quick-filters flex flex-wrap items-center gap-2">
    {(["mine", "overdue", "unassigned"] as const).map(id => {
      const on = active(id), label = t(id === "mine" ? "workspace.mine" : id === "overdue" ? "board.quickChip.overdue" : "board.quickChip.unassigned");
      return <Button key={id} size="sm" className="workspace-quick-filter" aria-label={t(id === "mine" ? "board.quickChip.mine" : id === "overdue" ? "board.quickChip.overdue" : "board.quickChip.unassigned")} aria-pressed={on} iconLeft={on ? <IcCheck size={13} /> : undefined} onClick={() => onToggle(id)}>
        {label}{id === "overdue" && <span className="workspace-overdue-count tabular" aria-hidden="true">{overdue ?? "…"}</span>}
      </Button>;
    })}
  </div>;
}

/** Stable toolbar buttons with one shared, inline disclosure panel. */
export function WorkspaceControls({ search, filters, options, summary, quickFilters, grouping, compact = false, count = 0, selectionMode = false }: {
  search: ReactNode; filters: ReactNode; options: ReactNode; summary?: ReactNode; quickFilters?: ReactNode; grouping?: ReactNode; compact?: boolean; count?: number; selectionMode?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<"filters" | "options" | null>(null);
  const id = useId();
  const filtersButton = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selectionMode) { setOpen(null); optionsButton.current?.focus(); }
  }, [selectionMode]);
  const close = () => {
    (open === "filters" ? filtersButton : optionsButton).current?.focus();
    setOpen(null);
  };
  const label = open === "options" ? t("workspace.settings") : t("workspace.filters");
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  return <>
    <div className="workspace-controls mt-3" data-layout={compact ? "compact" : undefined}>
      {search}
      {quickFilters}
      {compact && summary && <span className="workspace-count text-[12px] tabular text-faint">{summary}</span>}
      {grouping}
      <button ref={filtersButton} type="button" className="workspace-toggle ds-focus" aria-expanded={open === "filters"} aria-controls={id}
        aria-label={compact ? t("workspace.filters") : undefined}
        onClick={() => setOpen(open === "filters" ? null : "filters")}>
        <IcFilter size={14} /> {!compact && t("workspace.filters")}
        {count > 0 && <span className="ds-count">{count}</span>}
        {!compact && <IcChevD size={12} />}
      </button>
      <button ref={optionsButton} type="button" className="workspace-toggle ds-focus" aria-expanded={open === "options"} aria-controls={id}
        aria-label={compact ? t("workspace.settings") : undefined}
        onClick={() => setOpen(open === "options" ? null : "options")}>
        {!compact && <IcDisplay size={14} />} {t(compact ? "workspace.view" : "workspace.settings")} <IcChevD size={12} />
      </button>
      {!compact && summary && <span className="workspace-count text-[12px] tabular text-faint">{summary}</span>}
    </div>
    <section id={id} hidden={!open} className="workspace-panel" data-panel={open} aria-label={label}>
      <div className="workspace-panel-head">
        <h2 className="workspace-panel-title">{label}</h2>
        <button type="button" className="workspace-panel-close ds-focus" aria-label={t("common.close")} onClick={close}><IcX size={14} /></button>
      </div>
      {open === "filters" ? filters : open === "options" ? options : null}
    </section>
  </>;
}
