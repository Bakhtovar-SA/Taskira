import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  ApiError,
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type CollaboratingItem,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";

/** Характеризационные тесты загрузки, сессии, навигации между проектами и открытия задачи в сторе — написаны ДО выноса
 *  в src/store/session.ts (ТЗ 2.3, шаг 6). Фиксируют ТЕКУЩЕЕ поведение, включая гонки (порядок событий во времени):
 *  устаревшие ответы switchProject (`switchSeqRef`), намерение «открыть задачу после переключения»
 *  (`pendingOpenIssueRef`), защиту «проект не сменился, пока шёл запрос», ответы после logout. */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const I9 = "99999999-9999-4999-8999-999999999999";

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
const dto = (id: string, projectId = P1, over: Record<string, unknown> = {}): ServerIssue =>
  ({
    id, projectId, num: 1, key: `K-${id.slice(0, 2)}`, title: `Задача ${id.slice(0, 2)}`, description: "", typeId: "task", statusId: "s1",
    priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
    tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null, ...over,
  }) as unknown as ServerIssue;

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

const projects = [proj(P1, "AA"), proj(P2, "BB"), proj(P3, "CC")];
let unmountCurrent: (() => void) | null = null;
type Store = ReturnType<typeof useStore>;

interface Setup {
  me?: ReturnType<typeof user> | Error;
  projects?: ReturnType<typeof proj>[];
  collabs?: CollaboratingItem[];
  issues?: ServerIssue[];
  /** для projectsApi.get: по умолчанию — обычный bootstrap проекта */
  getProject?: (id: string) => Promise<ProjectBootstrap>;
}

function install(o: Setup = {}) {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const list = o.projects ?? projects;
  const meSpy = vi.spyOn(authApi, "me");
  if (o.me instanceof Error) meSpy.mockRejectedValue(o.me);
  else meSpy.mockResolvedValue((o.me ?? user()) as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(authApi, "logout").mockResolvedValue(undefined as never);
  vi.spyOn(projectsApi, "list").mockResolvedValue(list as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue(o.collabs ?? []);
  vi.spyOn(issuesApi, "assignedToMe").mockResolvedValue({ items: [], truncated: false, limit: 100 });
  const getSpy = vi.spyOn(projectsApi, "get").mockImplementation(
    o.getProject ?? (async (id: string) => boot(list.find((p) => p.id === id) ?? proj(id, "ZZ"))),
  );
  const listSpy = vi.spyOn(issuesApi, "list").mockResolvedValue({ items: o.issues ?? [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  return { getSpy, listSpy };
}

function mount() {
  let latest: Store | null = null;
  function Probe() {
    latest = useStore();
    return null;
  }
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  unmountCurrent = unmount;
  return () => latest!;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });

/** Вход как обычно: bootstrap → home (≥2 проектов) → enterProject(P1) → ready внутри P1. */
async function readyInP1(o: Setup = {}) {
  const spies = install(o);
  const get = mount();
  await act(async () => { await get().bootstrap(); });
  expect(get().bootStatus).toBe("home");
  act(() => get().enterProject(P1));
  await settle();
  expect(get().bootStatus).toBe("ready");
  expect(get().data.currentProjectId).toBe(P1);
  return { get, ...spies };
}

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  localStorage.clear();
  location.hash = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bootstrap — ветки входа", () => {
  test("401 на /me → unauthenticated", async () => {
    install({ me: new ApiError(401, "UNAUTHORIZED", "нет") });
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("unauthenticated");
  });

  test("прочая ошибка → error", async () => {
    install({ me: new ApiError(500, "INTERNAL", "boom") });
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("error");
  });

  test("нет проектов: админ уходит в раздел admin, обычный пользователь остаётся на доске; оба ready", async () => {
    install({ projects: [], me: user() });
    let get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.view).toBe("admin");
    expect(get().data.currentProjectId).toBe("");
    unmountCurrent?.();
    vi.restoreAllMocks();
    install({ projects: [], me: user({ globalRole: "member" }) });
    get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.view).toBe("board");
  });

  test("нет проектов, но есть приглашения к задачам → solo с этими приглашениями", async () => {
    const collab = { issueId: I9, projectId: P2, key: "BB-1", title: "Чужая", statusId: "s1", statusName: "К работе", statusCategory: "todo", projectKey: "BB", projectName: "BB" } as CollaboratingItem;
    install({ projects: [], collabs: [collab] });
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("solo");
    expect(get().solo?.items.map((c) => c.issueId)).toEqual([I9]);
  });

  test("один проект → сразу внутрь (ready), без главного экрана; последний проект запоминается", async () => {
    install({ projects: [proj(P1, "AA")] });
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P1);
    expect(localStorage.getItem("taskira.project")).toBe(P1);
  });

  test("≥2 проектов и прямая ссылка на задачу видимого проекта → сразу в этот проект, минуя home", async () => {
    location.hash = `#/issue/${P2}/${I1}`;
    install();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I1, P2));
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
  });

  test("прямая ссылка на приглашённую задачу → раздел «Мои подключения»; проект — из lastProject, а не первый", async () => {
    const collab = { issueId: I1, projectId: "99999999-0000-4000-8000-000000000000", key: "X-1", title: "t", statusId: "s", statusName: "n", statusCategory: "todo", projectKey: "X", projectName: "X" } as CollaboratingItem;
    location.hash = `#/issue/99999999-0000-4000-8000-000000000000/${I1}`;
    localStorage.setItem("taskira.project", P2);
    install({ collabs: [collab] });
    const get = mount();
    await act(async () => { await get().bootstrap(); });
    expect(get().bootStatus).toBe("ready");
    expect(get().ui.view).toBe("collaborating");
    expect(get().data.currentProjectId).toBe(P2);
  });
});

