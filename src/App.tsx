import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { loadOnboarding, markThemeStep, resetOnboarding } from "./onboarding";
import { setupApi } from "./api";
import { onThemeChosen, setProjectBackground } from "./theme";
import { StoreProvider, useStore } from "./store";
import { useRouterSync } from "./useRouterSync";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Board from "./components/Board";
import LoginForm from "./components/LoginForm";
import ErrorBoundary from "./components/ErrorBoundary";
import { BootErrorScreen, NotFoundPage, OfflineBanner } from "./components/StatusScreens";
import { Toasts } from "./ui";
import type { ViewId } from "./types";
import { useT } from "./i18n";
import { CreateIssueModal, IssueModal, preloadModalsWhenIdle } from "./lazyModals";
import { Presence } from "./ds/Presence";
import { OPEN_PALETTE_EVT, OPEN_PROJECT_WIZARD_EVT, OPEN_SHORTCUTS_EVT, openHomeCreate } from "./palette/events";
import { markHomeStep } from "./homeSteps";
import { isSettingsHome } from "./settings/sections";
import { useOpenSettings } from "./settings/useOpenSettings";
import { pushRecent } from "./palette/recent";

// Рабочие разделы и тяжёлые модалки загружаются по требованию: первый экран
// больше не тянет отчёты, документацию и админку одним монолитным бандлом.
const Backlog = lazy(() => import("./components/Backlog"));
const SprintsView = lazy(() => import("./components/SprintsView"));
const TimelineView = lazy(() => import("./components/TimelineView"));
const CalendarView = lazy(() => import("./components/CalendarView"));
const ReportsView = lazy(() => import("./components/ReportsView"));
const RoadmapView = lazy(() => import("./components/RoadmapView"));
const DashboardView = lazy(() => import("./components/DashboardView"));
// Три дома настроек (ТЗ 5.9): «Процесс», «Доступ», «Отделы и проекты» и новые страницы — внутри.
const SettingsView = lazy(() => import("./components/settings/SettingsView"));
// Мастер создания проекта (ТЗ 5.10) — свой чанк, только для администраторов.
const ProjectWizard = lazy(() => import("./components/ProjectWizard"));
const DocsView = lazy(() => import("./components/DocsView"));
const CollaboratingView = lazy(() => import("./components/CollaboratingView"));
const InboxView = lazy(() => import("./components/InboxView"));
const MyIssuesView = lazy(() => import("./components/MyIssuesView"));
// IssueModal / CreateIssueModal — тоже ленивые, но с предзагрузкой в простое и при наведении на карточку
// (src/lazyModals.ts): первое открытие задачи не ждёт чанк.
const SoloView = lazy(() => import("./components/SoloView"));
const HomeView = lazy(() => import("./components/HomeView"));
// Командная палитра и справка «?» — один чанк, грузится при первом открытии (ТЗ 5.8 п.4–5).
const CommandPalette = lazy(() => import("./components/CommandPalette"));
const ShortcutsDialog = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.ShortcutsDialog })));

/** Скелет оболочки на время bootstrap — форма боковой панели и шапки, а не
 *  доски (ТЗ 5.8 п.7): до загрузки неизвестно, какой раздел откроется. */
