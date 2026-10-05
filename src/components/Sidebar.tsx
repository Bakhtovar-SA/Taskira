import { Kbd } from "../ds/Display";
import { Button, IconButton } from "../ds/Button";
import { UserMenu } from "./UserMenu";
import { useStore, useUnreadCount } from "../store";
import { GettingStarted } from "./GettingStarted";
import { Tag } from "../ds/Display";
import type { ProjectSummary, ViewId } from "../types";
import {
  IcBacklog,
  IcBoard,
  IcBook,
  IcBriefcase,
  IcChevD,
  IcCompose,
  IcFlag,
  IcFlow,
  IcHome,
  IcInbox,
  IcLink,
  IcMyIssues,
  IcPanel,
  IcPlus,
  IcReport,
  IcDashboard,
  IcSearch,
  IcSettings,
  IcStar,
  IcTimeline,
  IcCalendar,
  IcUsers,
  type IconTone,
} from "../icons";
import { BrandMark, BrandName } from "./BrandMark";
import { useBrandName } from "../brand";
import { ProjectMark } from "../ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useT, type TKey } from "../i18n";
import { openPalette, openProjectWizard, paletteShortcut, openHomeCreate } from "../palette/events";
import { useOpenSettings } from "../settings/useOpenSettings";

const RailTooltip = lazy(() => import("../ds/Overlay").then((m) => ({ default: m.Tooltip })));

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
  { id: "overview", labelKey: "sidebar.nav.overview", icon: (p) => <IcDashboard {...p} />, tone: "pink" },
  { id: "board", labelKey: "sidebar.nav.board", icon: (p) => <IcBoard {...p} />, tone: "violet", kbd: "1" },
  { id: "backlog", labelKey: "sidebar.nav.backlog", icon: (p) => <IcBacklog {...p} />, tone: "indigo", kbd: "2" },
  { id: "timeline", labelKey: "sidebar.nav.timeline", icon: (p) => <IcTimeline {...p} />, tone: "teal", kbd: "3" },
  { id: "calendar", labelKey: "calendar.title", icon: (p) => <IcCalendar {...p} />, tone: "blue", kbd: "5" },
  { id: "sprints", labelKey: "sidebar.nav.sprints", icon: (p) => <IcFlag {...p} />, tone: "amber", kbd: "4", sprintsOnly: true },
];

/** Три дома настроек (ADR-0013 §2, ТЗ 5.9): Личные, Проект, Организация. */
export const SETTINGS_VIEWS: NavItem[] = [
  { id: "settings", labelKey: "settings.home.personal", icon: (p) => <IcBriefcase {...p} />, tone: "violet" },
  { id: "projectSettings", labelKey: "settings.home.project", icon: (p) => <IcFlow {...p} />, tone: "pink" },
  { id: "orgSettings", labelKey: "settings.home.org", icon: (p) => <IcUsers {...p} />, tone: "blue", adminOnly: true },
];

/** Личный слой (ADR-0013 §1): Входящие и Мои задачи — по всем проектам. */
export const PERSONAL_VIEWS: NavItem[] = [
  { id: "inbox", labelKey: "sidebar.nav.inbox", icon: (p) => <IcInbox {...p} />, tone: "sky" },
  { id: "my", labelKey: "sidebar.nav.my", icon: (p) => <IcMyIssues {...p} />, tone: "violet" },
];

