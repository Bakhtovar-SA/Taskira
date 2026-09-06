import { useCallback, useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Board from "./components/Board";
import Backlog from "./components/Backlog";
import TimelineView from "./components/TimelineView";
import WorkflowView from "./components/WorkflowView";
import PermissionsView from "./components/PermissionsView";
import DocsView from "./components/DocsView";
import IssueModal from "./components/IssueModal";
import CreateIssueModal from "./components/CreateIssueModal";
import LoginForm from "./components/LoginForm";
import { Toasts } from "./ui";
import type { ViewId } from "./types";
import { clearToken, getToken } from "./api";

function Shell() {
  const { ui, setView, setCreateOpen, openIssue, can, toast, bootStatus, bootstrap, logout } = useStore();

  useEffect(() => {
    if (getToken() && bootStatus === "idle") void bootstrap();
  }, [bootStatus, bootstrap]);

  useEffect(() => {
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
      const map: Record<string, ViewId> = { "1": "board", "2": "backlog", "3": "timeline", "4": "workflow", "5": "access", "6": "docs" };
      if (map[e.key]) setView(map[e.key]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setView, setCreateOpen, openIssue, can, toast]);

  if (bootStatus === "loading" || bootStatus === "idle") {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-canvas text-[14px] text-faint">
        Загрузка Taskira…
      </div>
    );
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
            {ui.view === "docs" && <DocsView />}
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

// re-export for accidental imports
void clearToken;
