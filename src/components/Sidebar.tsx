import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import { openTotal } from "../boardFilters";
import type { ViewId } from "../types";
import { IcBacklog, IcBoard, IcBook, IcFlag, IcFlow, IcInbox, IcLink, IcReport, IcShield, IcTimeline, Logo } from "../icons";
import { Avatar, Kbd, RoleBadge } from "../ui";
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

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col bg-sidebar text-[#c6d2e4] md:flex">
      <button
        type="button"
        onClick={homeAvailable ? goHome : undefined}
        aria-label={homeAvailable ? t("sidebar.homeAria") : "Taskira"}
        className={`flex items-center gap-3 px-4 pb-6 pt-6 text-left ${homeAvailable ? "cursor-pointer" : "cursor-default"}`}
      >
        <Logo size={36} />
        <div className="leading-none">
          <p className={`font-disp text-[20px] font-bold tracking-tight text-white ${homeAvailable ? "transition-opacity hover:opacity-80" : ""}`}>Taskira</p>
          <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#5f7396]">{t("sidebar.tagline")}</p>
        </div>
      </button>

      <div className="mx-3 mb-4 flex items-center gap-2.5 rounded-lg border border-[#24385a] bg-sidebar2/70 p-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent font-disp text-[13px] font-bold text-white">{data.project.key[0]}</span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-white">{data.project.name}</p>
          <p className="font-mono text-[10px] text-[#7b8fb2]">{data.project.key} · {t("sidebar.projectTeamSuffix")}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {GROUPS.map((g) => (
          <div key={g.labelKey} className="mb-4">
            <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#5f7396]">{t(g.labelKey)}</p>
            <nav className="flex flex-col gap-0.5 px-3">
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
                    className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-150 ${
                      active ? "bg-white/[0.09] text-white" : "text-[#9db0cd] hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />}
                    <span className={active ? "text-[#7ab3ff]" : "text-[#647ba1] group-hover:text-[#9db0cd]"}>{item.icon({ size: 16 })}</span>
                    <span className="flex-1">{t(item.labelKey)}</span>
                    {badge > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-white">{badge}</span>
                    )}
                    {badge === 0 && item.kbd && (
                      <span className="opacity-0 transition-opacity group-hover:opacity-100">
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

      <div className="mx-3 rounded-lg border border-[#24385a] bg-sidebar2/50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[#9db0cd]">{t("sidebar.openIssues")}</p>
          <span className="font-mono text-[15px] font-bold text-white">{openCount ?? "…"}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#24385a]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-[#22a06b] transition-all duration-700"
            style={{ width: `${openCount === null ? 0 : Math.round((1 - openCount / Math.max(1, totalCount)) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-[#5f7396]">{t("sidebar.closedShare")}</p>
      </div>

      <div className="px-3 pb-4 pt-3">
        <div className="rounded-lg border border-[#24385a] bg-sidebar2/70 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar user={me} size={30} interactive />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12.5px] font-semibold text-white">{me?.name}</p>
              <p className="text-[10.5px] text-[#7b8fb2]">{me?.role}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[#24385a] pt-2">
            <RoleBadge role={me.accessRole} size="sm" />
            <span className="text-[9.5px] text-[#5f7396]">
              <Kbd>/</Kbd> <Kbd>C</Kbd> <Kbd>1–9</Kbd>
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