describe("enterProject / goHome / logout / refresh*", () => {
  test("enterProject: неизвестный проект — ничего; текущий — просто уходит с home без запросов", async () => {
    const { get, getSpy } = await readyInP1();
    act(() => get().goHome());
    await settle();
    expect(get().bootStatus).toBe("home");
    const calls = getSpy.mock.calls.length;
    act(() => get().enterProject("не-проект"));
    expect(get().bootStatus).toBe("home");
    act(() => get().enterProject(P1));
    expect(get().bootStatus).toBe("ready");
    expect(getSpy.mock.calls.length).toBe(calls);
  });

  test("goHome: home, снимает выбранную задачу и createOpen, освежает «Мои задачи» и уведомления", async () => {
    const { get } = await readyInP1();
    const assigned = vi.mocked(issuesApi.assignedToMe);
    const notes = vi.mocked(notificationsApi.list);
    act(() => get().setCreateOpen(true));
    const [a0, n0] = [assigned.mock.calls.length, notes.mock.calls.length];
    act(() => get().goHome());
    await settle();
    expect(get().bootStatus).toBe("home");
    expect(get().ui.createOpen).toBe(false);
    expect(get().ui.selectedIssueId).toBeNull();
    expect(assigned.mock.calls.length).toBe(a0 + 1);
    expect(notes.mock.calls.length).toBe(n0 + 1);
  });

  test("logout: данные сброшены, unauthenticated, сервер уведомлён; сбой сети при logout не мешает локальному выходу", async () => {
    const { get } = await readyInP1();
    vi.mocked(authApi.logout).mockRejectedValue(new Error("сеть"));
    act(() => get().logout());
    await settle();
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(get().bootStatus).toBe("unauthenticated");
    expect(get().data.currentUserId).toBe("");
    expect(get().data.currentProjectId).toBe("");
  });

  test("refreshCollaborations и refreshAssignedToMe обновляют данные, а при ошибке молчат и оставляют прежние", async () => {
    const { get } = await readyInP1();
    const item = { issueId: I9, projectId: P2, key: "K", title: "t", statusId: "s", statusName: "n", statusCategory: "todo", projectKey: "B", projectName: "B" } as CollaboratingItem;
    vi.mocked(issuesApi.collaborating).mockResolvedValue([item]);
    await act(async () => { await get().refreshCollaborations(); });
    expect(get().data.collaborations.map((c) => c.issueId)).toEqual([I9]);
    vi.mocked(issuesApi.collaborating).mockRejectedValue(new Error("x"));
    await act(async () => { await get().refreshCollaborations(); });
    expect(get().data.collaborations.map((c) => c.issueId)).toEqual([I9]);
  });
});

