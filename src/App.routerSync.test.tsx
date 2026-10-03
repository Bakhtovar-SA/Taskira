import { describe, expect, test, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { StoreProvider, useStore } from "./store";
import * as storeModule from "./store";
import { useRouterSync } from "./useRouterSync";
import { I18nProvider } from "./i18n";
import { pathForIssue, pathForView } from "./router";
import App from "./App";
import {
  ApiError,
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
} from "./api";

/** Интеграционные тесты App.tsx + useRouterSync.ts (ТЗ 3.1): полный путь URL → состояние,
 *  который store.bootNav.test.tsx больше не покрывает — там монтируется голый
 *  `StoreProvider` (bootstrap() решает только, в какой ПРОЕКТ войти), а фактическое
 *  открытие задачи по прямой ссылке теперь на уровне useRouterSync, который живёт
 *  только внутри `App.tsx` (Shell), не внутри стора. Минимальный харнесс ниже
 *  воспроизводит именно эту связку (StoreProvider + bootstrap-on-idle + useRouterSync),
 *  без реального дерева Shell/Board — состояние, а не пиксели, здесь и важно. */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const user = (over: Record<string, unknown> = {}) => ({
  id: "u1", username: "admin", name: "Админ", initials: "А", color: "#0B5FD9", jobRole: "Админ",
  globalRole: "admin" as const, isActive: true, authSource: "local" as const, ...over,
});
const proj = (id: string, key: string) => ({ id, key, name: key, description: "", departmentId: "d1", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false });
const boot = (p: ReturnType<typeof proj>): ProjectBootstrap => ({
  project: p,
  users: [user()] as never,
  members: [],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
  issueTemplates: [], customFields: [], sprints: [],
});
const projects = [proj(P1, "AA"), proj(P2, "BB")];

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

function install(o: { me?: ReturnType<typeof user> | Error } = {}) {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const meSpy = vi.spyOn(authApi, "me");
  if (o.me instanceof Error) meSpy.mockRejectedValue(o.me);
  else meSpy.mockResolvedValue((o.me ?? user()) as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue(projects as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(issuesApi, "assignedToMe").mockResolvedValue({ items: [], truncated: false, limit: 100 });
  vi.spyOn(projectsApi, "get").mockImplementation(async (id: string) => boot(projects.find((p) => p.id === id) ?? proj(id, "ZZ")));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
}

type Store = ReturnType<typeof useStore>;
let unmountCurrent: (() => void) | null = null;

function mount(strict = false) {
  let latest: Store | null = null;
  function RouterProbe() {
    useRouterSync();
    return null;
  }
  function Probe() {
    const api = useStore();
    useEffect(() => {
      if (api.bootStatus === "idle") void api.bootstrap();
    }, [api.bootStatus, api.bootstrap]);
    latest = api;
    return strict ? (api.bootStatus === "ready" || api.bootStatus === "home" ? <StrictMode><RouterProbe /></StrictMode> : null) : <RouterProbe />;
  }
  const tree = (
    <I18nProvider>
      <StoreProvider>
        <Probe />
      </StoreProvider>
    </I18nProvider>
  );
  const { unmount } = render(tree);
  unmountCurrent = unmount;
  return () => latest!;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  cleanup(); // тесты ниже (полный <App/>), в отличие от остальных в файле, не проходят через mount()/unmountCurrent
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useRouterSync — URL → состояние, полный путь (ТЗ 3.1)", () => {
  function observeHome() {
    const original = storeModule.useStore;
    const home = vi.fn();
    vi.spyOn(storeModule, "useStore").mockImplementation(() => {
      const api = original();
      return { ...api, goHome: () => { home(); api.goHome(); } };
    });
    return home;
  }

  function issueInB() {
    vi.spyOn(issuesApi, "resolve").mockResolvedValue({ id: I1, projectId: P2, projectKey: "BB" });
    vi.spyOn(issuesApi, "get").mockResolvedValue({
      id: I1, projectId: P2, num: 1, key: "BB-1", title: "Task B", description: "", typeId: "task", statusId: "s1",
      priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null,
      labels: [], dueDate: null, rank: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      doneAt: null, archivedAt: null,
    } as never);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
  }

  test("a delayed panel resolve commits the project and issue together", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    issueInB();
    let finish!: (value: { id: string; projectId: string; projectKey: string }) => void;
    const pending = new Promise<{ id: string; projectId: string; projectKey: string }>((resolve) => { finish = resolve; });
    vi.mocked(issuesApi.resolve).mockReturnValue(pending);
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/BB/board?issue=BB-1"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(get().data.currentProjectId).toBe(P1);
    expect(location.pathname + location.search).toBe("/p/BB/board?issue=BB-1");
    await act(async () => { finish({ id: I1, projectId: P2, projectKey: "BB" }); });
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("panel");
    expect(location.pathname + location.search).toBe("/p/BB/board?issue=BB-1");
  });

  test("a cross-project issue query opens the issue's project and keeps the requested view", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    issueInB();
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/AA/timeline?issue=BB-1"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.view).toBe("timeline");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("panel");
    expect(location.pathname + location.search).toBe("/p/BB/timeline?issue=BB-1");
  });

  test("equal access lists do not cancel or repeat a pending resolve", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    issueInB();
    let finish!: (value: { id: string; projectId: string; projectKey: string }) => void;
    vi.mocked(issuesApi.resolve).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/BB/issue/BB-1"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    vi.mocked(projectsApi.list).mockResolvedValue([...projects].reverse() as never);
    await act(async () => { await get().refreshOrg(); await get().refreshCollaborations(); });
    await settle();
    expect(issuesApi.resolve).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ id: I1, projectId: P2, projectKey: "BB" }); });
    await settle();
    await settle();
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(location.pathname).toBe("/p/BB/issue/BB-1");
  });

  test("a missing invited issue is retried when collaboration access arrives", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    vi.spyOn(issuesApi, "resolve").mockRejectedValue(new ApiError(404, "NOT_FOUND", "нет"));
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/CC/issue/CC-5"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(get().ui.missing).toBe("/p/CC/issue/CC-5");
    vi.mocked(issuesApi.resolve).mockResolvedValue({ id: I1, projectId: "p-cc", projectKey: "CC" });
    vi.mocked(issuesApi.collaborating).mockResolvedValue([{ issueId: I1, projectId: "p-cc", key: "CC-5" }] as never);
    await act(async () => { await get().refreshCollaborations(); });
    await settle();
    await settle();
    expect(get().ui.view).toBe("collaborating");
    expect(get().ui.collabOpenIssueId).toBe(I1);
    expect(get().ui.missing).toBeNull();
    expect(location.pathname).toBe("/shared");
  });

  test("StrictMode effect replay still applies a direct issue panel", async () => {
    history.replaceState(null, "", "/p/BB/board?issue=BB-1");
    install();
    issueInB();
    const get = mount(true);
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(location.pathname + location.search).toBe("/p/BB/board?issue=BB-1");
  });

  test("a root URL which causes no state change is canonicalized for one project", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    vi.mocked(projectsApi.list).mockResolvedValue([projects[0]] as never);
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(location.pathname).toBe("/p/AA/board");
  });

  test("a missing project URL is retried when the project list arrives", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    vi.mocked(projectsApi.list).mockResolvedValue([projects[0]] as never);
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/BB/board"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(get().ui.missing).toBe("/p/BB/board");
    vi.mocked(projectsApi.list).mockResolvedValue(projects as never);
    await act(async () => { await get().refreshOrg(); });
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.missing).toBeNull();
    expect(location.pathname).toBe("/p/BB/board");
  });

  test("a resolved issue is retried when its project becomes available", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    issueInB();
    vi.mocked(projectsApi.list).mockResolvedValue([projects[0]] as never);
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/BB/issue/BB-1"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(get().ui.missing).toBe("/p/BB/issue/BB-1");
    vi.mocked(projectsApi.list).mockResolvedValue(projects as never);
    await act(async () => { await get().refreshOrg(); });
    await settle();
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("page");
    expect(get().ui.missing).toBeNull();
    expect(location.pathname).toBe("/p/BB/issue/BB-1");
  });

  test("a cancelled resolve cannot overwrite the successful retry after access lists refresh", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    issueInB();
    vi.mocked(projectsApi.list).mockResolvedValue([projects[0]] as never);
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/p/BB/issue/BB-1"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(get().ui.missing).toBe("/p/BB/issue/BB-1");
    let finishOld!: (value: { id: string; projectId: string; projectKey: string }) => void;
    vi.mocked(issuesApi.resolve).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    vi.mocked(projectsApi.list).mockResolvedValue(projects as never);
    await act(async () => { await get().refreshOrg(); });
    await settle();
    expect(get().data.currentProjectId).toBe(P1);
    vi.mocked(projectsApi.list).mockResolvedValue([...projects, proj("33333333-3333-4333-8333-333333333333", "CC")] as never);
    await act(async () => { await get().refreshOrg(); });
    await settle();
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBe(I1);
    await act(async () => { finishOld({ id: "stale-issue", projectId: P1, projectKey: "AA" }); });
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(location.pathname).toBe("/p/BB/issue/BB-1");
  });

  test("home: enter an unloaded project keeps ready and updates the URL without goHome", async () => {
    history.replaceState(null, "", "/");
    install();
    const home = observeHome();
    const get = mount();
    await settle();
    expect(get().bootStatus).toBe("home");
    act(() => get().enterProject(P2));
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(location.pathname).toBe("/p/BB/board");
    expect(home).not.toHaveBeenCalled();
  });

  test("home: enter the loaded project keeps ready and updates the URL", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    const home = observeHome();
    const get = mount();
    await settle();
    act(() => get().goHome());
    await settle();
    expect(get().bootStatus).toBe("home");
    expect(location.pathname).toBe("/");
    home.mockClear();
    act(() => get().enterProject(P1));
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(location.pathname).toBe("/p/AA/board");
    expect(home).not.toHaveBeenCalled();
  });

  test("home: open an issue in another project as a page", async () => {
    history.replaceState(null, "", "/");
    install();
    issueInB();
    const home = observeHome();
    const get = mount();
    await settle();
    act(() => get().switchProject(P2, I1, "page"));
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("page");
    expect(location.pathname).toBe("/p/BB/issue/BB-1");
    expect(home).not.toHaveBeenCalled();
  });

  test("home: an actual URL change to root calls goHome", async () => {
    history.replaceState(null, "", "/p/AA/board");
    install();
    const home = observeHome();
    const get = mount();
    await settle();
    act(() => { history.pushState(null, "", "/"); dispatchEvent(new PopStateEvent("popstate")); });
    await settle();
    expect(home).toHaveBeenCalledTimes(1);
    expect(get().bootStatus).toBe("home");
    expect(location.pathname).toBe("/");
  });

  test("home: browser back and forward restore home and the loaded project", async () => {
    history.replaceState(null, "", "/");
    install();
    const get = mount();
    await settle();
    act(() => get().enterProject(P2));
    await settle();
    expect(location.pathname).toBe("/p/BB/board");
    act(() => history.back());
    await settle();
    expect(get().bootStatus).toBe("home");
    expect(location.pathname).toBe("/");
    act(() => history.forward());
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(location.pathname).toBe("/p/BB/board");
  });

  test("home: direct board URL with issue query still opens its panel on boot", async () => {
    history.replaceState(null, "", "/p/BB/board?issue=BB-1");
    install();
    issueInB();
    const get = mount();
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("panel");
    expect(location.pathname + location.search).toBe("/p/BB/board?issue=BB-1");
  });

  test("home: issue query is applied again after logout and a fresh bootstrap", async () => {
    history.replaceState(null, "", "/p/BB/board?issue=BB-1");
    install();
    issueInB();
    vi.spyOn(authApi, "logout").mockResolvedValue(undefined);
    const get = mount();
    await settle();
    await settle();
    expect(get().ui.selectedIssueId).toBe(I1);
    act(() => get().logout());
    expect(get().bootStatus).toBe("unauthenticated");
    await act(async () => { await get().bootstrap(); });
    await settle();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(location.pathname + location.search).toBe("/p/BB/board?issue=BB-1");
  });
  // Ровно тот сценарий, который просили зафиксировать первым перед реализацией
  // роутинга: deep link на задачу, открытый не залогиненным — после входа
  // открывается ИМЕННО эта задача (не просто "верный проект", это уже
  // покрыто store.bootNav.test.tsx).
  test("не залогинен + deep link на задачу → после успешного bootstrap() открывается именно она", async () => {
    history.pushState(null, "", pathForIssue("BB", "K-aa"));
    install({ me: new ApiError(401, "UNAUTHORIZED", "нет") });
    const get = mount();
    await settle();
    expect(get().bootStatus).toBe("unauthenticated");
    expect(location.pathname).toBe(pathForIssue("BB", "K-aa")); // путь не тронут

    vi.restoreAllMocks();
    install();
    vi.spyOn(issuesApi, "resolve").mockResolvedValue({ id: I1, projectId: P2, projectKey: "BB" });
    vi.spyOn(issuesApi, "get").mockResolvedValue({
      id: I1, projectId: P2, num: 1, key: "K-aa", title: "т", description: "", typeId: "task", statusId: "s1",
      priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
      tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null,
    } as never);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);

    await act(async () => { await get().bootstrap(); });
    await settle();

    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBe(I1);
  });

  test("прямая ссылка на вид внутри проекта (без задачи) открывает именно этот вид", async () => {
    history.pushState(null, "", pathForView("BB", "backlog"));
    install();
    const get = mount();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.view).toBe("backlog");
  });

  test("переход внутри уже загруженного приложения (setView) обновляет адресную строку", async () => {
    history.pushState(null, "", pathForView("AA", "board"));
    install();
    const get = mount();
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(location.pathname).toBe(pathForView("AA", "board"));

    act(() => get().setView("timeline"));
    await settle();
    expect(location.pathname).toBe(pathForView("AA", "timeline"));
  });

  test("кнопка «назад» браузера (popstate) возвращает предыдущий вид", async () => {
    history.pushState(null, "", pathForView("AA", "board"));
    install();
    const get = mount();
    await settle();

    act(() => get().setView("timeline"));
    await settle();
    expect(get().ui.view).toBe("timeline");
    expect(location.pathname).toBe(pathForView("AA", "timeline"));

    act(() => { history.back(); });
    await settle();
    expect(location.pathname).toBe(pathForView("AA", "board"));
    expect(get().ui.view).toBe("board");
  });

  test("board and list preserve their shared filters, another project starts clean", async () => {
    history.pushState(null, "", "/p/AA/board?assignee=u1&overdue=1&q=contract");
    install();
    const get = mount();
    await settle();
    act(() => get().setView("backlog"));
    await settle();
    expect(location.pathname).toBe("/p/AA/list");
    expect(location.search).toBe("?assignee=u1&overdue=1&q=contract");
    act(() => get().setView("board"));
    await settle();
    expect(location.search).toBe("?assignee=u1&overdue=1&q=contract");
    act(() => get().switchProject(P2));
    await settle();
    expect(location.search).toBe("");
  });

  test("старая ссылка /p/KEY/backlog?фильтры → /p/KEY/list с теми же фильтрами, без лишней записи в истории (ADR-0013 §5)", async () => {
    history.pushState(null, "", "/p/BB/backlog?status=s1&priority=high");
    const before = history.length;
    install();
    const get = mount();
    await settle();
    expect(get().ui.view).toBe("backlog");
    expect(location.pathname).toBe("/p/BB/list");
    expect(location.search).toBe("?status=s1&priority=high");
    expect(history.length).toBe(before);
  });

  test("/p/KEY/sprints при выключенном модуле → доска, а не экран-отказ (ADR-0013 §5)", async () => {
    history.pushState(null, "", "/p/BB/sprints");
    install();
    const get = mount();
    await settle();
    expect(get().ui.view).toBe("board");
    expect(location.pathname).toBe("/p/BB/board");
  });

  test("панель задачи — ?issue=KEY поверх вида; полная страница — /p/KEY/issue/KEY; «назад» закрывает (ADR-0013 §3)", async () => {
    history.pushState(null, "", pathForView("AA", "board"));
    install();
    const dto = {
      id: I1, projectId: P1, num: 1, key: "AA-1", title: "т", description: "", typeId: "task", statusId: "s1",
      priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
      tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null,
    };
    vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [dto], hasMore: false, nextCursor: null } as never);
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto as never);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    const get = mount();
    await settle();

    act(() => get().openIssue(I1));
    await settle();
    expect(location.pathname).toBe("/p/AA/board");
    expect(location.search).toBe("?issue=AA-1");

    act(() => get().openIssue(I1, "page"));
    await settle();
    expect(location.pathname).toBe(pathForIssue("AA", "AA-1"));
    expect(location.search).toBe("");

    act(() => { history.back(); });
    await settle();
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("panel");

    act(() => { history.back(); });
    await settle();
    expect(location.search).toBe("");
    expect(get().ui.selectedIssueId).toBeNull();
  });

  test("ссылка /p/KEY/list?issue=KEY открывает Список и панель задачи над ним", async () => {
    history.pushState(null, "", "/p/BB/list?priority=high&issue=BB-7");
    install();
    vi.spyOn(issuesApi, "resolve").mockResolvedValue({ id: I1, projectId: P2, projectKey: "BB" });
    vi.spyOn(issuesApi, "get").mockResolvedValue({
      id: I1, projectId: P2, num: 7, key: "BB-7", title: "т", description: "", typeId: "task", statusId: "s1",
      priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
      tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null,
    } as never);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    const get = mount();
    await settle();
    await settle();
    expect(get().ui.view).toBe("backlog");
    expect(get().ui.selectedIssueId).toBe(I1);
    expect(get().ui.issueMode).toBe("panel");
    expect(location.pathname).toBe("/p/BB/list");
    expect(new URLSearchParams(location.search).get("priority")).toBe("high");
  });

  // ROUTE-01: при входе по ссылке bootstrap() выбирал приглашённую задачу сам, а та же ссылка посреди сессии
  // открывала «Мои подключения» без выбранной карточки.
  test("ссылка на приглашённую задачу посреди сессии → «Мои подключения» с выбранной карточкой", async () => {
    const COLLAB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    history.pushState(null, "", pathForView("AA", "board"));
    install();
    vi.spyOn(issuesApi, "collaborating").mockResolvedValue([{ issueId: COLLAB, projectId: "p-cc", key: "CC-5" }] as never);
    vi.spyOn(issuesApi, "resolve").mockResolvedValue({ id: COLLAB, projectId: "p-cc", projectKey: "CC" });
    const get = mount();
    await settle();
    expect(get().ui.view).toBe("board");

    act(() => {
      history.pushState(null, "", pathForIssue("CC", "CC-5"));
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(get().ui.view).toBe("collaborating");
    expect(get().ui.collabOpenIssueId).toBe(COLLAB);
    expect(get().data.currentProjectId).toBe(P1); // проект, где человек работал, не сменился
  });
});

// ТЗ 5.12 a: раньше сбой загрузки (сервер недоступен/сеть упала — не 401, значит сессия скорее всего
// цела) молча показывал LoginForm, как будто человек разлогинен. Полный <App/> (не Probe выше) — иначе
// не проверить, ЧТО реально рендерится вместо доски: LoginForm или BootErrorScreen.
describe("App — ТЗ 5.12 a: сбой загрузки (не 401) не путают с разлогином", () => {
  test("authApi.me() падает не 401-ошибкой → форма входа не показана, есть «Повторить», клик по ней вызывает bootstrap() заново", async () => {
    const meSpy = vi.spyOn(authApi, "me").mockRejectedValue(new ApiError(0, "NETWORK", "нет сети"));
    vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
    vi.spyOn(projectsApi, "list").mockResolvedValue([]);
    vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await settle();

    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить Taskira");
    expect(screen.queryByLabelText("Логин")).toBeNull(); // форма входа НЕ показана
    expect(meSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Повторить"));
    await settle();
    expect(meSpy).toHaveBeenCalledTimes(2); // повтор — обычный bootstrap(), не отдельный путь
  });
});
