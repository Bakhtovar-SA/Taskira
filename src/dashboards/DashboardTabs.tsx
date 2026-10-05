/** Общая шапка организации (ADR-0033): обзор, отчёт за период и пользовательские дашборды. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { dashboardsApi, type DashboardDto } from "../api";
import { IcLock, IcPanel, IcPlus, IcUsers } from "../icons";
import { Button, IconButton } from "../ds/Button";
import { Tabs } from "../ds/Tabs";
import { openSidebarDrawer } from "../components/Sidebar";
import "../styles/reports.css";
import { ORG_OVERVIEW_ID } from "./catalog";

export function DashboardTabs({ current, dashboards, onNew, actions }: { current: string; dashboards: DashboardDto[] | null; onNew?: () => void; actions?: ReactNode }) {
  const { t } = useT();
  const { setView } = useStore();
  return (
    <header className="reports-header">
      <IconButton size="sm" className="lg:hidden" label={t("sidebar.menu")} onClick={openSidebarDrawer}><IcPanel size={18} /></IconButton>
      <h1>{t("sidebar.nav.dashboards")}</h1>
      <nav aria-label={t("sidebar.nav.dashboards")}>
        <Tabs mode="navigation" variant="line" label={t("dash.title")} value={current}
          onChange={id => id === "reports" ? setView("reports") : setView("dashboards", id)}
          items={[
            { id: ORG_OVERVIEW_ID, label: t("dash.orgOverview"), href: "/dashboards/overview" },
            { id: "reports", label: t("reports.tasksPeriod"), href: "/reports" },
            ...(dashboards ?? []).map(d => ({ id: d.id, label: d.name, href: `/dashboards/${encodeURIComponent(d.id)}`, icon: d.kind === "org" ? <IcUsers size={13} /> : <IcLock size={12} /> })),
          ]} />
        <Button size="sm" variant="ghost" iconLeft={<IcPlus size={13} />} onClick={onNew ?? (() => setView("dashboards", "new"))}>{t("dash.new")}</Button>
      </nav>
      {actions && <div className="reports-header-actions">{actions}</div>}
    </header>
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

