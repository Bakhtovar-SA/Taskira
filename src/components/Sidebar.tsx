import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import { openTotal } from "../boardFilters";
import type { ViewId } from "../types";
import { IcBacklog, IcBoard, IcBook, IcChevD, IcFlag, IcFlow, IcHome, IcLink, IcReport, IcShield, IcTimeline, IcUsers, Logo, type IconTone } from "../icons";
import { Avatar, Kbd, ProjectMark } from "../ui";
import { useState } from "react";
import { useT, type TKey } from "../i18n";

const GROUPS: {
  labelKey: TKey;
  items: {
    id: ViewId;
    labelKey: TKey;
    icon: (p: { size?: number; tone?: IconTone }) => React.ReactNode;
    /** Фирменный тон раздела — цветная иконка навигации (ADR-0016). */
    tone: IconTone;
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
      { id: "board", labelKey: "sidebar.nav.board", icon: (p) => <IcBoard {...p} />, tone: "violet", kbd: "1" },
      { id: "backlog", labelKey: "sidebar.nav.backlog", icon: (p) => <IcBacklog {...p} />, tone: "indigo", kbd: "2" },
      { id: "sprints", labelKey: "sidebar.nav.sprints", icon: (p) => <IcFlag {...p} />, tone: "amber", sprintsOnly: true },
      { id: "timeline", labelKey: "sidebar.nav.timeline", icon: (p) => <IcTimeline {...p} />, tone: "teal", kbd: "3" },
      { id: "reports", labelKey: "sidebar.nav.reports", icon: (p) => <IcReport {...p} />, tone: "sky", kbd: "4" },
    ],
  },
  {
    labelKey: "sidebar.group.project",
    items: [
      { id: "workflow", labelKey: "sidebar.nav.workflow", icon: (p) => <IcFlow {...p} />, tone: "pink", kbd: "5" },
      { id: "access", labelKey: "sidebar.nav.access", icon: (p) => <IcShield {...p} />, tone: "green", kbd: "6" },
      { id: "admin", labelKey: "sidebar.nav.admin", icon: (p) => <IcUsers {...p} />, tone: "blue", kbd: "7", adminOnly: true },
      { id: "docs", labelKey: "sidebar.nav.docs", icon: (p) => <IcBook {...p} />, tone: "orange", kbd: "8" },
      { id: "collaborating", labelKey: "sidebar.nav.collaborating", icon: (p) => <IcLink {...p} />, tone: "violet", kbd: "9", collabOnly: true },
    ],
  },
];

