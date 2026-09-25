import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import { openTotal } from "../boardFilters";
import type { ProjectSummary, ViewId } from "../types";
import {
  IcBacklog,
  IcBoard,
  IcBook,
  IcChevD,
  IcCompose,
  IcFlag,
  IcFlow,
  IcHome,
  IcLink,
  IcReport,
  IcSearch,
  IcSettings,
  IcShield,
  IcTimeline,
  IcUsers,
  Logo,
  type IconTone,
} from "../icons";
import { Avatar, Kbd, ProjectMark } from "../ui";
import { useEffect, useState } from "react";
import { useT, type TKey } from "../i18n";
import { openPalette, paletteShortcut } from "../palette/events";

type NavItem = {
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
};

/** Представления проекта — вкладки в шапке проекта (ADR-0013 §2.2); в боковой панели их нет. */
export const PROJECT_VIEWS: NavItem[] = [
  { id: "board", labelKey: "sidebar.nav.board", icon: (p) => <IcBoard {...p} />, tone: "violet", kbd: "1" },
  { id: "backlog", labelKey: "sidebar.nav.backlog", icon: (p) => <IcBacklog {...p} />, tone: "indigo", kbd: "2" },
  { id: "timeline", labelKey: "sidebar.nav.timeline", icon: (p) => <IcTimeline {...p} />, tone: "teal", kbd: "3" },
  { id: "sprints", labelKey: "sidebar.nav.sprints", icon: (p) => <IcFlag {...p} />, tone: "amber", kbd: "4", sprintsOnly: true },
];

/** Настройки до ТЗ 5.9: пока это прежние экраны, собранные под одним узлом
 *  «Настройки» (проект — процесс и доступ; организация — отделы и проекты). */
export const SETTINGS_VIEWS: NavItem[] = [
  { id: "workflow", labelKey: "sidebar.nav.workflow", icon: (p) => <IcFlow {...p} />, tone: "pink" },
  { id: "access", labelKey: "sidebar.nav.access", icon: (p) => <IcShield {...p} />, tone: "green" },
  { id: "admin", labelKey: "sidebar.nav.admin", icon: (p) => <IcUsers {...p} />, tone: "blue", adminOnly: true },
];

/** Плоский список всех разделов — для командной палитры (она ищет по нему). */
export const NAV_GROUPS: { labelKey: TKey; items: NavItem[] }[] = [
  { labelKey: "sidebar.group.projects", items: PROJECT_VIEWS },
  {
    labelKey: "sidebar.group.org",
    items: [
      { id: "reports", labelKey: "sidebar.nav.reports", icon: (p) => <IcReport {...p} />, tone: "sky" },
      { id: "collaborating", labelKey: "sidebar.nav.collaborating", icon: (p) => <IcLink {...p} />, tone: "violet", collabOnly: true },
      { id: "docs", labelKey: "sidebar.nav.docs", icon: (p) => <IcBook {...p} />, tone: "orange" },
    ],
  },
  { labelKey: "sidebar.settings", items: SETTINGS_VIEWS },
];

const OPEN_KEY = "taskira.sidebar.open";
const readOpen = (): Record<string, boolean> => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

// Классы пунктов — общие для всех уровней дерева.
const navItem = "group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium transition-colors duration-150";
const navOn =
  "bg-[linear-gradient(180deg,color-mix(in_oklch,var(--bg-panel)_92%,transparent),color-mix(in_oklch,var(--bg-panel)_70%,transparent))] font-semibold text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.08),0_0_0_1px_var(--border-subtle),var(--highlight-top)] before:absolute before:-left-2 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-accent before:shadow-[0_0_10px_var(--accent-glow)]";
const navOff = "text-ink/90 hover:bg-hover/70 hover:text-ink";
const sectionLabel = "flex w-full items-center gap-1 px-2.5 pb-1 pt-3 text-[11.5px] font-semibold tracking-[0.01em] text-faint";
/** Ветка дерева: отступ + направляющая линия слева — вложенность видна без подписей (ADR-0013 §1). */
const branch = "relative ml-[17px] flex flex-col gap-px border-l border-linesoft pl-2";

function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`flex text-faint transition-transform duration-200 ${open ? "" : "-rotate-90"}`}>
      <IcChevD size={12} />
    </span>
  );
}

