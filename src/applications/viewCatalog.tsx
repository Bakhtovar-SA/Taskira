import type { ViewId } from "../types";
import {
  IcBacklog, IcBoard, IcBook, IcBriefcase, IcFlag, IcFlow, IcInbox, IcLink,
  IcMyIssues, IcReport, IcDashboard, IcTimeline, IcCalendar, IcUsers, type IconTone,
} from "../icons";
import type { TKey } from "../i18n";

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
  { id: "documents", labelKey: "workspace.documents", icon: (p) => <IcBook {...p} />, tone: "orange" },
  { id: "objects", labelKey: "workspace.objects", icon: (p) => <IcBriefcase {...p} />, tone: "teal" },
  { id: "processes", labelKey: "workspace.processes", icon: (p) => <IcFlow {...p} />, tone: "blue" },
  { id: "planning", labelKey: "workspace.planning", icon: (p) => <IcTimeline {...p} />, tone: "sky" },
  { id: "files", labelKey: "workspace.files", icon: (p) => <IcLink {...p} />, tone: "teal" },
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
  { id: "library", labelKey: "workspace.library", icon: (p) => <IcBook {...p} />, tone: "orange" },
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