/** Плоский список всех разделов — для командной палитры (она ищет по нему). */
export const NAV_GROUPS: { labelKey: TKey; items: NavItem[] }[] = [
  { labelKey: "sidebar.group.personal", items: PERSONAL_VIEWS },
  { labelKey: "sidebar.group.projects", items: PROJECT_VIEWS },
  {
    labelKey: "sidebar.group.org",
    items: [
      { id: "roadmap", labelKey: "sidebar.nav.roadmap", icon: (p) => <IcFlag {...p} />, tone: "teal" },
      { id: "dashboards", labelKey: "sidebar.nav.dashboards", icon: (p) => <IcDashboard {...p} />, tone: "violet" },
      { id: "reports", labelKey: "sidebar.nav.reports", icon: (p) => <IcReport {...p} />, tone: "sky" },
      { id: "collaborating", labelKey: "sidebar.nav.collaborating", icon: (p) => <IcLink {...p} />, tone: "violet", collabOnly: true },
      { id: "docs", labelKey: "sidebar.nav.docs", icon: (p) => <IcBook {...p} />, tone: "orange" },
    ],
  },
  { labelKey: "sidebar.settings", items: SETTINGS_VIEWS },
];

/** Узкий экран (< 1024 px): панель выезжает поверх по кнопке «Меню» в шапке (ТЗ 5.8 п.3). */
export const SIDEBAR_DRAWER_EVT = "taskira:sidebar-drawer";
export const openSidebarDrawer = () => window.dispatchEvent(new Event(SIDEBAR_DRAWER_EVT));

