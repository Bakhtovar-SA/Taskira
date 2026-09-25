import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import { openTotal } from "../boardFilters";
import type { ViewId } from "../types";
import { IcBacklog, IcBoard, IcBook, IcFlag, IcFlow, IcInbox, IcLink, IcReport, IcShield, IcTimeline, Logo } from "../icons";
import { Avatar, Kbd } from "../ui";
import { useT, type TKey } from "../i18n";

const GROUPS: {
  labelKey: TKey;
  items: {
    id: ViewId;
    labelKey: TKey;
    icon: (p: { size?: number }) => React.ReactNode;
    kbd?: string;
    adminOnly?: boolean;
    /** Показывать только если есть активные приглашения (data.collaborations). */
    collabOnly?: boolean;
    /** Показывать только если у проекта включён модуль спринтов
     *  (project.sprintsEnabled, миграция 023 — опциональный модуль). */
    sprintsOnly?: boolean;
  }[];
}[] = [
  {
    labelKey: "sidebar.group.planning",
    items: [
      { id: "board", labelKey: "sidebar.nav.board", icon: (p) => <IcBoard {...p} />, kbd: "1" },
      { id: "backlog", labelKey: "sidebar.nav.backlog", icon: (p) => <IcBacklog {...p} />, kbd: "2" },
      { id: "sprints", labelKey: "sidebar.nav.sprints", icon: (p) => <IcFlag {...p} />, sprintsOnly: true },
      { id: "timeline", labelKey: "sidebar.nav.timeline", icon: (p) => <IcTimeline {...p} />, kbd: "3" },
      { id: "reports", labelKey: "sidebar.nav.reports", icon: (p) => <IcReport {...p} />, kbd: "4" },
    ],
  },
  {
    labelKey: "sidebar.group.project",
    items: [
      { id: "workflow", labelKey: "sidebar.nav.workflow", icon: (p) => <IcFlow {...p} />, kbd: "5" },
      { id: "access", labelKey: "sidebar.nav.access", icon: (p) => <IcShield {...p} />, kbd: "6" },
      { id: "admin", labelKey: "sidebar.nav.admin", icon: (p) => <IcInbox {...p} />, kbd: "7", adminOnly: true },
      { id: "docs", labelKey: "sidebar.nav.docs", icon: (p) => <IcBook {...p} />, kbd: "8" },
      { id: "collaborating", labelKey: "sidebar.nav.collaborating", icon: (p) => <IcLink {...p} />, kbd: "9", collabOnly: true },
    ],
  },
];

export default function Sidebar() {
  const { t } = useT();
  const { data, ui, setView, me, goHome } = useStore();
  const doneIds = new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id));
  // «Открытых задач» и полоса прогресса — агрегат по всему проекту: одним
  // запросом счётчиков, а не обходом всех задач на клиенте (PERF-06).
  const { counts } = useIssueCounts(data.currentProjectId || null, NO_ISSUE_FILTERS, useIssuesRevision());
  const openCount = openTotal(counts, doneIds);
  const totalCount = counts?.total ?? 0;
  // Лого ведёт на главный экран — как крошка «Проекты» в топбаре; кликабельно
  // только когда главный экран вообще есть (≥ 2 доступных проекта).
  const homeAvailable = data.projects.length >= 2;

  const closedPct = openCount === null ? 0 : Math.round((1 - openCount / Math.max(1, totalCount)) * 100);

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col text-sub md:flex">
      {/* Знак + название инсталляции. Боковая панель прозрачна: под ней —
          атмосфера (свечение бренд-оттенка и зерно, ТЗ 5.14), хром поверх неё
          остаётся нейтральным. */}
      <button
        type="button"
        onClick={homeAvailable ? goHome : undefined}
        aria-label={homeAvailable ? t("sidebar.homeAria") : "Taskira"}
        className={`mx-2 mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${homeAvailable ? "cursor-pointer hover:bg-hover/70" : "cursor-default"}`}
      >
        <Logo size={26} />
        <span className="font-disp text-[16px] font-semibold tracking-[-0.02em] text-ink">Taskira</span>
      </button>

      {/* Текущий проект */}
      <div className="mx-2 mb-2 mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accentsoft font-disp text-[12.5px] font-semibold text-accenttext ring-1 ring-inset ring-accentmuted/60">
          {data.project.key[0]}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-ink">{data.project.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-faint">
            <span className="font-mono">{data.project.key}</span> · {t("sidebar.projectTeamSuffix")}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((g) => (
          <div key={g.labelKey} className="mb-3">
            <p className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-faint">{t(g.labelKey)}</p>
            <nav className="flex flex-col gap-px">
              {g.items
                .filter(
                  (item) =>
                    (!item.adminOnly || me.globalRole === "admin") &&
                    (!item.collabOnly || data.collaborations.length > 0) &&
                    (!item.sprintsOnly || data.project.sprintsEnabled),
                )
                .map((item) => {
                const active = ui.view === item.id;
                const badge = item.id === "collaborating" ? data.collaborations.length : 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-colors duration-150 ${
                      active
                        ? "bg-[var(--sidebar-item-active)] font-medium text-ink shadow-e1"
                        : "text-sub hover:bg-hover/70 hover:text-ink"
                    }`}
                  >
                    <span className={`transition-colors duration-150 ${active ? "text-accenttext" : "text-faint group-hover:text-sub"}`}>{item.icon({ size: 16 })}</span>
                    <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    {badge > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold tabular text-onaccent">{badge}</span>
                    )}
                    {badge === 0 && item.kbd && (
                      <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        <Kbd>{item.kbd}</Kbd>
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* Прогресс проекта: доля закрытых — тонкая полоса, цифра открытых. */}
      <div className="mx-4 mb-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] text-faint">{t("sidebar.openIssues")}</p>
          <span className="tabular text-[13px] font-semibold text-ink">{openCount ?? "…"}</span>
        </div>
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-active"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={closedPct}
          aria-label={t("sidebar.closedShare")}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${closedPct}%` }} />
        </div>
      </div>

      <div className="mx-2 mb-3 flex items-center gap-2.5 rounded-lg border-t border-linesoft/70 px-2.5 pb-1 pt-3">
        <Avatar user={me} size={28} interactive />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium text-ink">{me?.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-faint">{me?.role}</p>
        </div>
      </div>
    </aside>
  );
}
