/** Полоса дашбордов организации (ADR-0022): «Отчёты» — встроенный первым, затем общие, затем свои, «+» — новый.
 *  Её показывают и раздел «Дашборды», и «Отчёты» — чтобы между ними был один переход. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { dashboardsApi, type DashboardDto } from "../api";
import { IcLock, IcPlus, IcReport, IcUsers } from "../icons";

export function DashboardTabs({ current, dashboards, onNew }: { current: string; dashboards: DashboardDto[] | null; onNew?: () => void }) {
  const { t } = useT();
  const { setView } = useStore();
  const tab = (id: string, label: string, icon: ReactNode, onClick: () => void) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      aria-current={current === id ? "page" : undefined}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${current === id ? "bg-accentsoft text-accent" : "text-sub hover:bg-hover hover:text-ink"}`}
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
    </button>
  );
  return (
    <nav aria-label={t("dash.title")} className="flex items-center gap-1 overflow-x-auto px-4 pt-4 sm:px-6">
      {tab("reports", t("sidebar.nav.reports"), <IcReport size={14} tone="sky" />, () => setView("reports"))}
      {(dashboards ?? []).map((d) =>
        tab(d.id, d.name, d.kind === "org" ? <IcUsers size={13} className="text-faint" /> : <IcLock size={12} className="text-faint" />, () => setView("dashboards", d.id)),
      )}
      {onNew && (
        <button type="button" onClick={onNew} className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-faint hover:bg-hover hover:text-ink">
          <IcPlus size={13} /> {t("dash.new")}
        </button>
      )}
    </nav>
  );
}

/** Список дашбордов организации — общий для раздела и вкладок в «Отчётах». */
export function useDashboardList(): { list: DashboardDto[] | null; reload: () => void; setList: (f: (l: DashboardDto[]) => DashboardDto[]) => void } {
  const [list, setListState] = useState<DashboardDto[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    dashboardsApi.list().then(
      (l) => alive && setListState(l),
      () => alive && setListState([]),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setList = useCallback((f: (l: DashboardDto[]) => DashboardDto[]) => setListState((l) => f(l ?? [])), []);
  return { list, reload, setList };
}

