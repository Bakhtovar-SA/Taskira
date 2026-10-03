import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { IcChevD, IcDisplay, IcFilter, IcX } from "../icons";

/** Stable toolbar buttons with one shared, inline disclosure panel. */
export function WorkspaceControls({ search, filters, options, count = 0, selectionMode = false }: {
  search: ReactNode; filters: ReactNode; options: ReactNode; count?: number; selectionMode?: boolean;
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
    <div className="workspace-controls mt-3">
      {search}
      <button ref={filtersButton} type="button" className="workspace-toggle ds-focus" aria-expanded={open === "filters"} aria-controls={id}
        onClick={() => setOpen(open === "filters" ? null : "filters")}>
        <IcFilter size={14} /> {t("workspace.filters")}
        {count > 0 && <span className="ds-count">{count}</span>}
        <IcChevD size={12} />
      </button>
      <button ref={optionsButton} type="button" className="workspace-toggle ds-focus" aria-expanded={open === "options"} aria-controls={id}
        onClick={() => setOpen(open === "options" ? null : "options")}>
        <IcDisplay size={14} /> {t("workspace.settings")} <IcChevD size={12} />
      </button>
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