describe("switchProject — успех, guard'ы, ошибка", () => {
  test("успех: данные нового проекта, выбранная задача снята, ready, проект запомнен", async () => {
    const { get } = await readyInP1();
    act(() => get().switchProject(P2));
    expect(get().bootStatus).toBe("loading");
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().ui.selectedIssueId).toBeNull();
    expect(localStorage.getItem("taskira.project")).toBe(P2);
  });

  test("тот же проект или проекта нет в списке — запроса нет, статус не меняется", async () => {
    const { get, getSpy } = await readyInP1();
    const calls = getSpy.mock.calls.length;
    act(() => get().switchProject(P1));
    act(() => get().switchProject("нет-такого"));
    await settle();
    expect(getSpy.mock.calls.length).toBe(calls);
    expect(get().bootStatus).toBe("ready");
  });

  test("ошибка загрузки нового проекта: остаёмся в старом, статус ready", async () => {
    const { get, getSpy } = await readyInP1();
    getSpy.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "boom"));
    act(() => get().switchProject(P2));
    await settle();
    expect(get().bootStatus).toBe("ready");
    expect(get().data.currentProjectId).toBe(P1);
  });
});

describe("switchProject — гонки (switchSeqRef)", () => {
  test("два переключения подряд, ответы в обратном порядке: побеждает ПОСЛЕДНИЙ клик, устаревший ответ отброшен", async () => {
    const d2 = defer<ProjectBootstrap>();
    const d3 = defer<ProjectBootstrap>();
    const { get, getSpy } = await readyInP1();
    getSpy.mockImplementation((id: string) => (id === P2 ? d2.promise : d3.promise));
    act(() => get().switchProject(P2));
    act(() => get().switchProject(P3));
    expect(get().bootStatus).toBe("loading");
    await act(async () => { d3.resolve(boot(projects[2])); });
    await settle();
    expect(get().data.currentProjectId).toBe(P3);
    expect(get().bootStatus).toBe("ready");
    await act(async () => { d2.resolve(boot(projects[1])); });
    await settle();
    expect(get().data.currentProjectId).toBe(P3); // запоздавший ответ P2 не перетёр
    expect(get().bootStatus).toBe("ready");
  });

  test("два переключения, первый ответ пришёл раньше второго: применяется только второй; до его прихода — loading", async () => {
    const d2 = defer<ProjectBootstrap>();
    const d3 = defer<ProjectBootstrap>();
    const { get, getSpy } = await readyInP1();
    getSpy.mockImplementation((id: string) => (id === P2 ? d2.promise : d3.promise));
    act(() => get().switchProject(P2));
    act(() => get().switchProject(P3));
    await act(async () => { d2.resolve(boot(projects[1])); });
    await settle();
    expect(get().data.currentProjectId).toBe(P1); // ответ P2 устарел и отброшен
    expect(get().bootStatus).toBe("loading");
    await act(async () => { d3.resolve(boot(projects[2])); });
    await settle();
    expect(get().data.currentProjectId).toBe(P3);
    expect(get().bootStatus).toBe("ready");
  });

  test("ошибка устаревшего запроса не показывает тост и не сбрасывает loading последнего", async () => {
    const d2 = defer<ProjectBootstrap>();
    const d3 = defer<ProjectBootstrap>();
    const { get, getSpy } = await readyInP1();
    getSpy.mockImplementation((id: string) => (id === P2 ? d2.promise : d3.promise));
    act(() => get().switchProject(P2));
    act(() => get().switchProject(P3));
    await act(async () => { d2.reject(new ApiError(500, "INTERNAL", "boom")); });
    await settle();
    expect(get().bootStatus).toBe("loading");
    expect(get().toasts.filter((t) => t.kind === "error")).toEqual([]); // (info-тост «главный экран» от bootstrap — не в счёт)
  });
});

describe("pendingOpenIssueRef — открыть задачу после переключения", () => {
  test("switchProject(P2, задача) → после загрузки P2 открывается эта задача (GET именно с проектом P2)", async () => {
    const { get } = await readyInP1();
    const getIssue = vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I9, P2));
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    act(() => get().switchProject(P2, I9));
    await settle();
    await settle();
    expect(getIssue).toHaveBeenCalledWith(P2, I9);
    expect(get().ui.selectedIssueId).toBe(I9);
  });

  test("обычное переключение (без openIssueId) отменяет ранее поставленное намерение", async () => {
    const { get } = await readyInP1();
    const getIssue = vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I9, P2));
    act(() => get().switchProject(P2, I9));
    act(() => get().switchProject(P3));
    await settle();
    await settle();
    expect(get().data.currentProjectId).toBe(P3);
    expect(getIssue).not.toHaveBeenCalled();
    expect(get().ui.selectedIssueId).toBeNull();
    // сценарий из комментария в коде: позже обычный возврат в тот же проект не должен внезапно открыть давнюю задачу
    act(() => get().switchProject(P2));
    await settle();
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(getIssue).not.toHaveBeenCalled();
    expect(get().ui.selectedIssueId).toBeNull();
  });
});

