import { lazy, Suspense, useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { useRouterSync } from "./useRouterSync";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Board from "./components/Board";
import LoginForm from "./components/LoginForm";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toasts } from "./ui";
import type { ViewId } from "./types";
import { useT } from "./i18n";
import { CreateIssueModal, IssueModal, preloadModalsWhenIdle } from "./lazyModals";
import { OPEN_PALETTE_EVT } from "./palette/events";
import { pushRecent } from "./palette/recent";

// Рабочие разделы и тяжёлые модалки загружаются по требованию: первый экран
// больше не тянет отчёты, документацию и админку одним монолитным бандлом.
const Backlog = lazy(() => import("./components/Backlog"));
const SprintsView = lazy(() => import("./components/SprintsView"));
const TimelineView = lazy(() => import("./components/TimelineView"));
const ReportsView = lazy(() => import("./components/ReportsView"));
const WorkflowView = lazy(() => import("./components/WorkflowView"));
const PermissionsView = lazy(() => import("./components/PermissionsView"));
const AdminView = lazy(() => import("./components/AdminView"));
const DocsView = lazy(() => import("./components/DocsView"));
const CollaboratingView = lazy(() => import("./components/CollaboratingView"));
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
      <div className="glass-side glass-edge my-2 ml-2 hidden w-[248px] shrink-0 flex-col gap-2 rounded-xl px-4 pt-5 md:flex">
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
  const { ui, idx, data, setView, setCreateOpen, openIssue, can, toast, bootStatus, bootstrap, logout } = useStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const open = () => setPaletteOpen(true);
    window.addEventListener(OPEN_PALETTE_EVT, open);
    return () => window.removeEventListener(OPEN_PALETTE_EVT, open);
  }, []);

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

  const modalOpen = !!ui.selectedIssueId || ui.createOpen || paletteOpen || helpOpen;

  // Чанки модалок — в простое после входа, не на критическом пути первого экрана (PERF-BUDGET п. 3).
  useEffect(() => {
    if (bootStatus !== "ready") return;
    return preloadModalsWhenIdle();
  }, [bootStatus]);

  useEffect(() => {
    if (bootStatus !== "ready") return;
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
        if (!typing) {
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
      if (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "с") {
        e.preventDefault();
        if (can("create")) setCreateOpen(true);
        else toast("error", t("topbar.createDeniedTip"));
        return;
      }
      const map: Record<string, ViewId> = {
        "1": "board",
        "2": "backlog",
        "3": "timeline",
        "4": "reports",
        "5": "workflow",
        "6": "access",
        "7": "admin",
        "8": "docs",
        "9": "collaborating",
      };
      if (map[e.key]) setView(map[e.key]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bootStatus, setView, setCreateOpen, openIssue, can, toast, modalOpen, paletteOpen, helpOpen, t]);

  if (bootStatus === "loading" || bootStatus === "idle") {
    return <BootSkeleton />;
  }

  if (bootStatus === "unauthenticated" || bootStatus === "error") {
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

  // ≥ 2 доступных проектов, до выбора проекта — главный экран (UI_RESTRUCTURE.md D4).
  if (bootStatus === "home") return <Suspense fallback={<BootSkeleton />}><HomeView onLogout={logout} /></Suspense>;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {/* Рабочая область — «лист», вставленный справа от боковой панели:
          своя поверхность, скругление и мягкая тень поверх атмосферы. */}
      <div className="flex min-w-0 flex-1 flex-col md:p-2">
       <div className="glass-sheet glass-edge flex min-h-0 flex-1 flex-col overflow-hidden shadow-e2 md:rounded-xl">
        <Topbar onLogout={logout} />
        <main className="min-h-0 flex-1">
          {/* Граница вокруг контента, а не всего приложения: сайдбар и шапка
              переживают падение раздела, и из него можно уйти. */}
          <ErrorBoundary resetKey={ui.view} copy={{
            title: t("errorBoundary.title"),
            body: t("errorBoundary.body"),
            retry: t("errorBoundary.retry"),
            reload: t("errorBoundary.reload"),
          }}>
          <Suspense fallback={<BootSkeleton />}><div key={ui.view} className="anim-fadeup h-full">
            {ui.view === "board" && <Board />}
            {ui.view === "backlog" && <Backlog />}
            {ui.view === "sprints" && <SprintsView />}
            {ui.view === "timeline" && <TimelineView />}
            {ui.view === "reports" && <ReportsView />}
            {ui.view === "workflow" && <WorkflowView />}
            {ui.view === "access" && <PermissionsView />}
            {ui.view === "admin" && <AdminView />}
            {ui.view === "docs" && <DocsView />}
            {ui.view === "collaborating" && <CollaboratingView />}
          </div></Suspense>
          </ErrorBoundary>
        </main>
       </div>
      </div>

      <Suspense fallback={null}>
        {ui.selectedIssueId && <IssueModal />}
        {ui.createOpen && <CreateIssueModal />}
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onShortcuts={() => setHelpOpen(true)}
          />
        )}
        {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      </Suspense>
      <Toasts />
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