export default function Sidebar() {
  const { t } = useT();
  const { data, ui, setView, me, goHome, switchProject } = useStore();
  const [projectsOpen, setProjectsOpen] = useState(true);
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

  // Проекты по отделам (ТЗ 5.6: «Проекты, сгруппированные по отделам») — тот
  // же список, что в переключателе проекта в шапке, без нового запроса.
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? "—";
  const byDept = new Map<string, typeof data.projects>();
  for (const p of data.projects) {
    const list = byDept.get(p.departmentId) ?? [];
    list.push(p);
    byDept.set(p.departmentId, list);
  }
  const deptGroups = [...byDept.entries()].map(([id, ps]) => [deptName(id), ps.sort((a, b) => a.key.localeCompare(b.key))] as const);

  const navItem = "group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium transition-colors duration-150";
  const navOn =
    "bg-[linear-gradient(180deg,color-mix(in_oklch,var(--bg-panel)_92%,transparent),color-mix(in_oklch,var(--bg-panel)_70%,transparent))] font-semibold text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.08),0_0_0_1px_var(--border-subtle),var(--highlight-top)] before:absolute before:-left-2 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-accent before:shadow-[0_0_10px_var(--accent-glow)]";
  const navOff = "text-ink/90 hover:bg-hover/70 hover:text-ink";

  return (
    <aside className="glass-side glass-edge my-2 ml-2 hidden w-[248px] shrink-0 flex-col overflow-hidden rounded-xl text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.06),0_12px_40px_-16px_oklch(0.2_0.08_288/0.3)] md:flex">
      {/* Знак + название инсталляции. Стеклянная панель над атмосферой
          (ADR-0016): свечение бренда просвечивает, хром остаётся нейтральным. */}
      <button
        type="button"
        onClick={homeAvailable ? goHome : undefined}
        aria-label={homeAvailable ? t("sidebar.homeAria") : "Taskira"}
        className={`mx-2 mt-2.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${homeAvailable ? "cursor-pointer hover:bg-hover/70" : "cursor-default"}`}
      >
        <Logo size={22} />
        <span className="font-disp text-[16px] font-bold tracking-[-0.03em] text-ink">Taskira</span>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none]">
        {homeAvailable && (
          <button type="button" onClick={goHome} className={`${navItem} ${navOff} mt-1`}>
            <IcHome size={16} tone="violet" />
            <span className="flex-1 truncate">{t("sidebar.nav.home")}</span>
          </button>
        )}

        {/* Текущий проект и его разделы */}
        <div className="mt-2 flex items-center gap-2.5 px-2.5 pb-1 pt-2">
          <ProjectMark projectKey={data.project.key} size={20} />
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-sub">{data.project.name}</p>
        </div>
        {GROUPS.map((g) => (
          <div key={g.labelKey} className="mb-2">
            <p className="px-2.5 pb-1 pt-2 text-[11.5px] font-semibold tracking-[0.01em] text-faint">{t(g.labelKey)}</p>
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
                    className={`${navItem} ${active ? navOn : navOff}`}
                  >
                    <span className={`transition-opacity duration-150 ${active ? "" : "opacity-85 group-hover:opacity-100"}`}>{item.icon({ size: 16, tone: item.tone })}</span>
                    <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    {badge > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">{badge}</span>
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

        {data.projects.length > 1 && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setProjectsOpen((v) => !v)}
              aria-expanded={projectsOpen}
              className="flex w-full items-center gap-1 px-2.5 pb-1 pt-2 text-[11.5px] font-semibold tracking-[0.01em] text-faint hover:text-sub"
            >
              <span className={`transition-transform duration-200 ${projectsOpen ? "" : "-rotate-90"}`}>
                <IcChevD size={12} />
              </span>
              {t("home.projects")}
            </button>
            {projectsOpen &&
              deptGroups.map(([dept, ps]) => (
                <div key={dept} className="mb-1">
                  {deptGroups.length > 1 && <p className="truncate px-2.5 pb-0.5 pt-1.5 text-[11px] text-faint">{dept}</p>}
                  {ps.map((p) => {
                    const cur = p.id === data.currentProjectId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => !cur && switchProject(p.id)}
                        aria-current={cur ? "true" : undefined}
                        className={`${navItem} ${cur ? "text-ink" : navOff}`}
                      >
                        <ProjectMark projectKey={p.key} size={18} />
                        <span className="flex-1 truncate">{p.name}</span>
                        {cur && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />}
                      </button>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Прогресс проекта: доля закрытых — тонкая полоса, цифра открытых. */}
      <div className="mx-4 mb-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-medium text-faint">{t("sidebar.openIssues")}</p>
          <span className="tabular text-[13px] font-bold text-ink">{openCount ?? "…"}</span>
        </div>
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-active"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={closedPct}
          aria-label={t("sidebar.closedShare")}
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-solid),var(--status-done))] transition-[width] duration-500 ease-out"
            style={{ width: `${closedPct}%` }}
          />
        </div>
      </div>

      <div className="mx-2 mb-2 flex items-center gap-2.5 border-t border-linesoft/70 px-2.5 pb-1 pt-3">
        <Avatar user={me} size={28} interactive />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-ink">{me?.name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">{me?.role}</p>
        </div>
      </div>
    </aside>
  );
}