function BootSkeleton() {
  return (
    <div className="flex h-full overflow-hidden" aria-busy="true">
      <div className="glass-side glass-edge my-2 ml-2 hidden w-[248px] shrink-0 flex-col gap-2 rounded-xl px-4 pt-5 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="skeleton h-[26px] w-[26px] rounded-lg" />
          <div className="skeleton h-4 w-20" />
        </div>
        <div className="mt-5 flex items-center gap-2.5">
          <div className="skeleton h-7 w-7 rounded-md" />
          <div className="skeleton h-3.5 w-32" />
        </div>
        <div className="mt-6 space-y-2.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-5" style={{ width: `${[78, 64, 70, 58, 74, 66, 60][i]}%` }} />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col md:p-2">
        <div className="glass-sheet glass-edge flex min-h-0 flex-1 flex-col overflow-hidden shadow-e2 md:rounded-xl">
          <div className="flex h-[52px] items-center gap-3 border-b border-linesoft px-5">
            <div className="skeleton h-4 w-44" />
            <div className="skeleton ml-auto h-8 w-56 rounded-lg" />
            <div className="skeleton h-8 w-24 rounded-lg" />
          </div>
          <div className="flex-1 space-y-3 px-6 py-6">
            <div className="skeleton h-6 w-40" />
            <div className="skeleton h-4 w-64" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { t } = useT();
  const { ui, idx, data, me, setView, setCreateOpen, openIssue, can, toast, bootStatus, bootstrap, logout, goHome } = useStore();
  const gPending = useRef(0);
  const openSettings = useOpenSettings();
  const openProjectSettings = () => openSettings("projectSettings");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVT, open);
  }, []);
  useEffect(() => { if (helpOpen) markHomeStep(me.id, "shortcuts"); }, [helpOpen, me.id]);

  useEffect(() => {
    const open = () => setPaletteOpen(true);
    window.addEventListener(OPEN_PALETTE_EVT, open);
    return () => window.removeEventListener(OPEN_PALETTE_EVT, open);
  }, []);
  const [wizard, setWizard] = useState<{ departmentId?: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setWizard({ departmentId: (e as CustomEvent<{ departmentId?: string }>).detail?.departmentId });
    window.addEventListener(OPEN_PROJECT_WIZARD_EVT, open);
    return () => window.removeEventListener(OPEN_PROJECT_WIZARD_EVT, open);
  }, []);

  // Фон проекта (ТЗ 5.10): пока открыт проект со своим фоном, он перекрывает личный; на главной — личный.
  const projectBg = bootStatus === "ready" ? (data.projects.find((p) => p.id === data.currentProjectId)?.background ?? null) : null;
  useEffect(() => setProjectBackground(projectBg), [projectBg]);
  // Онбординг (ТЗ 5.11): прогресс «Начала работы» и подсказки — после входа; выход — забыть.
  const signedIn = bootStatus === "ready" || bootStatus === "home" || bootStatus === "solo";
  useEffect(() => {
    if (!signedIn) return resetOnboarding();
    loadOnboarding();
    onThemeChosen(markThemeStep);
    return () => onThemeChosen(null);
  }, [signedIn]);
  // Первый вход администратора после установки — в «Начальную настройку», один раз за сессию.
  const isAdmin = me.globalRole === "admin";
  useEffect(() => {
    if (bootStatus !== "ready" || !isAdmin) return;
    try {
      if (sessionStorage.getItem("taskira.setupPrompted")) return;
      sessionStorage.setItem("taskira.setupPrompted", "1");
    } catch {
      /* приватный режим — спросим снова в следующий раз, это не страшно */
    }
    setupApi.get().then((s) => !s.completed && setView("orgSettings", "setup"), () => undefined);
  }, [bootStatus, isAdmin, setView]);

  // «Недавние задачи» палитры: каждая открытая карточка (из любого места).
  const openedIssue = ui.selectedIssueId ? idx.issues.get(ui.selectedIssueId) : undefined;
  useEffect(() => {
    if (!openedIssue) return;
    pushRecent({
      id: openedIssue.id,
      projectId: data.currentProjectId,
      key: openedIssue.key,
      title: openedIssue.title,
      category: idx.statuses.get(openedIssue.statusId)?.category ?? "todo",
    });
  }, [openedIssue, idx.statuses, data.currentProjectId]);

  /* При старте всегда проверяем серверную HttpOnly-сессию. Если её нет или она
     отозвана, bootstrap переводит приложение на форму входа. Путь, с которого
     стартовали (в т.ч. прямая ссылка на задачу), остаётся в адресной строке как
     есть — LoginForm ничего с ним не делает, и после успешного входа повторный
     bootstrap() разбирает его заново (ТЗ 3.1: логин сохраняет целевой URL). */
  useEffect(() => {
    if (bootStatus === "idle") void bootstrap();
  }, [bootStatus, bootstrap]);

  // ТЗ 3.1: URL ↔ состояние в обе стороны — см. useRouterSync.ts. Должен идти
  // после bootstrap() выше (реагирует на bootStatus/данные, которые тот выставляет),
  // но порядок вызовов хуков это не меняет — оба всегда выполняются на каждом рендере.
  useRouterSync();

  // Полная страница задачи — не модалка: цифры и G-переходы уводят с неё, как с любого экрана.
  const issuePage = !!ui.selectedIssueId && ui.issueMode === "page";
  const modalOpen = (!!ui.selectedIssueId && !issuePage) || ui.createOpen || paletteOpen || helpOpen || !!wizard;

  // Чанки модалок — в простое после входа, не на критическом пути первого экрана (PERF-BUDGET п. 3).
  useEffect(() => {
    if (bootStatus !== "ready") return;
    return preloadModalsWhenIdle();
  }, [bootStatus]);

  useEffect(() => {
    if (bootStatus !== "ready" && bootStatus !== "home") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      // ⌘K / Ctrl+K — палитра откуда угодно, даже из поля ввода и поверх карточки.
      // По e.code, а не e.key: в русской раскладке это «л».
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        setHelpOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }
      if (paletteOpen || helpOpen) return; // Esc и остальное у открытого диалога свои
      if (e.key === "Escape") {
        // Esc, уже обработанный внутри (закрыть меню или всплывающее окно поверх карточки, отменить правку), карточку не
        // закрывает: иначе Esc в меню статуса закрывал всю панель.
        if (!typing && !e.defaultPrevented) {
          setCreateOpen(false);
          openIssue(null);
        }
        return;
      }
      // При открытой модалке цифры и «C» не должны переключать вид под ней:
      // человек закрывал карточку и оказывался не там, где был (аудит BUG-04).
      if (modalOpen) return;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (bootStatus === "home") {
        if (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "с") { e.preventDefault(); openHomeCreate(); }
        return;
      }
      if (e.key === "/" || e.code === "Slash") {
        const filter = document.querySelector<HTMLInputElement>("main .workspace-search input");
        if (filter) { e.preventDefault(); filter.focus(); return; }
      }
      if (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "с") {
        e.preventDefault();
        if (can("create")) setCreateOpen(true);
        else toast("error", t("topbar.createDeniedTip"));
        return;
      }
      // ADR-0013 §7: цифры — только представления проекта (раньше 1–9 открывали и
      // настройки, и скрытые экраны-отказы); переходы — «G, затем буква» (как в Linear).
      const k = e.key.toLowerCase();
      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        const go: Record<string, () => void> = {
          h: () => data.projects.length > 0 && goHome(),
          р: () => data.projects.length > 0 && goHome(),
          i: () => setView("inbox"),
          ш: () => setView("inbox"),
          m: () => setView("my"),
          ь: () => setView("my"),
          r: () => setView("reports"),
          к: () => setView("reports"),
          d: () => setView("dashboards"),
          в: () => setView("dashboards"),
          o: () => setView("overview"),
          щ: () => setView("overview"),
          s: openProjectSettings,
          ы: openProjectSettings,
        };
        if (go[k]) {
          e.preventDefault();
          go[k]();
        }
        return;
      }
      if (k === "g" || k === "п") {
        gPending.current = Date.now();
        return;
      }
      const map: Record<string, ViewId> = { "1": "board", "2": "backlog", "3": "timeline", "5": "calendar" };
      if (data.project.sprintsEnabled) map["4"] = "sprints";
      if (map[e.key]) setView(map[e.key]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bootStatus, setView, setCreateOpen, openIssue, can, toast, modalOpen, paletteOpen, helpOpen, t, data.projects.length, data.project.sprintsEnabled, goHome, openSettings]);

  const overlays = <>
      <Suspense fallback={null}>
        <Presence show={!!ui.selectedIssueId && !issuePage}>{(open) => <IssueModal open={open} />}</Presence>
        <Presence show={ui.createOpen}>{(open) => <CreateIssueModal open={open} />}</Presence>
        <Presence show={paletteOpen}>
          {(open) => <CommandPalette open={open} onClose={() => setPaletteOpen(false)} onShortcuts={() => setHelpOpen(true)} />}
        </Presence>
        <Presence show={helpOpen}>{(open) => <ShortcutsDialog open={open} onClose={() => setHelpOpen(false)} />}</Presence>
        {wizard && <ProjectWizard departmentId={wizard.departmentId} onClose={() => setWizard(null)} />}
      </Suspense>
      <Toasts />
  </>;

  if (bootStatus === "loading" || bootStatus === "idle") {
    return <BootSkeleton />;
  }

  // Загрузка не удалась (сервер недоступен, нет сети) — не форма входа: сессия, скорее всего, цела.
  if (bootStatus === "error") return <BootErrorScreen onRetry={() => void bootstrap()} onLogout={logout} />;

  if (bootStatus === "unauthenticated") {
    return (
      <LoginForm
        onSuccess={() => {
          void bootstrap();
        }}
      />
    );
  }

  // Приглашённый без единого видимого проекта — одиночный режим (COLLAB_MIGRATION.md Фаза 6).
  if (bootStatus === "solo") return <Suspense fallback={<BootSkeleton />}><SoloView onLogout={logout} /></Suspense>;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {/* Рабочая область — «лист», вставленный справа от боковой панели:
          своя поверхность, скругление и мягкая тень поверх атмосферы. */}
      <div className="flex min-w-0 flex-1 flex-col md:p-2">
       <div className="glass-sheet glass-edge flex min-h-0 flex-1 flex-col overflow-hidden shadow-e2 md:rounded-xl">
        {bootStatus !== "home" && (issuePage || ui.missing || !["reports", "dashboards"].includes(ui.view)) && <Topbar />}
        <OfflineBanner />
        <main className="min-h-0 flex-1">
          {/* Граница вокруг контента, а не всего приложения: сайдбар и шапка
              переживают падение раздела, и из него можно уйти. */}
          <ErrorBoundary resetKey={bootStatus === "home" ? "home" : issuePage ? `issue:${ui.selectedIssueId}` : ui.view} copy={{
            title: t("errorBoundary.title"),
            body: t("errorBoundary.body"),
            retry: t("errorBoundary.retry"),
            reload: t("errorBoundary.reload"),
            details: t("errorBoundary.details"),
          }}>
          <Suspense fallback={<BootSkeleton />}>{bootStatus === "home" ? <HomeView /> : ui.missing ? (
            <NotFoundPage path={ui.missing} onHome={() => (data.projects.length >= 2 ? goHome() : setView("board"))} onBack={() => history.back()} />
          ) : issuePage ? (
            <div key="issue-page" className="h-full"><IssueModal mode="page" /></div>
          ) : (<div key={ui.view} className="anim-fadeup h-full">
            {ui.view === "overview" && <DashboardView mode="project" />}
            {ui.view === "board" && <Board key={data.currentProjectId} />}
            {ui.view === "backlog" && <Backlog key={data.currentProjectId} />}
            {ui.view === "sprints" && <SprintsView />}
            {ui.view === "timeline" && <TimelineView />}
            {ui.view === "calendar" && <CalendarView />}
            {ui.view === "reports" && <ReportsView />}
            {ui.view === "roadmap" && <RoadmapView />}
            {ui.view === "dashboards" && <DashboardView mode="org" />}
            {isSettingsHome(ui.view) && <SettingsView />}
            {ui.view === "docs" && <DocsView />}
            {ui.view === "collaborating" && <CollaboratingView />}
            {ui.view === "inbox" && <InboxView />}
            {ui.view === "my" && <MyIssuesView />}
          </div>)}</Suspense>
          </ErrorBoundary>
        </main>
       </div>
      </div>

      {overlays}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
