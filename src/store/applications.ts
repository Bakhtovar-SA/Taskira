import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applicationsApi } from "../api/applications";
import type { ApplicationId, ApplicationsDto } from "../../server/src/applicationContract";
import type { Data, ViewId } from "../types";
import type { BootStatus, IssueMode, UIState } from "./mappers";
import type { PermId } from "../permissions";
import { applicationForView, defaultApplicationView, projectAvailable } from "../applications/navigation";
import { isApplication, readApplicationPreferences, rememberApplication } from "./applicationPreferences";
import { parsePath } from "../router";
import { viewTransition } from "../motion";
import { useLocation } from "wouter";
import { pathForView } from "../router";

const permissionApps: Partial<Record<PermId, ApplicationId>> = {
  create: "work", edit: "work", transition: "work", delete: "work", comment: "work",
  editWorkflow: "work", manageCollaborators: "work", manageSprints: "work", manageRecurring: "work",
  editRoadmap: "work", manageDashboards: "work", manageProcesses: "work", managePlans: "work",
  writeDocuments: "knowledge", manageDocuments: "knowledge", writeObjects: "objects",
};
export function applicationAllows(perm: PermId, catalog: ApplicationsDto | null): boolean {
  const app = permissionApps[perm];
  return !app || !catalog || catalog.applications.some((item) => item.id === app && item.enabled);
}

type Deps = {
  data: Data; ui: UIState; bootStatus: BootStatus;
  setUi: Dispatch<SetStateAction<UIState>>;
  setBootStatus: Dispatch<SetStateAction<BootStatus>>;
  sessionEpochRef: MutableRefObject<number>;
  switchProject: (id: string, issueId?: string, mode?: IssueMode) => void;
  enterProject: (id: string) => void;
  goHome: () => void;
  openIssue: (id: string | null, mode?: IssueMode) => void;
};
function appAtPath(path: string): ApplicationId | null {
  const parsed = parsePath(path);
  if (parsed.kind === "issue") return "work";
  if (parsed.kind === "root") return null;
  if (parsed.view === "applicationHome" && isApplication(parsed.section)) return parsed.section;
  return applicationForView(parsed.view);
}
function validCatalog(value: ApplicationsDto): boolean {
  return Number.isInteger(value?.revision) && Array.isArray(value.applications) &&
    value.applications.length === 3 && new Set(value.applications.map((a) => a.id)).size === 3 &&
    value.applications.every((a) => isApplication(a.id) && typeof a.enabled === "boolean" &&
      Array.isArray(a.projectIds) && a.projectIds.every((id) => typeof id === "string"));
}

