import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { StoreProvider, useStore } from "./store";
import { useRouterSync } from "./useRouterSync";
import { I18nProvider } from "./i18n";
import { pathForIssue, pathForView } from "./router";
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
const proj = (id: string, key: string) => ({ id, key, name: key, description: "", departmentId: "d1", isShared: false, sprintsEnabled: false });
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
  vi.spyOn(projectsApi, "get").mockImplementation(async (id: string) => boot(projects.find((p) => p.id === id) ?? proj(id, "ZZ")));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
}

type Store = ReturnType<typeof useStore>;
let unmountCurrent: (() => void) | null = null;

function mount() {
  let latest: Store | null = null;
  function Probe() {
    const api = useStore();
    useRouterSync();
    useEffect(() => {
      if (api.bootStatus === "idle") void api.bootstrap();
    }, [api.bootStatus, api.bootstrap]);
    latest = api;
    return null;
  }
  const { unmount } = render(
    <I18nProvider>
      <StoreProvider>
        <Probe />
      </StoreProvider>
    </I18nProvider>,
  );
  unmountCurrent = unmount;
  return () => latest!;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useRouterSync — URL → состояние, полный путь (ТЗ 3.1)", () => {
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
});
