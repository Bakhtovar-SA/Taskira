import { Kbd } from "../ds/Display";
import { Button, IconButton } from "../ds/Button";
import { useStore, useUnreadCount } from "../store";
import { usePulse } from "../usePulse";
import { cssZoom, glideWidth, preloadMotionIdle } from "../motion";
import { GettingStarted } from "./GettingStarted";
import { Tag } from "../ds/Display";
import type { ProjectSummary, ViewId } from "../types";
import {
  IcBacklog,
  IcBoard,
  IcBook,
  IcBriefcase,
  IcChevD,
  IcDots,
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
  IcStar,
  IcTimeline,
  IcCalendar,
  IcUsers,
  type IconTone,
} from "../icons";
import { BrandMark, BrandName } from "./BrandMark";
import { useBrandName } from "../brand";
import { ProjectMark } from "../ui";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type TKey } from "../i18n";
import { openProjectWizard } from "../palette/events";
import "../styles/navigation.css";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { firstSection } from "../settings/access";

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
const navItem = "tk-nav group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] font-medium transition-colors duration-150";
const navOn = "tk-nav-active bg-[var(--sidebar-item-active)] font-semibold text-accenttext";
const navOff = "text-ink/90 hover:bg-hover/70 hover:text-ink";
const sectionLabel = "flex w-full items-center gap-1 px-2.5 pb-1 pt-3 text-[13px] font-semibold tracking-[0.01em] text-faint";

function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`flex text-faint transition-transform duration-200 ${open ? "" : "-rotate-90"}`}>
      <IcChevD size={14} />
    </span>
  );
}