export default function Sidebar() {
  const { t } = useT();
  const { data, ui, setView, me, goHome, switchProject, setCreateOpen, can } = useStore();
  const doneIds = new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id));
  // «Открытых задач» и полоса прогресса — агрегат по всему проекту: одним
  // запросом счётчиков, а не обходом всех задач на клиенте (PERF-06).
  const { counts } = useIssueCounts(data.currentProjectId || null, NO_ISSUE_FILTERS, useIssuesRevision());
  const openCount = openTotal(counts, doneIds);
  const totalCount = counts?.total ?? 0;
  const homeAvailable = data.projects.length >= 2;
  const closedPct = openCount === null ? 0 : Math.round((1 - openCount / Math.max(1, totalCount)) * 100);

  // Раскрытые узлы дерева (секции, отделы, проекты) — удобство, помним локально.
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* приватный режим — просто не запомним */
    }
  }, [open]);
  const isOpen = (id: string, dflt = true) => open[id] ?? dflt;
  const toggle = (id: string, dflt = true) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? dflt) }));

  // Проекты по отделам (ТЗ 5.6: «Проекты, сгруппированные по отделам»).
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? t("home.noDepartment");
  const byDept = new Map<string, ProjectSummary[]>();
  for (const p of data.projects) {
    const list = byDept.get(p.departmentId) ?? [];
    list.push(p);
    byDept.set(p.departmentId, list);
  }
  const deptGroups = [...byDept.entries()]
    .map(([id, ps]) => ({ id, name: deptName(id), projects: [...ps].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const favorites = data.projects.filter((p) => data.favoriteProjectIds.includes(p.id));

  const inSettings = SETTINGS_VIEWS.some((s) => s.id === ui.view);
  const settingsItems = SETTINGS_VIEWS.filter((s) => !s.adminOnly || me.globalRole === "admin");

  /** Открыть другой проект. Если сейчас открыто представление (Доска, Список…) —
   *  то же представление в новом проекте; иначе — Доска. switchProject сохраняет ui.view. */
  const openProject = (p: ProjectSummary) => {
    const keep = PROJECT_VIEWS.some((v) => v.id === ui.view) && (ui.view !== "sprints" || p.sprintsEnabled);
    if (!keep) setView("board");
    switchProject(p.id);
  };

  // Проект в дереве — одна строка: представления (Доска, Список, Таймлайн, Спринты) живут
  // вкладками в шапке проекта, не в панели (уточнение владельца к ADR-0013).
  const projectNode = (p: ProjectSummary) => {
    const cur = p.id === data.currentProjectId;
    const active = cur && PROJECT_VIEWS.some((v) => v.id === ui.view);
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => !cur ? openProject(p) : !active && setView("board")}
        aria-current={cur ? "true" : undefined}
        className={`${navItem} ${active ? navOn : cur ? "font-semibold text-ink" : navOff}`}
      >
        <ProjectMark projectKey={p.key} size={18} />
        <span className="flex-1 truncate">{p.name}</span>
        {cur && !active && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />}
      </button>
    );
  };

  return (
    <aside className="glass-side glass-edge my-2 ml-2 hidden w-[256px] shrink-0 flex-col overflow-hidden rounded-xl text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.06),0_12px_40px_-16px_oklch(0.2_0.08_288/0.3)] md:flex">
      {/* Знак + название инсталляции. Стеклянная панель над атмосферой (ADR-0016). */}
      <div className="mx-2 mt-2.5 flex items-center">
        {homeAvailable ? (
          <button
            type="button"
            onClick={goHome}
            aria-label={t("sidebar.homeAria")}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-hover/70"
          >
            <Logo size={22} />
            <span className="font-disp text-[16px] font-bold tracking-[-0.03em] text-ink">Taskira</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
            <Logo size={22} />
            <span className="font-disp text-[16px] font-bold tracking-[-0.03em] text-ink">Taskira</span>
          </div>
        )}
      </div>

      {/* Поиск и команды, новая задача (ADR-0013 §2.1). */}
      <div className="mx-2 mb-1 mt-1 flex flex-col gap-1">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 items-center gap-2.5 rounded-lg bg-[color-mix(in_oklch,var(--bg-panel)_55%,transparent)] px-2.5 text-[13px] text-faint ring-1 ring-inset ring-linesoft transition-colors hover:text-ink hover:ring-line"
        >
          <IcSearch size={14} />
          <span className="flex-1 text-left">{t("sidebar.search")}</span>
          <span className="font-mono text-[11px] tabular">{paletteShortcut()}</span>
        </button>
        {can("create") && (
          <button type="button" onClick={() => setCreateOpen(true)} className={`${navItem} ${navOff}`}>
            <IcCompose size={16} tone="violet" />
            <span className="flex-1 truncate">{t("sidebar.newIssue")}</span>
            <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Kbd>C</Kbd>
            </span>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none]">
        {/* Личный слой */}
        {(homeAvailable || data.collaborations.length > 0) && (
          <nav className="flex flex-col gap-px pt-1">
            {homeAvailable && (
              <button type="button" onClick={goHome} className={`${navItem} ${navOff}`}>
                <IcHome size={16} tone="violet" />
                <span className="flex-1 truncate">{t("sidebar.nav.home")}</span>
              </button>
            )}
            {data.collaborations.length > 0 && (
              <button
                type="button"
                onClick={() => setView("collaborating")}
                aria-current={ui.view === "collaborating" ? "page" : undefined}
                className={`${navItem} ${ui.view === "collaborating" ? navOn : navOff}`}
              >
                <IcLink size={16} tone="violet" />
                <span className="flex-1 truncate">{t("sidebar.nav.collaborating")}</span>
                <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">
                  {data.collaborations.length}
                </span>
              </button>
            )}
          </nav>
        )}

        {/* Избранное */}
        {favorites.length > 0 && (
          <div>
            <button type="button" onClick={() => toggle("s:fav")} aria-expanded={isOpen("s:fav")} className={`${sectionLabel} hover:text-sub`}>
              <Chevron open={isOpen("s:fav")} />
              {t("sidebar.group.favorites")}
            </button>
            {isOpen("s:fav") && (
              <div className="flex flex-col gap-px">
                {favorites.map((p) => (
                  <button key={p.id} type="button" onClick={() => p.id !== data.currentProjectId && openProject(p)} className={`${navItem} ${navOff}`}>
                    <ProjectMark projectKey={p.key} size={18} />
                    <span className="flex-1 truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Проекты: отдел → проект → представления */}
        <div>
          <button type="button" onClick={() => toggle("s:projects")} aria-expanded={isOpen("s:projects")} className={`${sectionLabel} hover:text-sub`}>
            <Chevron open={isOpen("s:projects")} />
            {t("sidebar.group.projects")}
          </button>
          {isOpen("s:projects") &&
            (deptGroups.length > 1 ? (
              <div className="flex flex-col gap-px">
                {deptGroups.map((g) => {
                  const hasCur = g.projects.some((p) => p.id === data.currentProjectId);
                  const expanded = isOpen(`d:${g.id}`, hasCur);
                  return (
                    <div key={g.id}>
                      <button type="button" onClick={() => toggle(`d:${g.id}`, hasCur)} aria-expanded={expanded} className={`${navItem} h-7 text-[12.5px] text-sub hover:bg-hover/70 hover:text-ink`}>
                        <Chevron open={expanded} />
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-[11px] tabular text-faint">{g.projects.length}</span>
                      </button>
                      {expanded && <div className={branch}>{g.projects.map(projectNode)}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-px">{deptGroups[0]?.projects.map(projectNode)}</div>
            ))}
        </div>

        {/* Организация */}
        <div>
          <p className={sectionLabel}>{t("sidebar.group.org")}</p>
          <button
            type="button"
            onClick={() => setView("reports")}
            aria-current={ui.view === "reports" ? "page" : undefined}
            className={`${navItem} ${ui.view === "reports" ? navOn : navOff}`}
          >
            <IcReport size={16} tone="sky" />
            <span className="flex-1 truncate">{t("sidebar.nav.reports")}</span>
          </button>
        </div>
      </div>

      {/* Прогресс проекта: доля закрытых — тонкая полоса, цифра открытых. */}
      <div className="mx-4 mb-2 mt-1">
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

      {/* Низ: Справка и Настройки (до 5.9 — прежние экраны под одним узлом), профиль. */}
      <div className="mx-2 flex flex-col gap-px border-t border-linesoft/70 pt-2">
        <button
          type="button"
          onClick={() => setView("docs")}
          aria-current={ui.view === "docs" ? "page" : undefined}
          className={`${navItem} ${ui.view === "docs" ? navOn : navOff}`}
        >
          <IcBook size={16} tone="orange" />
          <span className="flex-1 truncate">{t("sidebar.nav.docs")}</span>
          <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <Kbd>?</Kbd>
          </span>
        </button>
        <button type="button" onClick={() => toggle("s:settings", false)} aria-expanded={isOpen("s:settings", inSettings)} className={`${navItem} ${navOff}`}>
          <IcSettings size={16} tone="gray" />
          <span className="flex-1 truncate">{t("sidebar.settings")}</span>
          <Chevron open={isOpen("s:settings", inSettings)} />
        </button>
        {isOpen("s:settings", inSettings) && (
          <div className={`${branch} mb-1`}>
            {settingsItems.map((v) => {
              const active = ui.view === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  aria-current={active ? "page" : undefined}
                  className={`${navItem} h-[30px] text-[13px] ${active ? navOn : navOff}`}
                >
                  {v.icon({ size: 15, tone: v.tone })}
                  <span className="flex-1 truncate">{t(v.labelKey)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-2 mb-2 mt-1 flex items-center gap-2.5 px-2.5 pb-1 pt-2">
        <Avatar user={me} size={28} interactive />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-ink">{me?.name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">{me?.role}</p>
        </div>
      </div>
    </aside>
  );
}