describe("refreshIssues / ensureAllIssues", () => {
  test("частичный стор: refreshIssues сети не трогает, только растёт issuesRevision", async () => {
    const { get, listSpy } = await readyInP1();
    const [calls, rev] = [listSpy.mock.calls.length, get().issuesRevision];
    // refreshIssues наружу не отдаётся; его вызывает moveStatus при ошибке — воспроизводим через неё
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I1));
    vi.spyOn(issuesApi, "transition").mockRejectedValue(new ApiError(409, "CONFLICT", "нет"));
    await act(async () => { await get().lookupIssue(I1); });
    act(() => get().moveStatus(I1, "s1"));
    await settle();
    expect(listSpy.mock.calls.length).toBe(calls);
    expect(get().issuesRevision).toBeGreaterThan(rev);
    expect(get().data.issuesComplete).toBe(false);
  });

  test("ensureAllIssues: два одновременных вызова — один обход; повтор после завершения — без сети; слияние оставляет «лишние» известные задачи", async () => {
    const { get, listSpy } = await readyInP1({ issues: [dto(I1)] });
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I9)); // открытая задача, которой нет в списке (например, архивная)
    await act(async () => { await get().lookupIssue(I9); });
    const c0 = listSpy.mock.calls.length;
    await act(async () => { await Promise.all([get().ensureAllIssues(), get().ensureAllIssues()]); });
    expect(listSpy.mock.calls.length).toBe(c0 + 1);
    expect(get().data.issuesComplete).toBe(true);
    expect(get().data.issues.map((i) => i.id).sort()).toEqual([I1, I9].sort());
    await act(async () => { await get().ensureAllIssues(); });
    expect(listSpy.mock.calls.length).toBe(c0 + 1);
  });

  test("ensureAllIssues: ответ пришёл после переключения проекта — в новый проект не попадает, issuesComplete остаётся false", async () => {
    const dl = defer<{ items: ServerIssue[]; hasMore: boolean; nextCursor: string | null }>();
    const { get, listSpy } = await readyInP1();
    listSpy.mockReturnValue(dl.promise as never);
    let run!: Promise<void>;
    act(() => { run = get().ensureAllIssues(); });
    act(() => get().switchProject(P2));
    await settle();
    await act(async () => { dl.resolve({ items: [dto(I1, P1)], hasMore: false, nextCursor: null }); await run; });
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().data.issues).toEqual([]);
    expect(get().data.issuesComplete).toBe(false);
  });

  test("ensureAllIssues: ошибка → тост, флаг «в полёте» снят (повтор снова идёт в сеть)", async () => {
    const { get, listSpy } = await readyInP1();
    listSpy.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "boom"));
    await act(async () => { await get().ensureAllIssues(); });
    expect(get().data.issuesComplete).toBe(false);
    expect(get().toasts.length).toBeGreaterThan(0);
    const c = listSpy.mock.calls.length;
    await act(async () => { await get().ensureAllIssues(); });
    expect(listSpy.mock.calls.length).toBe(c + 1);
    expect(get().data.issuesComplete).toBe(true);
  });
});