const WIDE = "(min-width: 1024px)";
const isWide = () => window.matchMedia?.(WIDE).matches ?? true;
function useWide() {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

const COLLAPSED_KEY = "taskira.sidebar.collapsed";
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
const navItem = "tk-nav group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] font-medium transition-colors duration-150";
const navOn = "tk-nav-active bg-[var(--sidebar-item-active)] font-semibold text-accenttext";
const navOff = "text-ink/90 hover:bg-hover/70 hover:text-ink";
const sectionLabel = "flex w-full items-center gap-1 px-2.5 pb-1 pt-3 text-[12px] font-semibold tracking-[0.01em] text-faint";
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
  const { data, ui: storedUi, setView: storeSetView, me, goHome, switchProject, enterProject, bootStatus, setCreateOpen, can, logout, refreshAssignedToMe } = useStore();
  const home = bootStatus === "home";
  const ui = home ? { ...storedUi, view: undefined } : storedUi;
  const setView: typeof storeSetView = (view, section) => {
    storeSetView(view, section);
    if (home) enterProject(data.currentProjectId || data.projects[0]?.id);
  };
  const openSettings = useOpenSettings();
  const homeAvailable = data.projects.length > 0;
  useEffect(() => { void refreshAssignedToMe(); }, [refreshAssignedToMe, data.currentProjectId]);

  // Раскрытые узлы дерева (секции, отделы, проекты) — удобство, помним локально.
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* приватный режим — просто не запомним */
    }
  }, [open]);
  const unread = useUnreadCount();
  const wide = useWide();

  // Свёрнута в полосу иконок (≥ 1024 px) — помним локально, как тему.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* приватный режим */
    }
  }, [collapsed]);
  const rail = collapsed && wide;

  // Выезжающая панель на узком экране: открывает кнопка «Меню» в шапке, закрывает
  // переход, Esc или клик мимо.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const on = () => setDrawer(true);
    window.addEventListener(SIDEBAR_DRAWER_EVT, on);
    return () => window.removeEventListener(SIDEBAR_DRAWER_EVT, on);
  }, []);
  useEffect(() => setDrawer(false), [ui.view, data.currentProjectId, wide, home]);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (drawer) asideRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [drawer]);

  // «[» — свернуть/развернуть (на узком экране — открыть/закрыть), Esc закрывает выезжающую.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.key === "Escape" && drawer) {
        setDrawer(false);
        return;
      }
      if (e.code !== "BracketLeft" || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      if (isWide()) setCollapsed((c) => !c);
      else setDrawer((d) => !d);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

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

  const inSettings = SETTINGS_VIEWS.some((s) => s.id === ui.view);
  const settingsItems = SETTINGS_VIEWS.filter((s) => !s.adminOnly || me.globalRole === "admin");

  /** Открыть другой проект. Если сейчас открыто представление (Доска, Список…) —
   *  то же представление в новом проекте; иначе — Доска. switchProject сохраняет ui.view. */
  const openProject = (p: ProjectSummary) => {
    const keep = PROJECT_VIEWS.some((v) => v.id === ui.view) && (ui.view !== "sprints" || p.sprintsEnabled);
    if (!keep || home) storeSetView(p.defaultView ?? "board");
    switchProject(p.id);
  };

  // Проект в дереве — одна строка: представления (Доска, Список, Таймлайн, Спринты) живут
  // вкладками в шапке проекта, не в панели (уточнение владельца к ADR-0013).
  const projectNode = (p: ProjectSummary) => {
    const cur = !home && p.id === data.currentProjectId;
    const active = cur && PROJECT_VIEWS.some((v) => v.id === ui.view);
    return (
      <Button variant="ghost" size="sm"
        key={p.id}
        type="button"
        onClick={() => !cur ? openProject(p) : !active && setView("board")}
        aria-current={cur ? "true" : undefined}
        className={(`${navItem} ${active ? navOn : cur ? "font-semibold text-ink" : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
      >
        <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={18} />
        <span className="flex-1 truncate">{p.name}</span>
        {data.favoriteProjectIds.includes(p.id) && <span className="flex shrink-0 text-[var(--amber-solid)]"><IcStar size={12} filled /></span>}
        {p.isDemo && <Tag tone="amber" size="sm">{t("setup.demoTag")}</Tag>}
        {cur && !active && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />}
      </Button>
    );
  };

  const shell = `glass-side glass-edge flex shrink-0 flex-col overflow-hidden rounded-[16px] text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.06),0_12px_40px_-16px_oklch(0.2_0.08_288/0.3)]
    lg:relative lg:my-2 lg:ml-2 lg:transition-[width] lg:duration-200 lg:ease-out
    side-drawer max-lg:fixed max-lg:inset-y-2 max-lg:left-2 max-lg:z-50 max-lg:w-[256px] max-lg:max-w-[calc(100vw-48px)] max-lg:transition-[transform,visibility] max-lg:duration-300 max-lg:ease-out
    ${drawer ? "" : "max-lg:invisible max-lg:-translate-x-[calc(100%+16px)]"}`;

  if (rail)
    return (
      <Rail
        className={`${shell} w-[60px]`}
        homeAvailable={homeAvailable}
        unread={unread}
        projects={deptGroups.flatMap((g) => g.projects)}
        openProject={openProject}
        onExpand={() => setCollapsed(false)}
      />
    );

  return (
    <>
    {drawer && <div className="anim-scrim fixed inset-0 z-40 bg-[color-mix(in_oklch,var(--bg-scrim)_60%,transparent)] lg:hidden" onClick={() => setDrawer(false)} />}
    <aside ref={asideRef} aria-label={t("sidebar.menu")} className={`${shell} lg:w-[256px]`}>
      {/* Знак + название инсталляции. Стеклянная панель над атмосферой (ADR-0016). */}
      <div className="mx-2 mt-2.5 flex items-center">
        {homeAvailable ? (
          <Button variant="ghost" size="sm"
            type="button"
            onClick={goHome}
            aria-label={t("sidebar.homeAria")}
            className="min-w-0 flex-1 text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
          >
            <BrandMark size={22} />
            <BrandName className="truncate font-disp text-[16px] font-bold tracking-[-0.03em] text-ink" />
          </Button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
            <BrandMark size={22} />
            <BrandName className="truncate font-disp text-[16px] font-bold tracking-[-0.03em] text-ink" />
          </div>
        )}
        <IconButton variant="ghost" size="sm" label={t(wide ? "sidebar.collapse" : "common.close")}
          type="button"
          onClick={() => (wide ? setCollapsed(true) : setDrawer(false))}


          className="h-7 w-7 shrink-0"
        >
          <IcPanel size={15} />
        </IconButton>
      </div>

      {/* Command palette and creation share one compact row. */}
      <div className="sidebar-quick-actions mx-2 mb-1 mt-1 flex min-w-0 gap-1.5">
        <Button variant="secondary" size="sm" onClick={openPalette} aria-label={t("sidebar.search")} className="sidebar-search min-w-0 flex-1"
          iconLeft={<IcSearch size={14} />} iconRight={<Kbd>{paletteShortcut()}</Kbd>}>
          {t("sidebar.search")}
        </Button>
        {(home || can("create")) && <IconButton variant="secondary" size="sm" label={t("sidebar.newIssue")} kbd="C"
          onClick={() => home ? openHomeCreate() : setCreateOpen(true)} className="sidebar-compose shrink-0 text-accenttext">
          <IcCompose size={16} />
        </IconButton>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none]">
        {/* Личный слой */}
        <nav aria-label={t("calendar.personalNav")} className="flex flex-col gap-px pt-1">
            {homeAvailable && (
              <Button variant="ghost" size="sm" type="button" onClick={goHome} aria-current={home ? "page" : undefined} className={(`${navItem} ${home ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}>
                <IcHome size={16} tone="violet" />
                <span className="flex-1 truncate">{t("sidebar.nav.home")}</span>
              </Button>
            )}
            {PERSONAL_VIEWS.map((v) => {
              const on = !home && ui.view === v.id;
              return (
                <Button variant="ghost" size="sm"
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  aria-current={on ? "page" : undefined}
                  className={(`${navItem} ${on ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
                >
                  {v.icon({ size: 16, tone: v.tone })}
                  <span className="flex-1 truncate">{t(v.labelKey)}</span>
                  {v.id === "my" && <span className="text-[12px] font-semibold tabular text-faint">{data.assignedToMe.length}{data.assignedTruncated ? "+" : ""}</span>}
                  {v.id === "inbox" && unread > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-bold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Button>
              );
            })}
            {data.collaborations.length > 0 && (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setView("collaborating")}
                aria-current={ui.view === "collaborating" ? "page" : undefined}
                className={(`${navItem} ${ui.view === "collaborating" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
              >
                <IcLink size={16} tone="violet" />
                <span className="flex-1 truncate">{t("sidebar.nav.collaborating")}</span>
                <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">
                  {data.collaborations.length}
                </span>
              </Button>
            )}
        </nav>

        {/* Проекты: отдел → проект → представления */}
        <div>
          <div className="group/proj flex items-center">
            <Button variant="ghost" size="sm" type="button" onClick={() => toggle("s:projects")} aria-expanded={isOpen("s:projects")} className={(`${sectionLabel} hover:text-sub`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}>
              <Chevron open={isOpen("s:projects")} />
              {t("sidebar.group.projects")}
            </Button>
            {me.globalRole === "admin" && (
              <IconButton variant="ghost" size="sm" label={t("wizard.title")}
                type="button"
                onClick={() => openProjectWizard()}


                className="mr-1 mt-2 h-6 w-6 shrink-0 "
              >
                <IcPlus size={13} />
              </IconButton>
            )}
          </div>
          {isOpen("s:projects") &&
            (deptGroups.length > 1 ? (
              <div className="flex flex-col gap-px">
                {deptGroups.map((g) => {
                  const hasCur = g.projects.some((p) => p.id === data.currentProjectId);
                  const expanded = isOpen(`d:${g.id}`, hasCur);
                  return (
                    <div key={g.id}>
                      <Button variant="ghost" size="sm" type="button" onClick={() => toggle(`d:${g.id}`, hasCur)} aria-expanded={expanded} className={(`${navItem} h-7 text-[12.5px] text-sub hover:bg-hover/70 hover:text-ink`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}>
                        <Chevron open={expanded} />
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-[11px] tabular text-faint">{g.projects.length}</span>
                      </Button>
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
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => setView("roadmap")}
            aria-current={ui.view === "roadmap" ? "page" : undefined}
            className={(`${navItem} ${ui.view === "roadmap" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
          >
            <IcFlag size={16} tone="teal" />
            <span className="flex-1 truncate">{t("sidebar.nav.roadmap")}</span>
          </Button>
          {/* «Дашборды» — раздел, в котором «Отчёты» — первый встроенный дашборд (ADR-0022). */}
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => setView("dashboards")}
            aria-current={ui.view === "dashboards" || ui.view === "reports" ? "page" : undefined}
            className={(`${navItem} ${ui.view === "dashboards" || ui.view === "reports" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
          >
            <IcDashboard size={16} tone="violet" />
            <span className="flex-1 truncate">{t("sidebar.nav.dashboards")}</span>
          </Button>
        </div>
      </div>

      {/* «Начало работы» (ТЗ 5.11) — тем, у кого нет главной (один проект): свёрнутая строка с прогрессом. */}
      {!home && data.projects.length < 2 && !collapsed && <GettingStarted compact className="mx-3 mb-2" />}

      {/* Низ: Справка и Настройки (до 5.9 — прежние экраны под одним узлом), профиль. */}
      <div className="mx-2 flex flex-col gap-px border-t border-linesoft/70 pt-2">
        <Button variant="ghost" size="sm"
          type="button"
          onClick={() => setView("docs")}
          aria-current={ui.view === "docs" ? "page" : undefined}
          className={(`${navItem} ${ui.view === "docs" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
        >
          <IcBook size={16} tone="orange" />
          <span className="flex-1 truncate">{t("sidebar.nav.docs")}</span>
          <span className="text-faint">
            <Kbd>?</Kbd>
          </span>
        </Button>
          <div id="sidebar-settings" hidden={!isOpen("s:settings", inSettings)} className={`${branch} mb-1`}>
            {settingsItems.map((v) => {
              const active = ui.view === v.id;
              return (
                <Button variant="ghost" size="sm"
                  key={v.id}
                  type="button"
                  onClick={() => openSettings(v.id as "settings" | "projectSettings" | "orgSettings")}
                  aria-current={active ? "page" : undefined}
                  className={(`${navItem} h-[30px] text-[13px] ${active ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
                >
                  {v.icon({ size: 15, tone: v.tone })}
                  <span className="flex-1 truncate">{t(v.labelKey)}</span>
                </Button>
              );
            })}
          </div>
      </div>

      <div className="mx-2 mb-2 mt-1 flex min-w-0 items-center gap-1 border-t border-linesoft pt-2">
        <UserMenu onLogout={logout} sidebar />
        <IconButton variant="ghost" size="sm" label={t("sidebar.settings")} aria-expanded={isOpen("s:settings", inSettings)}
          aria-controls="sidebar-settings" onClick={() => toggle("s:settings", inSettings)} className="shrink-0">
          <IcSettings size={16} />
        </IconButton>
      </div>
    </aside>
    </>
  );
}

/** Свёрнутая панель — полоса иконок (ТЗ 5.8 п.1). Тот же состав, что у полной: подписи —
 *  всплывающие подсказки справа (фиксированный слой: полоса обрезает всё, что шире неё). */
function Rail({
  className,
  homeAvailable,
  unread,
  projects,
  openProject,
  onExpand,
}: {
  className: string;
  homeAvailable: boolean;
  unread: number;
  projects: ProjectSummary[];
  openProject: (p: ProjectSummary) => void;
  onExpand: () => void;
}) {
  const { t } = useT();
  const { data, ui: storedUi, me, setView: storeSetView, goHome, enterProject, bootStatus, setCreateOpen, can, logout } = useStore();
  const home = bootStatus === "home";
  const ui = home ? { ...storedUi, view: undefined } : storedUi;
  const setView: typeof storeSetView = (view, section) => {
    storeSetView(view, section);
    if (home) enterProject(data.currentProjectId || data.projects[0]?.id);
  };
  const openSettings = useOpenSettings();
  const brandName = useBrandName();
  const btn = (key: string, label: string, icon: React.ReactNode, onClick: () => void, on = false, extra?: React.ReactNode) => {
    const button = (
      <Button variant="ghost" size="sm"
        key={key}
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={on ? "page" : undefined}
        className={(`tk-nav tk-nav-rail relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${on ? navOn : "text-sub hover:bg-hover/70 hover:text-ink"}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
      >
        {icon}
        {extra}
      </Button>
    );
    return <Suspense key={key} fallback={button}><RailTooltip label={label} placement="right">{button}</RailTooltip></Suspense>;
  };
  const sep = <span className="my-1.5 h-px w-6 shrink-0 bg-linesoft" />;

  return (
    <aside aria-label={t("sidebar.menu")} className={`${className} items-center py-2.5`}>
      {btn("logo", homeAvailable ? t("sidebar.homeAria") : brandName, <BrandMark size={22} />, () => homeAvailable && goHome())}
      <div className="mt-1.5 flex flex-col items-center gap-1">
        {btn("search", `${t("sidebar.search")} · ${paletteShortcut()}`, <IcSearch size={16} />, openPalette)}
        {(home || can("create")) && btn("new", `${t("sidebar.newIssue")} · C`, <IcCompose size={16} tone="violet" />, () => home ? openHomeCreate() : setCreateOpen(true))}
      </div>
      {sep}
      <div className="flex flex-col items-center gap-1">
        {homeAvailable && btn("home", t("sidebar.nav.home"), <IcHome size={16} tone="violet" />, goHome, home)}
        {PERSONAL_VIEWS.map((v) =>
          btn(v.id, t(v.labelKey), v.icon({ size: 16, tone: v.tone }), () => setView(v.id), !home && ui.view === v.id,
            v.id === "inbox" && unread > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] ring-2 ring-[var(--bg-frame)]" /> : undefined,
          ),
        )}
        {data.collaborations.length > 0 &&
          btn("collab", t("sidebar.nav.collaborating"), <IcLink size={16} tone="violet" />, () => setView("collaborating"), ui.view === "collaborating")}
      </div>
      {sep}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none]">
        {projects.map((p) => {
          const cur = !home && p.id === data.currentProjectId;
          const active = cur && PROJECT_VIEWS.some((v) => v.id === ui.view);
          return btn(
            `p:${p.id}`,
            p.name,
            <span className={`flex rounded-md ${cur && !active ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-[var(--bg-frame)]" : ""}`}>
              <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={22} />
            </span>,
            () => (!cur ? openProject(p) : !active && setView("board")),
            active,
          );
        })}
        {sep}
        {btn("roadmap", t("sidebar.nav.roadmap"), <IcFlag size={16} tone="teal" />, () => setView("roadmap"), ui.view === "roadmap")}
        {btn("dashboards", t("sidebar.nav.dashboards"), <IcDashboard size={16} tone="violet" />, () => setView("dashboards"), ui.view === "dashboards" || ui.view === "reports")}
      </div>
      <div className="mt-1 flex flex-col items-center gap-1 border-t border-linesoft/70 pt-2">
        {btn("docs", t("sidebar.nav.docs"), <IcBook size={16} tone="orange" />, () => setView("docs"), ui.view === "docs")}
        {btn("settings", t("sidebar.settings"), <IcSettings size={16} tone="gray" />, () => openSettings("projectSettings"), SETTINGS_VIEWS.some((s) => s.id === ui.view))}
        {btn("expand", `${t("sidebar.expand")} · [`, <IcPanel size={16} />, onExpand)}
        <span className="mt-1">
          <UserMenu onLogout={logout} sidebar compact />
        </span>
      </div>
    </aside>
  );
}
