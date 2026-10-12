import { type ReactNode } from "react";
import { useT } from "../i18n";
import { IcCheck, IcChevD, IcFilter, IcSearch, IcX } from "../icons";
import { Button } from "../ds/Button";
import { Menu, Popover } from "../ds/Overlay";

export function WorkspaceSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useT();
  return <div className="workspace-search flex min-w-0 items-center gap-2 rounded-md border border-line bg-panel px-3">
    <IcSearch size={16} className="text-faint" />
    <input aria-label={t("board.searchPlaceholder")} value={value} onChange={e => onChange(e.target.value)} placeholder={t("board.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
    {!value && <kbd className="ds-kbd">/</kbd>}
    {value && <button onClick={() => onChange("")} className="text-faint hover:text-ink" aria-label={t("common.clear")}><IcX size={14} /></button>}
  </div>;
}

export function WorkspaceQuickFilters({ active, onToggle, overdue }: { active: (id: "mine" | "overdue" | "unassigned") => boolean; onToggle: (id: "mine" | "overdue" | "unassigned") => void; overdue: number | null | undefined }) {
  const { t } = useT();
  return <div className="board-quick-filters flex flex-wrap items-center gap-2">
    {(["mine", "overdue", "unassigned"] as const).map(id => {
      const on = active(id), label = t(id === "mine" ? "workspace.mine" : id === "overdue" ? "board.quickChip.overdue" : "board.quickChip.unassigned");
      return <Button key={id} variant="ghost" size="sm" className="workspace-quick-filter" aria-label={t(id === "mine" ? "board.quickChip.mine" : id === "overdue" ? "board.quickChip.overdue" : "board.quickChip.unassigned")} aria-pressed={on} iconLeft={on ? <IcCheck size={15} /> : undefined} onClick={() => onToggle(id)}>
        {label}{id === "overdue" && <span className="workspace-overdue-count tabular" aria-hidden="true">{overdue ?? "…"}</span>}
      </Button>;
    })}
  </div>;
}


/** Anchored panels keep task rows and toolbar positions stable. */
export function WorkspaceControls({ search, filters, options, actions, summary, quickFilters, members, grouping, compact = false, count = 0 }: {
  search: ReactNode; filters?: ReactNode; options?: ReactNode; actions?: ReactNode; summary?: ReactNode; quickFilters?: ReactNode; members?: ReactNode; grouping?: ReactNode; compact?: boolean; count?: number; selectionMode?: boolean;
}) {
  const { t } = useT();
  const panel = (kind: "filters" | "options", content: ReactNode) => <Popover placement="bottom-end" label={t(kind === "filters" ? "workspace.filters" : "workspace.settings")} className="workspace-pop"
    trigger={p => <button {...p} type="button" className="workspace-toggle ds-focus" aria-label={t(kind === "filters" ? "workspace.filters" : "workspace.settings")}>
      {kind === "filters" ? <><IcFilter size={16} />{!compact && t("workspace.filters")}{count > 0 && <span className="ds-count">{count}</span>}</> : <>{t("workspace.view")}<IcChevD size={14} /></>}
    </button>}>
    {close => <section className="workspace-panel" data-panel={kind} aria-label={t(kind === "filters" ? "workspace.filters" : "workspace.settings")}>
      <div className="workspace-panel-head"><h2 className="workspace-panel-title">{t(kind === "filters" ? "workspace.filters" : "workspace.settings")}</h2><button type="button" className="workspace-panel-close ds-focus" aria-label={t("common.close")} onClick={close}><IcX size={16} /></button></div>
      {content}
    </section>}
  </Popover>;
  return <div className="workspace-controls mt-3" data-layout={compact ? "compact" : undefined}>
    {search}{quickFilters}{members}
    <div className="workspace-controls-end">
      <div className="workspace-meta">{compact && summary && <span className="workspace-count text-[13px] tabular text-faint">{summary}</span>}
      {grouping}</div>{filters != null && panel("filters", filters)}{options != null && panel("options", options)}{actions}
      {!compact && summary && <span className="workspace-count text-[13px] tabular text-faint">{summary}</span>}
    </div>
  </div>;
}

export function WorkspaceFilterRow({ label, icon, children }: {label: string; icon: ReactNode; children: ReactNode}) {
  return <div className="workspace-filter-row"><span className="workspace-filter-label">{icon}<span>{label}</span></span><div className="workspace-filter-control">{children}</div></div>;
}

/** Single-value filter menu, using the DS keyboard navigation and native light dismissal. */
export function WorkspaceSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
}) {
  const current = options.find(option => option.value === value);
  return <Menu label={label} placement="bottom-end" className="workspace-select-menu"
    trigger={p => <Button {...p} type="button" variant="ghost" size="sm" aria-label={label} className="workspace-select" iconRight={<IcChevD size={14} />}>{current?.label}</Button>}
    items={options.map(option => ({ id: option.value || "all", label: option.label,
      icon: option.icon ? <span aria-hidden="true">{option.icon}</span> : undefined,
      hint: option.value === value ? <IcCheck size={14} className="text-accenttext" /> : undefined,
      onSelect: () => onChange(option.value),
    }))} />;
}
