import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type IssueFilterParams,
  type IssuePageParams,
  type ProjectBootstrap,
  type ProjectRole,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import { ISSUE_PAGE_SIZE } from "./issuePages";
import Board from "./components/Board";

/**
 * ТЗ 5.12 c — доска будет визуально переписана. Эти тесты фиксируют её
 * ПОВЕДЕНИЕ (не разметку/классы), чтобы пережить рефакторинг JSX:
 *
 *  1. ленивая загрузка по колонкам — своя первая страница на статус, подгрузка
 *     следующей по «Показать ещё» (PERF-05-step2-3-client.md);
 *  2. число в шапке колонки — из `issuesApi.counts`, а не из числа загруженных
 *     карточек;
 *  3. серверные фильтры доски (чипы «Мои»/«Просрочено», поиск с debounce) —
 *     параметры запроса, а не фильтрация загруженного;
 *  4. карточка показывает ключ/заголовок/исполнителя/метки и открывает задачу
 *     по клику (ui.selectedIssueId стора);
 *  5. просроченная открытая задача помечена доступным сигналом (title на
 *     пилюле срока), не только цветом;
 *  6. роль viewer — доска только для чтения: баннер есть, быстрое создание
 *     не предлагается;
 *  7. колонка «Готово» по умолчанию — окно DONE_WINDOW_DAYS (параметр
 *     closed=recent&closedDays=14 в запросе страницы), «Ранее закрыто»
 *     снимает окно.
 *
 * Перетаскивание мышью не проверяется — HTML5 DnD не воспроизводим в jsdom
 * содержательно (см. `board.lookups.test.tsx`, которая уже покрывает то,
 * что можно проверить синтетическими dragOver/dragStart событиями отдельно
 * от этого файла); список того, что осознанно не покрыто, — в отчёте.
 */

const user1 = {
  id: "u1",
  username: "u1",
  name: "Анна Иванова",
  initials: "АИ",
  color: "#0B5FD9",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
};
const user2 = {
  id: "u2",
  username: "u2",
  name: "Борис Петров",
  initials: "БП",
  color: "#D9750B",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
};

const project = {
  id: "p1",
  key: "A21",
  name: "Проект",
  description: "",
  departmentId: "d1",
  isShared: false,
  sprintsEnabled: false,
  defaultView: null,
  suggestedLabels: [],
  icon: null,
  color: null,
  background: null,
  isDemo: false,
};

