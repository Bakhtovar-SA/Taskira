import { useEffect } from "react";
import { StoreProvider, useStore } from "./store";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Board from "./components/Board";
import Backlog from "./components/Backlog";
import TimelineView from "./components/TimelineView";
import WorkflowView from "./components/WorkflowView";
import PermissionsView from "./components/PermissionsView";
import AdminView from "./components/AdminView";
import DocsView from "./components/DocsView";
import CollaboratingView from "./components/CollaboratingView";
import IssueModal from "./components/IssueModal";
import CreateIssueModal from "./components/CreateIssueModal";
import LoginForm from "./components/LoginForm";
import SoloView from "./components/SoloView";
import HomeView from "./components/HomeView";
import { SkeletonColumn, Toasts } from "./ui";
import type { ViewId } from "./types";

/** Скелет оболочки на время bootstrap — вместо голого «Загрузка…» (round4 §1). */
function BootSkeleton() {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="hidden w-[240px] shrink-0 flex-col gap-3 bg-sidebar p-4 md:flex">
        <div className="skeleton h-8 w-32 opacity-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-6 w-full opacity-30" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-panel px-6 py-4">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton ml-auto h-8 w-32" />
        </div>
        <div className="dotgrid flex flex-1 items-start gap-3.5 overflow-hidden px-6 py-4">
          <SkeletonColumn cards={3} />
          <SkeletonColumn cards={2} />
          <SkeletonColumn cards={4} />
          <SkeletonColumn cards={1} />
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { ui, setView, setCreateOpen, openIssue, can, toast, bootStatus, bootstrap, logout } = useStore();

  /* При старте: есть токен → bootstrap; нет → unauthenticated (форма входа).
     Раньше при отсутствии токена bootStatus оставался idle → вечная «Загрузка». */
  useEffect(() => {
    if (bootStatus === "idle") void bootstrap();
  }, [bootStatus, bootstrap]);

  useEffect(() => {
    if (bootStatus !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if (e.key === "Escape") {
        if (!typing) {
          setCreateOpen(false);
          openIssue(null);
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "с") {
        e.preventDefault();
        if (can("create")) setCreateOpen(true);
        else toast("error", "Ваша роль не позволяет создавать задачи");
        return;
      }
      const map: Record<string, ViewId> = {
        "1": "board",
        "2": "backlog",
        "3": "timeline",
        "4": "workflow",
        "5": "access",
        "6": "admin",
        "7": "docs",
        "8": "collaborating",
      };
      if (map[e.key]) setView(map[e.key]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bootStatus, setView, setCreateOpen, openIssue, can, toast]);

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
  if (bootStatus === "solo") return <SoloView onLogout={logout} />;

  // ≥ 2 доступных проектов, до выбора проекта — главный экран (UI_RESTRUCTURE.md D4).
  if (bootStatus === "home") return <HomeView onLogout={logout} />;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onLogout={logout} />
        <main className="min-h-0 flex-1 bg-canvas">
          <div key={ui.view} className="anim-fadeup h-full">
            {ui.view === "board" && <Board />}
            {ui.view === "backlog" && <Backlog />}
            {ui.view === "timeline" && <TimelineView />}
            {ui.view === "workflow" && <WorkflowView />}
            {ui.view === "access" && <PermissionsView />}
            {ui.view === "admin" && <AdminView />}
            {ui.view === "docs" && <DocsView />}
            {ui.view === "collaborating" && <CollaboratingView />}
          </div>
        </main>
      </div>

      {ui.selectedIssueId && <IssueModal />}
      {ui.createOpen && <CreateIssueModal />}
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