export function useApplicationState(deps: Deps) {
  const [, navigate] = useLocation();
  const current = useRef(deps); current.current = deps;
  const [application, setApplication] = useState<ApplicationId>(() => appAtPath(location.pathname) ?? "work");
  const active = useRef(application); active.current = application;
  const [snapshot, setSnapshot] = useState<{ owner: string; catalog: ApplicationsDto | null; error: string | null }>({ owner: "", catalog: null, error: null });
  const catalog = useRef<ApplicationsDto | null>(null); catalog.current = snapshot.owner === deps.data.currentUserId ? snapshot.catalog : null;
  const owner = useRef("");
  const initialPath = useRef(location.pathname);
  if (owner.current !== deps.data.currentUserId) {
    owner.current = deps.data.currentUserId;
    initialPath.current = location.pathname;
  }
  const request = useRef(0);
  const prepared = useRef("");
  const move = useCallback((app: ApplicationId, restore: boolean, initial = false) => {
    const { data, setUi, setBootStatus, switchProject } = current.current;
    const prefs = readApplicationPreferences(data.currentUserId);
    const saved = restore ? prefs.projects[app] : undefined;
    const available = data.projects.filter((p) => projectAvailable(app, p.id, catalog.current));
    const project = available.find((p) => p.id === saved?.projectId) ?? available.find((p) => p.id === data.currentProjectId) ?? available[0];
    setApplication(app); active.current = app;
    rememberApplication(data.currentUserId, app);
    setUi((ui) => ({ ...ui, view: project ? saved?.view ?? defaultApplicationView(app) : "applicationHome", section: project ? "" : app,
      selectedIssueId: null, issueMode: "panel", createOpen: false, missing: null }));
    if (project) {
      if (project.id === data.currentProjectId) setBootStatus("ready");
      else switchProject(project.id);
    } else setBootStatus("home");
    if (initial) navigate(pathForView(project?.key ?? "", project ? saved?.view ?? defaultApplicationView(app) : "applicationHome", project ? "" : app), { replace: true });
  }, [navigate]);
  const refreshApplications = useCallback(async () => {
    const user = current.current.data.currentUserId;
    if (!user) return;
    const epoch = current.current.sessionEpochRef.current;
    const sequence = ++request.current;
    try {
      const result = await applicationsApi.get();
      if (!validCatalog(result)) throw new Error("Application catalogue unavailable");
      if (sequence !== request.current || epoch !== current.current.sessionEpochRef.current || user !== current.current.data.currentUserId) return;
      catalog.current = result;
      if (prepared.current !== user) {
        prepared.current = user;
        const path = initialPath.current;
        const explicit = appAtPath(path);
        const prefs = readApplicationPreferences(user);
        const preferred = explicit ?? prefs.lastApplication ?? "work";
        const enabled = result.applications.filter((a) => a.enabled);
        const chosen = enabled.find((a) => a.id === preferred) ?? enabled.find((a) => a.projectIds.length) ?? enabled[0];
        if (current.current.bootStatus === "solo") { setApplication("work"); active.current = "work"; }
        else if (explicit) { setApplication(explicit); active.current = explicit; }
        else if (parsePath(path).kind === "root" && chosen && (chosen.id !== "work" || !!prefs.projects.work)) move(chosen.id, true, true);
        else { setApplication(chosen?.id ?? "work"); active.current = chosen?.id ?? "work"; }
      }
      setSnapshot({ owner: user, catalog: result, error: null });
    } catch (error) {
      if (sequence !== request.current || epoch !== current.current.sessionEpochRef.current || user !== current.current.data.currentUserId) return;
      prepared.current = user;
      setSnapshot({ owner: user, catalog: null, error: error instanceof Error ? error.message : "Application catalogue unavailable" });
    }
  }, [move]);
  const signedIn = ["ready", "home", "solo"].includes(deps.bootStatus);
  useEffect(() => {
    if (!deps.data.currentUserId || !signedIn) return;
    void refreshApplications();
  }, [deps.data.currentUserId, signedIn, refreshApplications]);
  useEffect(() => {
    const changed = () => { if (current.current.data.currentUserId && ["ready", "home", "solo"].includes(current.current.bootStatus)) void refreshApplications(); };
    const clear = () => { request.current++; prepared.current = ""; catalog.current = null; setSnapshot({ owner: "", catalog: null, error: null }); };
    const timer = setInterval(changed, 60000);
    window.addEventListener("taskira:applications", changed);
    window.addEventListener("taskira:workspace-modules", changed);
    window.addEventListener("focus", changed);
    window.addEventListener("taskira:session-cleared", clear);
    return () => { clearInterval(timer); window.removeEventListener("taskira:applications", changed); window.removeEventListener("taskira:workspace-modules", changed); window.removeEventListener("focus", changed); window.removeEventListener("taskira:session-cleared", clear); };
  }, [refreshApplications]);
  useEffect(() => {
    if (!signedIn || snapshot.owner !== deps.data.currentUserId) return;
    const explicit = deps.ui.selectedIssueId && deps.ui.issueMode === "page" ? "work" : deps.ui.view === "applicationHome" && isApplication(deps.ui.section) ? deps.ui.section : applicationForView(deps.ui.view);
    if (explicit && deps.bootStatus === "ready") { setApplication(explicit); active.current = explicit; }
    const app = deps.bootStatus === "home" ? active.current : explicit ?? active.current;
    if (!deps.ui.missing) rememberApplication(deps.data.currentUserId, app, deps.bootStatus === "ready" ? deps.data.currentProjectId : undefined, deps.ui.view);
  }, [deps.data.currentUserId, deps.data.currentProjectId, deps.ui.view, deps.ui.section, deps.ui.missing, deps.ui.selectedIssueId, deps.ui.issueMode, deps.bootStatus, signedIn, snapshot.owner]);
  const selectApplication = useCallback(async (app: ApplicationId) => {
    if (!catalog.current?.applications.some((a) => a.id === app && a.enabled)) return;
    move(app, true);
  }, [move]);
  const setView = useCallback((view: ViewId, section = "") => {
    const app = view === "applicationHome" && isApplication(section) ? section : applicationForView(view);
    if (app) { setApplication(app); active.current = app; }
    if (view === "applicationHome") current.current.setBootStatus("home");
    return viewTransition(() => current.current.setUi((ui) => ({ ...ui, view, section, missing: null,
      ...(ui.selectedIssueId && ui.issueMode === "page" || view === "applicationHome" ? { selectedIssueId: null, issueMode: "panel" as const } : {}) })));
  }, []);
  const goHome = useCallback(() => {
    if (active.current === "work") current.current.goHome();
    else void setView("applicationHome", active.current);
  }, [setView]);
  const enterProject = useCallback((id: string) => {
    const view = current.current.ui.view;
    if (view === "applicationHome" || (active.current !== "work" && applicationForView(view) === "work")) void setView(defaultApplicationView(active.current));
    current.current.enterProject(id);
  }, [setView]);
  const switchProject = useCallback((id: string, issueId?: string, mode?: IssueMode) => {
    if (issueId) { setApplication("work"); active.current = "work"; }
    else if (current.current.ui.view === "applicationHome" || (active.current !== "work" && applicationForView(current.current.ui.view) === "work")) void setView(defaultApplicationView(active.current));
    current.current.switchProject(id, issueId, mode);
  }, [setView]);
  const openIssue = useCallback((id: string | null, mode?: IssueMode) => {
    if (id && mode === "page") { setApplication("work"); active.current = "work"; }
    current.current.openIssue(id, mode);
  }, []);
  return { application, applications: catalog.current, applicationsError: snapshot.error,
    applicationsLoading: !!deps.data.currentUserId && signedIn && snapshot.owner !== deps.data.currentUserId,
    refreshApplications, selectApplication, setView, goHome, enterProject, switchProject, openIssue };
}