/** todo/inprogress/done — три статуса, чтобы колонки были независимы друг от друга. */
const STATUSES = [
  { id: "s1", sid: "todo", name: "К работе", category: "todo" as const, position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress" as const, position: 1 },
  { id: "s3", sid: "done", name: "Готово", category: "done" as const, position: 2 },
];

const bootWith = (role: ProjectRole): ProjectBootstrap => ({
  project,
  users: [user1, user2] as never,
  members: [{ userId: "u1", role }],
  workflow: { statuses: STATUSES, transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
});

const dto = (id: string, over: Partial<ServerIssue> = {}): ServerIssue =>
  ({
    id,
    key: `A21-${id}`,
    title: `Задача ${id}`,
    description: "",
    typeId: "task",
    statusId: "s1",
    priorityId: "medium",
    assigneeIds: [],
    reporterId: "u1",
    epicId: null,
    parentId: null,
    labels: [],
    complexity: null,
    dueDate: null,
    rank: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); await flush(); await flush(); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** SEARCH_DEBOUNCE_MS в Board.tsx = 250. */
const settleDebounce = () => act(async () => { await wait(320); });

interface Setup {
  role?: ProjectRole;
  pageImpl: (projectId: string, params: IssuePageParams) => Promise<{ items: ServerIssue[]; hasMore: boolean; nextCursor: string | null }>;
  countsImpl?: (projectId: string, params: IssueFilterParams) => Promise<{ total: number; byStatus: Record<string, number> }>;
}

async function setup({ role = "manager", pageImpl, countsImpl }: Setup) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user1 as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootWith(role));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  vi.spyOn(issuesApi, "assignees").mockResolvedValue({ items: [] });
  vi.spyOn(issuesApi, "epics").mockResolvedValue({ items: [], truncated: false });
  vi.spyOn(issuesApi, "get").mockImplementation(async (_p, id) => dto(id));
  vi.spyOn(commentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "activity").mockResolvedValue([]);

  const pageCalls: IssuePageParams[] = [];
  const pageSpy = vi.spyOn(issuesApi, "page").mockImplementation(async (p, params) => {
    pageCalls.push(params);
    return pageImpl(p, params);
  });

  const countsCalls: IssueFilterParams[] = [];
  const defaultCounts = async () => ({ total: 0, byStatus: {} as Record<string, number> });
  const countsSpy = vi.spyOn(issuesApi, "counts").mockImplementation(async (p, params) => {
    countsCalls.push(params);
    return (countsImpl ?? defaultCounts)(p, params);
  });

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        <Board />
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree);
  await act(async () => {
    await store.bootstrap();
  });
  await settle();
  return { ui, store: () => store, pageCalls, countsCalls, pageSpy, countsSpy };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Board — характеризующие тесты (ТЗ 5.12 c, до переписывания JSX)", () => {
  test("1. каждая колонка запрашивает свою первую страницу по своему статусу", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => ({
        items: params.status === "s1" ? [dto("t1", { statusId: "s1" })] : params.status === "s2" ? [dto("t2", { statusId: "s2" })] : [],
        hasMore: false,
        nextCursor: null,
      }),
    });
    const s1Calls = h.pageCalls.filter((c) => c.status === "s1");
    const s2Calls = h.pageCalls.filter((c) => c.status === "s2");
    const s3Calls = h.pageCalls.filter((c) => c.status === "s3");
    expect(s1Calls.length).toBeGreaterThanOrEqual(1);
    expect(s2Calls.length).toBeGreaterThanOrEqual(1);
    expect(s3Calls.length).toBeGreaterThanOrEqual(1);
    // общая форма запроса первой страницы: сортировка по рангу, лимит страницы, без курсора
    expect(s1Calls[0]).toMatchObject({ status: "s1", sort: "rank", dir: "asc", limit: ISSUE_PAGE_SIZE });
    expect(s1Calls[0].cursor).toBeUndefined();
    expect(screen.getByRole("article", { name: /A21-t1/ })).toBeTruthy();
    expect(screen.getByRole("article", { name: /A21-t2/ })).toBeTruthy();
    h.ui.unmount();
  });

  test("2. колонка с задачами сверх страницы подгружает следующую по «Показать ещё»", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => {
        if (params.status !== "s1") return { items: [], hasMore: false, nextCursor: null };
        if (!params.cursor) return { items: [dto("a1", { statusId: "s1" })], hasMore: true, nextCursor: "cursor-2" };
        return { items: [dto("a2", { statusId: "s1" })], hasMore: false, nextCursor: null };
      },
    });
    expect(screen.getByRole("article", { name: /A21-a1/ })).toBeTruthy();
    expect(screen.queryByRole("article", { name: /A21-a2/ })).toBeNull();

    const loadMore = screen.getByRole("button", { name: "Показать ещё" });
    fireEvent.click(loadMore);
    await settle();

    expect(screen.getByRole("article", { name: /A21-a2/ })).toBeTruthy();
    const s1Calls = h.pageCalls.filter((c) => c.status === "s1");
    expect(s1Calls[s1Calls.length - 1].cursor).toBe("cursor-2");
    h.ui.unmount();
  });

  test("3. число в шапке колонки идёт со счётчика сервера, а не со списка загруженных карточек", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => ({
        items: params.status === "s1" ? [dto("c1", { statusId: "s1" })] : [], // одна карточка загружена…
        hasMore: false,
        nextCursor: null,
      }),
      countsImpl: async (_p, params) =>
        params.closed === "older" ? { total: 0, byStatus: {} as Record<string, number> } : { total: 99, byStatus: { s1: 57, s2: 0, s3: 0 } as Record<string, number> }, // …а счётчик другой
    });
    // Имя стандартного статуса переводится словарём (workflowStatusName) — берём первую колонку (todo).
    const column = screen.getAllByRole("region")[0];
    expect(within(column).getByText("57")).toBeTruthy();
    expect(within(column).getAllByRole("article")).toHaveLength(1);
    h.ui.unmount();
  });

  test("4a. чип «Мои задачи» переводится в assignee = текущий пользователь во всех запросах страниц", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Мои задачи" }));
    await settle();
    expect(h.pageCalls.length).toBeGreaterThan(0);
    for (const c of h.pageCalls) expect(c.assignee).toBe("u1");
    h.ui.unmount();
  });

  test("4b. чип «Просрочено» переводится в overdue=1 во всех запросах страниц", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Просрочено" }));
    await settle();
    expect(h.pageCalls.length).toBeGreaterThan(0);
    for (const c of h.pageCalls) expect(c.overdue).toBe("1");
    h.ui.unmount();
  });

  test("4c. текст поиска уходит в q после задержки (debounce), не на каждый ввод", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    const input = screen.getByPlaceholderText("Фильтр по доске");
    fireEvent.change(input, { target: { value: "billing" } });
    // сразу после ввода — ещё ничего не ушло с текстом (debounce не истёк)
    await settle();
    expect(h.pageCalls.some((c) => c.q === "billing")).toBe(false);
    await settleDebounce();
    expect(h.pageCalls.some((c) => c.q === "billing")).toBe(true);
    h.ui.unmount();
  });

  test("5. карточка показывает ключ, заголовок, исполнителя и метки; клик по карточке открывает задачу", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        params.status === "s1"
          ? {
              items: [dto("k1", { statusId: "s1", title: "Починить биллинг", assigneeIds: ["u2"], labels: ["billing", "urgent"] })],
              hasMore: false,
              nextCursor: null,
            }
          : { items: [], hasMore: false, nextCursor: null },
    });
    const card = screen.getByRole("article", { name: /A21-k1: Починить биллинг/ });
    expect(within(card).getByText("Починить биллинг")).toBeTruthy();
    expect(within(card).getByText("billing")).toBeTruthy();
    // исполнитель — доступное имя через title на аватаре (initials видимый текст "БП")
    expect(within(card).getByTitle("Борис Петров")).toBeTruthy();
    expect(within(card).getByText("БП")).toBeTruthy();

    expect(h.store().ui.selectedIssueId).toBeNull();
    fireEvent.click(card);
    await settle();
    expect(h.store().ui.selectedIssueId).toBe("k1");
    h.ui.unmount();
  });

  test("6. просроченная открытая задача помечена доступным сигналом (title на пилюле срока)", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        params.status === "s1"
          ? { items: [dto("d1", { statusId: "s1", dueDate: "2020-01-01" })], hasMore: false, nextCursor: null }
          : { items: [], hasMore: false, nextCursor: null },
    });
    const card = screen.getByRole("article", { name: /A21-d1/ });
    // единственный наблюдаемый в разметке сигнал просрочки — title="Просрочено" на пилюле срока
    expect(within(card).getByTitle("Просрочено")).toBeTruthy();
    h.ui.unmount();
  });

  test("7. роль viewer: доска только для чтения — баннер есть, быстрое создание не предлагается", async () => {
    const h = await setup({ role: "viewer", pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    expect(screen.getByText(/Режим «только чтение»/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Задача" })).toBeNull();
    expect(screen.queryByLabelText(/^Добавить в /)).toBeNull();
    h.ui.unmount();
  });

  test("8a. колонка «Готово» по умолчанию запрашивает только окно DONE_WINDOW_DAYS (closed=recent&closedDays=14)", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => ({ items: params.status === "s3" ? [dto("done1", { statusId: "s3" })] : [], hasMore: false, nextCursor: null }),
      countsImpl: async (_p, params) => (params.closed === "older" ? { total: 5, byStatus: { s3: 5 } as Record<string, number> } : { total: 10, byStatus: { s1: 0, s2: 0, s3: 6 } as Record<string, number> }),
    });
    const s3Calls = h.pageCalls.filter((c) => c.status === "s3");
    expect(s3Calls.length).toBeGreaterThanOrEqual(1);
    expect(s3Calls[0]).toMatchObject({ status: "s3", closed: "recent", closedDays: 14 });
    // строка «Ранее закрыто: N» показана по счётчику older, не по числу загруженных карточек
    expect(screen.getByText("Ранее закрыто: 5")).toBeTruthy();
    h.ui.unmount();
  });

  test("8b. «Ранее закрыто» снимает окно и перечитывает колонку «Готово» без closed-фильтра", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => ({ items: params.status === "s3" ? [dto("done1", { statusId: "s3" })] : [], hasMore: false, nextCursor: null }),
      countsImpl: async (_p, params) => (params.closed === "older" ? { total: 5, byStatus: { s3: 5 } as Record<string, number> } : { total: 10, byStatus: { s1: 0, s2: 0, s3: 6 } as Record<string, number> }),
    });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByText("Ранее закрыто: 5"));
    await settle();
    const s3Calls = h.pageCalls.filter((c) => c.status === "s3");
    expect(s3Calls.length).toBeGreaterThan(0);
    expect(s3Calls[s3Calls.length - 1].closed).toBeUndefined();
    expect(s3Calls[s3Calls.length - 1].closedDays).toBeUndefined();
    // теперь предложено свернуть обратно к окну в 14 дней
    expect(screen.getByText("Свернуть до последних 14 дней")).toBeTruthy();
    h.ui.unmount();
  });
});