export default function Sidebar() {
  const { t } = useT();
  const { data, ui: storedUi, setView: storeSetView, me, goHome, switchProject, enterProject, bootStatus, refreshAssignedToMe } = useStore();
  const home = bootStatus === "home";
  const ui = home ? { ...storedUi, view: undefined } : storedUi;
  const setView: typeof storeSetView = (view, section) => {
    storeSetView(view, section);
    if (home) enterProject(data.currentProjectId || data.projects[0]?.id);
  };
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
  const badgeRef = usePulse<HTMLSpanElement>(unread);
  const myCountRef = usePulse<HTMLSpanElement>(data.assignedToMe.length, "any");
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
  const firstShell = useRef(true);
  useLayoutEffect(() => {
    if (firstShell.current) { firstShell.current = false; return; }
    const from = widthBefore.current;
    widthBefore.current = null;
    const shell = document.querySelector<HTMLElement>("aside.glass-side");
    if (from === null || !shell) return;
    glideWidth(shell, from, shell.getBoundingClientRect().width / cssZoom(shell));
  }, [rail]);
  useEffect(() => preloadMotionIdle(), []);

  // Выезжающая панель на узком экране: открывает кнопка «Меню» в шапке, закрывает
  // переход, Esc или клик мимо.
  const [drawer, setDrawer] = useState(false);
  const drawerOpener = useRef<HTMLElement | null>(null);
  // Свёртка/развёртка: «корпус» (aside.glass-side) пересоздаётся с другой разметкой — запоминаем ширину прежнего и
  // после коммита плавно ведём новый от неё (ADR-0035, прототип). Содержимое рядом едет вместе с шириной панели.
  const widthBefore = useRef<number | null>(null);
  const changeCollapsed = (next: boolean) => {
    const shell = document.querySelector<HTMLElement>("aside.glass-side");
    widthBefore.current = wide && shell ? shell.getBoundingClientRect().width / cssZoom(shell) : null; // в режиме выезжающей панели `rail` не меняется — устаревшая ширина не нужна
    setCollapsed(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus());
  };
  useEffect(() => {
    const on = () => { drawerOpener.current = document.activeElement as HTMLElement | null; setDrawer(true); };
    window.addEventListener(SIDEBAR_DRAWER_EVT, on);
    return () => window.removeEventListener(SIDEBAR_DRAWER_EVT, on);
  }, []);
  useEffect(() => setDrawer(false), [ui.view, data.currentProjectId, wide, home]);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const aside = asideRef.current;
    if (!drawer || wide || !aside) return;
    const opener = drawerOpener.current;
    const background = [...(aside.parentElement?.children ?? [])]
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el !== aside && !el.hasAttribute("data-sidebar-scrim"))
      .map(el => ({ el, inert: el.inert }));
    background.forEach(({ el }) => { el.inert = true; });
    const controls = () => [...aside.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")]
      .filter(el => el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true" && el.getClientRects().length > 0);
    const first = () => controls()[0] ?? aside;
    first().focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDrawer(false); return; }
      if (event.key !== "Tab") return;
      const items = controls(), start = items[0], end = items.at(-1);
      if (!start || !end) { event.preventDefault(); aside.focus(); return; }
      if (!aside.contains(document.activeElement) || (event.shiftKey && document.activeElement === start) || (!event.shiftKey && document.activeElement === end)) {
        event.preventDefault(); (event.shiftKey ? end : start).focus();
      }
    };
    document.addEventListener("keydown", trap, true);

    return () => {
      document.removeEventListener("keydown", trap, true);

      background.forEach(({ el, inert }) => { el.inert = inert; });
      if (opener?.isConnected) opener.focus();
    };
  }, [drawer, wide]);

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
      if (isWide()) changeCollapsed(!collapsed);
      else { if (!drawer) drawerOpener.current = document.activeElement as HTMLElement | null; setDrawer((d) => !d); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, collapsed]);

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


  /** Открыть другой проект. Если сейчас открыто представление (Доска, Список…) —
   *  то же представление в новом проекте; иначе — Доска. switchProject сохраняет ui.view. */
  const openProject = (p: ProjectSummary) => {
    const keep = PROJECT_VIEWS.some((v) => v.id === ui.view) && (ui.view !== "sprints" || p.sprintsEnabled);
    if (!keep || home) storeSetView(p.defaultView ?? "board");
    if (home) enterProject(p.id);
    else switchProject(p.id);
  };
  const openProjectSettings = (p: ProjectSummary) => {
    storeSetView("projectSettings", firstSection("projectSettings", { isAdmin: me.globalRole === "admin", hasProject: true }) ?? "");
    enterProject(p.id);
  };

  // Проект в дереве — одна строка: представления (Доска, Список, Таймлайн, Спринты) живут
  // вкладками в шапке проекта, не в панели (уточнение владельца к ADR-0013).
  const projectNode = (p: ProjectSummary) => {
    const cur = !home && p.id === data.currentProjectId;
    const active = cur && PROJECT_VIEWS.some((v) => v.id === ui.view);
    return (
      <div key={p.id} className="sidebar-project-row">
      <Button variant="ghost" size="sm"
        type="button"
        onClick={() => !cur ? openProject(p) : !active && setView("board")}
        aria-current={cur ? "true" : undefined}
        className={(`sidebar-project-link ${navItem} ${active ? navOn : cur ? "font-semibold text-ink" : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
      >
        <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={18} />
        <span className="flex-1 truncate">{p.name}</span>
        {data.favoriteProjectIds.includes(p.id) && <span className="flex shrink-0 text-[var(--amber-solid)]"><IcStar size={14} filled /></span>}
        {p.isDemo && <Tag tone="amber" size="sm">{t("setup.demoTag")}</Tag>}
        {cur && !active && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />}
      </Button>
      <IconButton variant="ghost" size="sm" label={t("settings.title") + " · " + p.name} className="sidebar-project-settings" onClick={() => openProjectSettings(p)}>
        <IcDots size={16} />
      </IconButton>
      </div>
    );
  };

  const shell = `glass-side glass-edge flex shrink-0 flex-col overflow-hidden rounded-[16px] text-ink shadow-[0_1px_2px_oklch(0.2_0.05_288/0.06),0_12px_40px_-16px_oklch(0.2_0.08_288/0.3)]
    lg:relative lg:my-2 lg:ml-2 lg:transition-[width] lg:duration-200 lg:ease-out
    side-drawer max-lg:fixed max-lg:inset-y-2 max-lg:left-2 max-lg:z-50 max-lg:w-[304px] max-lg:max-w-[calc(100vw-48px)] max-lg:transition-[transform,visibility] max-lg:duration-300 max-lg:ease-out
    ${drawer ? "" : "max-lg:invisible max-lg:-translate-x-[calc(100%+16px)]"}`;

  if (rail)
    return (
      <Rail
        className={`${shell} w-[60px]`}
        homeAvailable={homeAvailable}
        unread={unread}
        projects={deptGroups.flatMap((g) => g.projects)}
        openProject={openProject}
        onExpand={() => changeCollapsed(false)}
      />
    );

  return (
    <>
    {drawer && <div data-sidebar-scrim className="anim-scrim fixed inset-0 z-40 bg-[color-mix(in_oklch,var(--bg-scrim)_60%,transparent)] lg:hidden" onClick={() => setDrawer(false)} />}
    <aside ref={asideRef} role={drawer && !wide ? "dialog" : undefined} aria-modal={drawer && !wide ? true : undefined} tabIndex={-1} aria-label={t("sidebar.menu")} id="taskira-sidebar" className={`${shell} sidebar-expanded`}>
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
            <BrandName className="truncate font-disp text-[17px] font-bold tracking-[-0.03em] text-ink" />
          </Button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
            <BrandMark size={22} />
            <BrandName className="truncate font-disp text-[17px] font-bold tracking-[-0.03em] text-ink" />
          </div>
        )}
        {!wide && <IconButton variant="ghost" size="sm" label={t("common.close")} onClick={() => setDrawer(false)} className="h-9 w-9 shrink-0"><IcPanel size={17} /></IconButton>}
      </div>


      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none]">
        {/* Личный слой */}
        <nav aria-label={t("calendar.personalNav")} className="flex flex-col gap-px pt-1">
            {homeAvailable && (
              <Button variant="ghost" size="sm" type="button" onClick={goHome} aria-current={home ? "page" : undefined} className={(`${navItem} ${home ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}>
                <IcHome size={18} tone="violet" />
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
                  {v.id === "my" && <span ref={myCountRef} className="text-[13px] font-semibold tabular text-faint">{data.assignedToMe.length}{data.assignedTruncated ? "+" : ""}</span>}
                  {v.id === "inbox" && unread > 0 && (
                    <span ref={badgeRef} className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[13px] font-bold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">
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
                <IcLink size={18} tone="violet" />
                <span className="flex-1 truncate">{t("sidebar.nav.collaborating")}</span>
                <span className="rounded-full bg-accent px-1.5 py-px text-[11.5px] font-semibold tabular text-onaccent shadow-[0_2px_8px_-2px_var(--accent-glow)]">
                  {data.collaborations.length}
                </span>
              </Button>
            )}
        </nav>

        {/* Команда — статичный заголовок; проекты раскрыты по умолчанию. */}
        <div className="sidebar-teams">
          {(deptGroups.length ? deptGroups : [{ id: "", name: t("home.noDepartment"), projects: [] }]).map((g, index) => {
            const expanded = isOpen(`projects:${g.id}`);
            const listId = `sidebar-projects-${index}`;
            return (
              <section key={g.id} className="sidebar-team">
                <h2 className="sidebar-team-heading" title={g.name}>{g.name}</h2>
                <div className="sidebar-projects-header">
                  <Button variant="ghost" size="sm" type="button"
                    onClick={() => toggle(`projects:${g.id}`)}
                    aria-expanded={expanded} aria-controls={listId}
                    className="sidebar-projects-toggle [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:items-center [&>span.truncate]:gap-2">
                    <Chevron open={expanded} />
                    <span className="sidebar-projects-title">{t("sidebar.group.projects")}</span>
                    <span className="sidebar-projects-count">{g.projects.length}</span>
                  </Button>
                  {me.globalRole === "admin" && (
                    <IconButton variant="ghost" size="sm" label={t("wizard.title") + " · " + g.name}
                      onClick={() => openProjectWizard(g.id || undefined)} className="sidebar-projects-add">
                      <IcPlus size={15} />
                    </IconButton>
                  )}
                </div>
                <div id={listId} hidden={!expanded} className="sidebar-projects-list">{g.projects.map(projectNode)}</div>
              </section>
            );
          })}
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
            <IcFlag size={18} tone="teal" />
            <span className="flex-1 truncate">{t("sidebar.nav.roadmap")}</span>
          </Button>
          {/* «Дашборды» — раздел, в котором «Отчёты» — первый встроенный дашборд (ADR-0022). */}
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => setView("dashboards")}
            aria-current={ui.view === "dashboards" || ui.view === "reports" ? "page" : undefined}
            className={(`${navItem} ${ui.view === "dashboards" || ui.view === "reports" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
          >
            <IcDashboard size={18} tone="violet" />
            <span className="flex-1 truncate">{t("sidebar.nav.dashboards")}</span>
          </Button>
        </div>
      </div>

      {/* «Начало работы» (ТЗ 5.11) — тем, у кого нет главной (один проект): свёрнутая строка с прогрессом. */}
      {!home && data.projects.length < 2 && !collapsed && <GettingStarted compact className="mx-3 mb-2" />}

      {/* Справка остаётся внизу панели; профиль и настройки — в общей шапке. */}
      <div className="sidebar-dock mx-2 mb-2 flex flex-col gap-1 border-t border-linesoft/70 pt-2">
        <Button variant="ghost" size="sm"
          type="button"
          onClick={() => setView("docs")}
          aria-current={ui.view === "docs" ? "page" : undefined}
          className={(`${navItem} ${ui.view === "docs" ? navOn : navOff}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
        >
          <IcBook size={18} tone="orange" />
          <span className="flex-1 truncate">{t("sidebar.nav.docs")}</span>
          <span className="text-faint">
            <Kbd>?</Kbd>
          </span>
        </Button>
        {wide && <Button variant="ghost" size="sm" data-sidebar-toggle className={navItem} onClick={() => changeCollapsed(true)} iconLeft={<IcPanel size={18} />} kbd="[">{t("sidebar.collapse")}</Button>}
      </div>
      {wide && <SidebarResizeHandle onCollapse={() => changeCollapsed(true)} />}
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
  const { data, ui: storedUi, setView: storeSetView, goHome, enterProject, bootStatus } = useStore();
  const home = bootStatus === "home";
  const ui = home ? { ...storedUi, view: undefined } : storedUi;
  const setView: typeof storeSetView = (view, section) => {
    storeSetView(view, section);
    if (home) enterProject(data.currentProjectId || data.projects[0]?.id);
  };
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
    <aside aria-label={t("sidebar.menu")} className={`${className} sidebar-rail items-center py-2.5`}>
      {btn("logo", homeAvailable ? t("sidebar.homeAria") : brandName, <BrandMark size={22} />, () => homeAvailable && goHome())}
      {sep}
      <div className="flex flex-col items-center gap-1">
        {homeAvailable && btn("home", t("sidebar.nav.home"), <IcHome size={18} tone="violet" />, goHome, home)}
        {PERSONAL_VIEWS.map((v) =>
          btn(v.id, t(v.labelKey), v.icon({ size: 16, tone: v.tone }), () => setView(v.id), !home && ui.view === v.id,
            v.id === "inbox" && unread > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] ring-2 ring-[var(--bg-frame)]" /> : undefined,
          ),
        )}
        {data.collaborations.length > 0 &&
          btn("collab", t("sidebar.nav.collaborating"), <IcLink size={18} tone="violet" />, () => setView("collaborating"), ui.view === "collaborating")}
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
        {btn("roadmap", t("sidebar.nav.roadmap"), <IcFlag size={18} tone="teal" />, () => setView("roadmap"), ui.view === "roadmap")}
        {btn("dashboards", t("sidebar.nav.dashboards"), <IcDashboard size={18} tone="violet" />, () => setView("dashboards"), ui.view === "dashboards" || ui.view === "reports")}
      </div>
      <div className="sidebar-dock mt-1 flex flex-col items-center gap-1 border-t border-linesoft/70 pt-2">
        {btn("docs", t("sidebar.nav.docs"), <IcBook size={18} tone="orange" />, () => setView("docs"), ui.view === "docs")}
        <IconButton variant="ghost" size="sm" data-sidebar-toggle label={t("sidebar.expand")} kbd="[" className="h-9 w-9 shrink-0" onClick={onExpand}><IcPanel size={18} /></IconButton>
      </div>
    </aside>
  );
}
