import { useCallback, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ApplicationsDto } from "../../server/src/applicationContract";
import type { ProjectSummary, ViewId } from "../types";
import { applicationsApi } from "../api/applications";
import { applicationAllows, useApplicationState } from "./applications";
import { emptyData, type BootStatus, type UIState } from "./mappers";
import { readApplicationPreferences, rememberApplication } from "./applicationPreferences";

const routing = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/", routing.navigate] }));
vi.mock("../motion", () => ({ viewTransition: async (change: () => void) => change() }));

const catalog: ApplicationsDto = {
  revision: 1, canManage: false,
  applications: [
    { id: "work", enabled: true, projectIds: ["p1", "p2"] },
    { id: "knowledge", enabled: true, projectIds: ["p1", "p2"] },
    { id: "objects", enabled: true, projectIds: ["p1"] },
  ],
};
const projects: ProjectSummary[] = ["CORP", "SEC"].map((key, index) => ({
  id: `p${index + 1}`, key, name: key, departmentId: "d1", isShared: false, sprintsEnabled: false,
  defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false,
}));
const initialUi = (view: ViewId): UIState => ({
  view, section: "", selectedIssueId: null, issueMode: "panel", createOpen: false, createParentId: null,
  createDueDate: null, lastEvent: null, collabOpenIssueId: null, missing: null,
});
type Props = { user: string; boot: BootStatus };
function setup(path: string, view: ViewId = "board", initialBoot: BootStatus = "ready") {
  window.history.replaceState(null, "", path);
  const sessionEpochRef = { current: 0 };
  const switched = vi.fn(), entered = vi.fn(), opened = vi.fn(), home = vi.fn();
  const hook = renderHook(({ user, boot: suppliedBoot }: Props) => {
    const [ui, setUi] = useState(() => initialUi(view));
    const [projectId, setProjectId] = useState("p1");
    const [boot, setBootStatus] = useState(suppliedBoot);
    const switchProject = useCallback((id: string) => { switched(id); setProjectId(id); setBootStatus("ready"); }, []);
    const data = { ...emptyData(), projects, currentUserId: user, currentProjectId: projectId };
    const state = useApplicationState({
      data, ui, bootStatus: suppliedBoot === "unauthenticated" ? suppliedBoot : boot,
      setUi, setBootStatus, sessionEpochRef, switchProject, enterProject: entered, goHome: home, openIssue: opened,
    });
    return { ...state, ui, projectId, boot };
  }, { initialProps: { user: "anna", boot: initialBoot } as Props });
  return { ...hook, sessionEpochRef, switched, entered, opened, home };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); routing.navigate.mockClear();
  window.history.replaceState(null, "", "/");
});

test("root entry restores the account's last Knowledge project and replaces the root URL", async () => {
  rememberApplication("anna", "knowledge", "p2", "documents");
  vi.spyOn(applicationsApi, "get").mockResolvedValue(catalog);
  const { result, switched } = setup("/");
  await waitFor(() => expect(result.current.application).toBe("knowledge"));
  expect(result.current.ui.view).toBe("documents");
  expect(switched).toHaveBeenCalledWith("p2");
  expect(result.current.projectId).toBe("p2");
  expect(routing.navigate).toHaveBeenCalledWith("/p/SEC/documents", { replace: true });
});

test("an explicit document URL wins over the remembered Work preference", async () => {
  rememberApplication("anna", "work", "p1", "board");
  vi.spyOn(applicationsApi, "get").mockResolvedValue(catalog);
  const { result, switched } = setup("/p/CORP/documents", "documents");
  await waitFor(() => expect(result.current.applications).toEqual(catalog));
  expect(result.current.application).toBe("knowledge");
  expect(result.current.ui.view).toBe("documents");
  expect(switched).not.toHaveBeenCalled();
  expect(routing.navigate).not.toHaveBeenCalled();
});

test("a disabled remembered application falls back to an enabled app on root entry", async () => {
  rememberApplication("anna", "objects", "p1", "objects");
  const updated: ApplicationsDto = { ...catalog, applications: catalog.applications.map((app) => ({ ...app, enabled: app.id === "knowledge" })) };
  vi.spyOn(applicationsApi, "get").mockResolvedValue(updated);
  const { result } = setup("/");
  await waitFor(() => expect(result.current.applications).toEqual(updated));
  expect(result.current.application).toBe("knowledge");
  expect(result.current.ui.view).toBe("documents");
  expect(readApplicationPreferences("anna").lastApplication).toBe("knowledge");
});

test("a catalogue response arriving after logout cannot restore the cleared session", async () => {
  const pending = deferred<ApplicationsDto>();
  vi.spyOn(applicationsApi, "get").mockReturnValue(pending.promise);
  const { result, rerender, sessionEpochRef } = setup("/");
  act(() => {
    sessionEpochRef.current++;
    window.dispatchEvent(new Event("taskira:session-cleared"));
    rerender({ user: "", boot: "unauthenticated" });
  });
  await act(async () => { pending.resolve(catalog); await pending.promise; });
  expect(result.current.applications).toBeNull();
  expect(routing.navigate).not.toHaveBeenCalled();
  expect(readApplicationPreferences("")).toEqual({ projects: {} });
});