describe("openIssue", () => {
  test("null: карточка закрывается, запросов нет", async () => {
    const { get } = await readyInP1();
    const getIssue = vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I1));
    act(() => get().openIssue(null));
    await settle();
    expect(get().ui.selectedIssueId).toBeNull();
    expect(getIssue).not.toHaveBeenCalled();
  });

  test("комментарии и история упали — карточка всё равно открывается с пустыми списками; ошибка самой задачи — тост", async () => {
    const { get } = await readyInP1();
    vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I1));
    vi.spyOn(commentsApi, "list").mockRejectedValue(new Error("x"));
    vi.spyOn(issuesApi, "activity").mockRejectedValue(new Error("x"));
    act(() => get().openIssue(I1));
    await settle();
    const opened = get().data.issues.find((i) => i.id === I1)!;
    expect([opened.comments, opened.activity]).toEqual([[], []]);
    vi.mocked(issuesApi.get).mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    act(() => get().openIssue(I9));
    await settle();
    expect(get().data.issues.find((i) => i.id === I9)).toBeUndefined();
    expect(get().toasts.length).toBeGreaterThan(0);
  });

  test("ответ пришёл после переключения проекта — в стор нового проекта не попадает", async () => {
    const dg = defer<ServerIssue>();
    const { get } = await readyInP1();
    vi.spyOn(issuesApi, "get").mockReturnValue(dg.promise);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    act(() => get().openIssue(I1));
    act(() => get().switchProject(P2));
    await settle();
    await act(async () => { dg.resolve(dto(I1, P1)); });
    await settle();
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().data.issues.find((i) => i.id === I1)).toBeUndefined();
  });

  test("lookupIssue: ответ после смены проекта в стор не попадает", async () => {
    const dg = defer<ServerIssue>();
    const { get } = await readyInP1();
    vi.spyOn(issuesApi, "get").mockReturnValue(dg.promise);
    let p!: Promise<unknown>;
    act(() => { p = get().lookupIssue(I1); });
    act(() => get().switchProject(P2));
    await settle();
    await act(async () => { dg.resolve(dto(I1, P1)); await p; });
    expect(get().data.issues.find((i) => i.id === I1)).toBeUndefined();
  });
});

describe("гонки с logout", () => {
  test("openIssue, затем logout; ответ приходит позже — данные после выхода не появляются", async () => {
    const dg = defer<ServerIssue>();
    const { get } = await readyInP1();
    vi.spyOn(issuesApi, "get").mockReturnValue(dg.promise);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    act(() => get().openIssue(I1));
    act(() => get().logout());
    await act(async () => { dg.resolve(dto(I1, P1)); });
    await settle();
    expect(get().bootStatus).toBe("unauthenticated");
    expect(get().data.issues).toEqual([]);
  });

  test("openIssue ПОСЛЕ logout (клик по устаревшему элементу): запрос уходит с ПУСТЫМ id проекта, а guard «проект не сменился» пропускает ответ (\"\" === \"\") — задача попадает в сброшенный стор", async () => {
    const { get } = await readyInP1();
    act(() => get().logout());
    const getIssue = vi.spyOn(issuesApi, "get").mockResolvedValue(dto(I1, P1));
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    act(() => get().openIssue(I1));
    await settle();
    expect(getIssue).toHaveBeenCalledWith("", I1); // фиксируем как есть: pid() после выхода — пустая строка
    // ТЕКУЩЕЕ поведение: на реальном сервере запрос вернул бы 401 (токен отозван), но защита от «ответ пришёл не туда»
    // здесь сравнивает пустые строки и пропускает — стор после выхода принимает задачу.
    expect(get().data.issues.map((i) => i.id)).toEqual([I1]);
  });

  test("НАХОДКА (SEC): switchProject, ответивший ПОСЛЕ logout, воскрешает данные — logout не отменяет запоздавший переход", async () => {
    const d2 = defer<ProjectBootstrap>();
    const { get, getSpy } = await readyInP1();
    getSpy.mockReturnValue(d2.promise);
    act(() => get().switchProject(P2));
    act(() => get().logout());
    expect(get().bootStatus).toBe("unauthenticated");
    await act(async () => { d2.resolve(boot(projects[1])); });
    await settle();
    // ТЕКУЩЕЕ поведение (баг): данные проекта и статус ready вернулись уже после выхода.
    expect(get().data.currentProjectId).toBe(P2);
    expect(get().bootStatus).toBe("ready");
  });

  test("НАХОДКА (SEC): bootstrap, запущенный до logout и завершившийся после, тоже воскрешает данные", async () => {
    const dm = defer<unknown>();
    install();
    vi.mocked(authApi.me).mockReturnValue(dm.promise as never);
    const get = mount();
    let run!: Promise<void>;
    act(() => { run = get().bootstrap(); });
    act(() => get().logout());
    expect(get().bootStatus).toBe("unauthenticated");
    await act(async () => { dm.resolve(user()); await run; });
    await settle();
    // ТЕКУЩЕЕ поведение (баг): после выхода статус снова не unauthenticated.
    expect(get().bootStatus).not.toBe("unauthenticated");
    expect(get().data.currentUserId).toBe("u1");
  });
});
