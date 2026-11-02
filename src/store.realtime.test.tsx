import { useCallback, useRef, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, commentsApi, issuesApi, projectsApi, type ProjectBootstrap, type ServerIssue } from "./api";
import { beginMutation } from "./api/mutationFence";
import { emptyData, mapIssue, type UIState } from "./store/mappers";
import { useSessionActions } from "./store/session";
import { createSlices } from "./store/slices";
import type { Data } from "./types";
import type { SyncBatch } from "./realtime";

const dto = (title = "Before"): ServerIssue => ({
  id: "i1", projectId: "p1", key: "P-1", title, description: "Description", typeId: "task", statusId: "s1",
  priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null,
  labels: [], complexity: null, dueDate: null, rank: 0, color: null, tStart: null, tSpan: null,
  doneAt: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
}) as unknown as ServerIssue;
const batch = (reset = false): SyncBatch => ({ type: "sync", projectId: "p1", cursor: "2", issueIds: ["i1"], reset, ts: 1 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ok => { resolve = ok; });
  return { promise, resolve };
};

function harness() {
  const initial = { ...emptyData(), currentProjectId: "p1", currentUserId: "u1", issues: [mapIssue(dto())] };
  const bumpIssues = vi.fn();
  const slices = createSlices();
  let current!: {
    data: Data; ui: UIState; actions: ReturnType<typeof useSessionActions>;
    write: (update: (prev: Data) => Data) => void;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    epoch: { current: number };
  };
  function Probe() {
    const [data, commit] = useState(initial);
    const [ui, setUi] = useState<UIState>({ view: "board", section: "", selectedIssueId: "i1", issueMode: "panel", createOpen: false,
      createParentId: null, createDueDate: null, lastEvent: null, collabOpenIssueId: null, missing: null });
    const dataRef = useRef<Data>(data); dataRef.current = data;
    const revision = useRef(0);
    const epoch = useRef(0);
    const setData = useCallback<React.Dispatch<React.SetStateAction<Data>>>(update => { revision.current++; commit(update); }, []);
    const actions = useSessionActions({
      setData, dataRef, dataWriteRevisionRef: revision, pid: () => dataRef.current.currentProjectId,
      toast: vi.fn(), handleApiError: vi.fn(), requirePerm: () => true, local: ru => ru,
      sessionEpochRef: epoch, notifStore: slices.notifications,
    }, { setBootStatus: vi.fn(), setSolo: vi.fn(), setAuthMode: vi.fn(), setUi, bumpIssues, refreshNotifications: async () => undefined, sessionEpochRef: epoch });
    current = { data, ui, actions, write: setData, setUi, epoch };
    return null;
  }
  render(<Probe />);
  return { get: () => current, bumpIssues };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("realtime store reconciliation", () => {
  test("changed open issue refreshes details, comments and activity atomically without changing navigation", async () => {
    const h = harness();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto("Remote title"));
    vi.spyOn(commentsApi, "list").mockResolvedValue([{ id: "c1", authorId: "u2", body: "Remote comment", createdAt: "2026-01-02T00:00:00Z" }] as never);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([{ id: "a1", actorId: "u2", text: "Changed title", createdAt: "2026-01-02T00:00:00Z" }] as never);
    await act(async () => { await h.get().actions.refreshRealtime(batch(), new AbortController().signal, "i1"); });
    expect(h.get().data.issues[0].title).toBe("Remote title");
    expect(h.get().data.issues[0].comments[0].body).toBe("Remote comment");
    expect(h.get().data.issues[0].activity[0].text).toBe("Changed title");
    expect(h.get().ui.selectedIssueId).toBe("i1");
    expect(h.bumpIssues).toHaveBeenCalledTimes(1);
  });

  test("a slow earlier openIssue GET cannot overwrite a successfully reconciled newer issue or feed", async () => {
    const h = harness();
    const old = deferred<ServerIssue>();
    vi.spyOn(issuesApi, "get").mockReturnValueOnce(old.promise).mockResolvedValue(dto("New realtime title"));
    vi.spyOn(commentsApi, "list").mockResolvedValueOnce([]).mockResolvedValue([{ id: "c2", body: "New comment", authorId: "u2", createdAt: "2026-01-02T00:00:00Z" }] as never);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    act(() => h.get().actions.openIssue("i1"));
    await act(async () => { await h.get().actions.refreshRealtime(batch(), new AbortController().signal, "i1"); });
    expect(h.get().data.issues[0].title).toBe("New realtime title");
    await act(async () => { old.resolve(dto("Stale title from opening")); });
    expect(h.get().data.issues[0].title).toBe("New realtime title");
    expect(h.get().data.issues[0].comments[0].body).toBe("New comment");
  });

  test("empty safety reconciliation still refreshes the selected task feed", async () => {
    const h = harness();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto("Latest selected"));
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    await act(async () => { await h.get().actions.refreshRealtime({ ...batch(), issueIds: [] }, new AbortController().signal, "i1"); });
    expect(h.get().data.issues[0].title).toBe("Latest selected");
    expect(h.bumpIssues).toHaveBeenCalledTimes(1);
  });

  test("failed detail subresource does not partially commit or invalidate the successful journal cursor", async () => {
    const h = harness();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto("Remote title"));
    vi.spyOn(commentsApi, "list").mockRejectedValue(new Error("network"));
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    await act(async () => { await expect(h.get().actions.refreshRealtime(batch(), new AbortController().signal, "i1")).rejects.toThrow("network"); });
    expect(h.get().data.issues[0].title).toBe("Before");
    expect(h.bumpIssues).not.toHaveBeenCalled();
  });

  test("pending writes defer reconciliation, and a write crossing an HTTP snapshot rejects it", async () => {
    const h = harness();
    const pending = deferred<ServerIssue>();
    const read = vi.spyOn(issuesApi, "get").mockReturnValue(pending.promise);
    const finish = beginMutation();
    await expect(h.get().actions.refreshRealtime(batch(), new AbortController().signal, null)).rejects.toThrow("deferred");
    expect(read).not.toHaveBeenCalled();
    finish();
    const refresh = h.get().actions.refreshRealtime(batch(), new AbortController().signal, null);
    const finishCrossing = beginMutation(); finishCrossing();
    pending.resolve(dto("Old network snapshot"));
    await expect(refresh).rejects.toThrow("superseded");
    expect(h.get().data.issues[0].title).toBe("Before");
  });

  test("queued local changes win over a slow snapshot even before React commits them", async () => {
    const h = harness();
    const pending = deferred<ServerIssue>();
    vi.spyOn(issuesApi, "get").mockReturnValue(pending.promise);
    const refresh = h.get().actions.refreshRealtime(batch(), new AbortController().signal, null);
    await act(async () => {
      h.get().write(data => ({ ...data, issues: data.issues.map(issue => ({ ...issue, title: "Local confirmed edit" })) }));
      pending.resolve(dto("Old network snapshot"));
      await expect(refresh).rejects.toThrow("superseded");
    });
    expect(h.get().data.issues[0].title).toBe("Local confirmed edit");
    expect(h.bumpIssues).not.toHaveBeenCalled();
  });

  test.each(["logout", "switch", "abort"])("%s during a pending request prevents old-session commits", async kind => {
    const h = harness();
    const pending = deferred<ServerIssue>();
    vi.spyOn(issuesApi, "get").mockReturnValue(pending.promise);
    const abort = new AbortController();
    const refresh = h.get().actions.refreshRealtime(batch(), abort.signal, null);
    await act(async () => {
      if (kind === "logout") h.get().epoch.current++;
      if (kind === "switch") h.get().write(data => ({ ...data, currentProjectId: "p2" }));
      if (kind === "abort") abort.abort();
      pending.resolve(dto("Private old session data"));
      await expect(refresh).rejects.toThrow();
    });
    expect(h.get().data.issues[0].title).toBe("Before");
    expect(h.bumpIssues).not.toHaveBeenCalled();
  });

  test("deleted open issue closes only its own panel; switching panels during the read is preserved", async () => {
    const h = harness();
    const read = vi.spyOn(issuesApi, "get").mockRejectedValue(new ApiError(404, "NOT_FOUND", "Deleted"));
    await act(async () => { await h.get().actions.refreshRealtime(batch(), new AbortController().signal, "i1"); });
    expect(h.get().data.issues).toHaveLength(0);
    expect(h.get().ui.selectedIssueId).toBeNull();
    act(() => { h.get().setUi(ui => ({ ...ui, selectedIssueId: "other" })); });
    read.mockRejectedValue(new ApiError(403, "FORBIDDEN", "Revoked"));
    await act(async () => { await h.get().actions.refreshRealtime(batch(), new AbortController().signal, "i1"); });
    expect(h.get().ui.selectedIssueId).toBe("other");
  });

  test("reset refreshes metadata and current permissions without replacing UI/drafts", async () => {
    const h = harness();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto("After reset"));
    const metadata = {
      project: { id: "p1", key: "P", name: "Renamed project", sprintsEnabled: true },
      users: [{ id: "u1", name: "User", globalRole: "member" }], members: [{ userId: "u1", role: "viewer" }],
      workflow: { statuses: [{ id: "s1", sid: "todo", name: "Renamed status", category: "todo" }], transitions: [] },
      issueTemplates: [], customFields: [], sprints: [],
    } as unknown as ProjectBootstrap;
    vi.spyOn(projectsApi, "get").mockResolvedValue(metadata);
    await act(async () => { await h.get().actions.refreshRealtime(batch(true), new AbortController().signal, null); });
    expect(h.get().data.project.name).toBe("Renamed project");
    expect(h.get().data.members.u1).toBe("viewer");
    expect(h.get().data.workflow.statuses[0].name).toBe("Renamed status");
    expect(h.get().ui.selectedIssueId).toBe("i1");
  });

  test("complete reset reads the active list and selected archived detail without one GET per cached issue", async () => {
    const h = harness();
    act(() => h.get().write(data => ({ ...data, issuesComplete: true, issues: Array.from({ length: 1_000 }, (_, index) =>
      mapIssue({ ...dto(), id: `cached-${index}` })) })));
    const selected = { ...dto("Selected archived"), id: "archived", archivedAt: "2026-01-03T00:00:00.000Z" };
    const get = vi.spyOn(issuesApi, "get").mockResolvedValue(selected);
    vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [dto("Latest active")], hasMore: false, nextCursor: null });
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    vi.spyOn(projectsApi, "get").mockResolvedValue({ project: { id: "p1" }, members: [], users: [], workflow: { statuses: [], transitions: [] }, issueTemplates: [], customFields: [], sprints: [] } as unknown as ProjectBootstrap);
    await act(async () => { await h.get().actions.refreshRealtime(batch(true), new AbortController().signal, "archived"); });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("p1", "archived", expect.any(AbortSignal));
    expect(h.get().data.issues.map(issue => issue.title)).toEqual(["Latest active", "Selected archived"]);
    expect(h.get().data.issues).toHaveLength(2);
    expect(h.get().data.issuesComplete).toBe(true);
  });
});