test("a previous account's slow catalogue cannot replace the new account's catalogue", async () => {
  const pending = deferred<ApplicationsDto>();
  const bob: ApplicationsDto = { ...catalog, revision: 8, applications: catalog.applications.map((app) => ({ ...app, projectIds: ["p1"] })) };
  vi.spyOn(applicationsApi, "get").mockReturnValueOnce(pending.promise).mockResolvedValue(bob);
  const { result, rerender, sessionEpochRef } = setup("/");
  act(() => { sessionEpochRef.current++; rerender({ user: "bob", boot: "ready" }); });
  await waitFor(() => expect(result.current.applications?.revision).toBe(8));
  await act(async () => { pending.resolve(catalog); await pending.promise; });
  expect(result.current.applications).toEqual(bob);
  expect(readApplicationPreferences("anna")).toEqual({ projects: {} });
});

test("availability refresh on focus keeps an explicit document readable and prevents selecting a disabled app", async () => {
  const updated: ApplicationsDto = { ...catalog, revision: 2, applications: catalog.applications.map((app) => app.id === "knowledge" ? { ...app, enabled: false, projectIds: [] } : app) };
  vi.spyOn(applicationsApi, "get").mockResolvedValueOnce(catalog).mockResolvedValue(updated);
  const { result, switched } = setup("/p/CORP/documents", "documents");
  await waitFor(() => expect(result.current.applications?.revision).toBe(1));
  act(() => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.applications?.revision).toBe(2));
  expect(result.current.application).toBe("knowledge");
  expect(result.current.ui.view).toBe("documents");
  expect(routing.navigate).not.toHaveBeenCalled();
  await act(async () => { await result.current.selectApplication("knowledge"); });
  expect(switched).not.toHaveBeenCalled();
});

test("module changes refresh available projects and a task panel preserves its source application", async () => {
  const updated: ApplicationsDto = { ...catalog, revision: 2, applications: catalog.applications.map((app) => app.id === "knowledge" ? { ...app, projectIds: ["p2"] } : app) };
  vi.spyOn(applicationsApi, "get").mockResolvedValueOnce(catalog).mockResolvedValue(updated);
  const { result, opened } = setup("/p/CORP/documents", "documents");
  await waitFor(() => expect(result.current.applications?.revision).toBe(1));
  act(() => { result.current.openIssue("issue-1", "panel"); });
  expect(result.current.application).toBe("knowledge");
  expect(opened).toHaveBeenCalledWith("issue-1", "panel");
  act(() => { window.dispatchEvent(new Event("taskira:workspace-modules")); });
  await waitFor(() => expect(result.current.applications?.revision).toBe(2));
  expect(result.current.applications?.applications.find((app) => app.id === "knowledge")?.projectIds).toEqual(["p2"]);
  expect(result.current.ui.view).toBe("documents");
});

test.each(["files", "library", "docs", "projectSettings"] as const)("Knowledge project switches preserve the shared %s view", async (view) => {
  vi.spyOn(applicationsApi, "get").mockResolvedValue(catalog);
  const { result, switched, entered } = setup("/p/CORP/documents", "documents");
  await waitFor(() => expect(result.current.applications).toEqual(catalog));
  await act(async () => { await result.current.setView(view); });
  act(() => { result.current.switchProject("p2"); });
  expect(switched).toHaveBeenCalledWith("p2");
  expect(result.current.ui.view).toBe(view);
  act(() => { result.current.enterProject("p1"); });
  expect(entered).toHaveBeenCalledWith("p1");
  expect(result.current.application).toBe("knowledge");
  expect(result.current.ui.view).toBe(view);
});

test.each(["work", "knowledge", "objects"] as const)("entering a project from %s home selects its own default view", async (app) => {
  vi.spyOn(applicationsApi, "get").mockResolvedValue(catalog);
  const { result, entered } = setup(`/apps/${app}`, "applicationHome");
  await waitFor(() => expect(result.current.applications).toEqual(catalog));
  act(() => { result.current.enterProject("p1"); });
  expect(entered).toHaveBeenCalledWith("p1");
  expect(result.current.ui.view).toBe(app === "knowledge" ? "documents" : app === "objects" ? "objects" : "board");
});

test("an invited-task-only session loads availability without restoring an unrelated app", async () => {
  rememberApplication("anna", "knowledge", "p2", "documents");
  const disabled: ApplicationsDto = { ...catalog, applications: catalog.applications.map((app) => ({ ...app, enabled: app.id === "knowledge", projectIds: [] })) };
  vi.spyOn(applicationsApi, "get").mockResolvedValue(disabled);
  const { result, switched } = setup("/", "collaborating", "solo");
  await waitFor(() => expect(result.current.applications).toEqual(disabled));
  expect(result.current.application).toBe("work");
  expect(result.current.boot).toBe("solo");
  expect(switched).not.toHaveBeenCalled();
  expect(applicationAllows("comment", result.current.applications)).toBe(false);
});

test("application gates narrow write permissions without changing unrelated project access", () => {
  const knowledgeOnly: ApplicationsDto = { ...catalog, applications: catalog.applications.map((app) => ({ ...app, enabled: app.id === "knowledge" })) };
  expect(applicationAllows("writeDocuments", knowledgeOnly)).toBe(true);
  for (const perm of ["create", "edit", "transition", "manageProcesses", "managePlans", "writeObjects"] as const)
    expect(applicationAllows(perm, knowledgeOnly), perm).toBe(false);
  expect(applicationAllows("manageWorkspace", knowledgeOnly)).toBe(true);
  expect(applicationAllows("create", catalog)).toBe(true);
});
