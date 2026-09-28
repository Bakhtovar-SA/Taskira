import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoreProvider, useStore, useToasts } from "./store";
import {
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  savedViewsApi,
  type BulkAction,
  type IssueFilterParams,
  type IssuePageParams,
  type ProjectBootstrap,
  type ProjectRole,
  type SavedViewInput,
  type ServerIssue,
  type ServerSavedView,
} from "./api";
import { I18nProvider } from "./i18n";
import Backlog from "./components/Backlog";

/**
 * ТЗ 5.12 e — «Список задач» будет переписан в таблицу с настраиваемыми
 * колонками. Эти тесты фиксируют его текущее ПОВЕДЕНИЕ (не разметку/классы),
 * чтобы пережить переписывание JSX — тот же принцип, что
 * `board.characterize.test.tsx`:
 *
 *  1. фильтры (статус/исполнитель/тип/приоритет/метка/просроченные/показывать
 *     закрытые/поиск) уходят как параметры серверного запроса, а не фильтруют
 *     уже загруженное; состояние отражается в URL (query string) и «Сбросить»
 *     чистит и то, и другое;
 *  2. смена сортировки/направления меняет sort/dir в запросах;
 *  3. пагинация: страница сверх ISSUE_PAGE_SIZE подгружается по «Показать
 *     ещё», «Показаны все задачи (N)», когда доступа больше нет;
 *  4. строка показывает ключ и заголовок, клик открывает задачу
 *     (ui.selectedIssueId стора);
 *  5. режим выделения и массовые операции — «Выделить» → две строки →
 *     статус/исполнитель/приоритет зовут bulk API с этими id и значением;
 *     удаление требует подтверждения; результат — тост с текстом из
 *     store/issueCrud.ts (полный/частичный успех);
 *  6. сохранённые вьюхи — список тянется через savedViewsApi.list, выбор
 *     применяет фильтры вьюхи, «Сохранить как вьюху» зовёт .create с текущими
 *     фильтрами, удаление — .remove;
 *  7. роль viewer — нет кнопки импорта и кнопки создания в шапке/эмпти-стейте,
 *     нет массового удаления;
 *  8. эмпти-стейты — без задач (с кнопкой создания, когда разрешено) и
 *     «ничего не найдено» по активным фильтрам (с кнопкой сброса).
 *
 * Тосты не рендерятся в DOM (в дереве только `<Backlog/>`, без `<Toasts/>`) —
 * читаются из внешнего хранилища `useToasts()`, как в `issueModal.lookups.test.tsx`.
 *
 * Сознательно НЕ покрыто (см. отчёт):
 *  - реальная прокрутка/IntersectionObserver — в jsdom он не определён,
 *    `useLoadMoreSentinel` тогда не срабатывает (см. комментарий в самом
 *    хуке); подгрузка проверяется только через кнопку-заглушку «Показать ещё».
 *  - `PATCH .../saved-views/:id` (переименование/обновление вьюхи) — в UI нет
 *    точки входа, вызывающей `savedViewsApi.update`.
 *  - drag & drop (в «Списке задач» его и не было — своя колонка для доски).
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
  backgroundPhoto: null,
  isDemo: false,
};

const STATUSES = [
  { id: "s1", sid: "todo", name: "К выполнению", category: "todo" as const, position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress" as const, position: 1 },
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
/** SEARCH_DEBOUNCE_MS в Backlog.tsx = 250. */
const settleDebounce = () => act(async () => { await wait(320); });

/** `useStore()` + тосты — тосты вынесены во внешнее хранилище (ADR-0011), в
 *  дереве этих тестов нет `<Toasts/>`, поэтому читаем их напрямую. */
function useStoreSnapshot() {
  return { ...useStore(), toasts: useToasts() };
}

type BulkResultLike = { succeeded: string[]; failed: { issueId: string; reason: string }[] };

interface Setup {
  role?: ProjectRole;
  pageImpl: (projectId: string, params: IssuePageParams) => Promise<{ items: ServerIssue[]; hasMore: boolean; nextCursor: string | null }>;
  countsImpl?: (projectId: string, params: IssueFilterParams) => Promise<{ total: number; byStatus: Record<string, number> }>;
  views?: ServerSavedView[];
  bulkImpl?: (body: BulkAction) => Promise<BulkResultLike>;
}

async function setup({ role = "manager", pageImpl, countsImpl, views, bulkImpl }: Setup) {
  history.pushState(null, "", "/p/A21/list");
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
  vi.spyOn(issuesApi, "page").mockImplementation(async (p, params) => {
    pageCalls.push(params);
    return pageImpl(p, params);
  });

  const countsCalls: IssueFilterParams[] = [];
  const defaultCounts = async () => ({ total: 0, byStatus: {} as Record<string, number> });
  vi.spyOn(issuesApi, "counts").mockImplementation(async (p, params) => {
    countsCalls.push(params);
    return (countsImpl ?? defaultCounts)(p, params);
  });

  const bulkCalls: BulkAction[] = [];
  const defaultBulk = async (body: BulkAction): Promise<BulkResultLike> => ({ succeeded: [...body.issueIds], failed: [] });
  vi.spyOn(issuesApi, "bulk").mockImplementation(async (_p, body) => {
    bulkCalls.push(body);
    return (bulkImpl ?? defaultBulk)(body);
  });

  vi.spyOn(savedViewsApi, "list").mockResolvedValue(views ?? []);
  const viewsCreateCalls: SavedViewInput[] = [];
  vi.spyOn(savedViewsApi, "create").mockImplementation(async (_p, body) => {
    viewsCreateCalls.push(body);
    return { id: "v-new", name: body.name, filter: body.filter, isDefault: body.isDefault, createdAt: "now", updatedAt: "now" } as ServerSavedView;
  });
  const viewsRemoveCalls: string[] = [];
  vi.spyOn(savedViewsApi, "remove").mockImplementation(async (_p, id) => {
    viewsRemoveCalls.push(id);
  });

  let store!: ReturnType<typeof useStoreSnapshot>;
  function Grab() {
    store = useStoreSnapshot();
    return null;
  }
  const tree = (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        <Backlog />
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree);
  await act(async () => {
    await store.bootstrap();
  });
  await settle();
  return { ui, store: () => store, pageCalls, countsCalls, bulkCalls, viewsCreateCalls, viewsRemoveCalls };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.pushState(null, "", "/");
});

describe("Список задач — характеризующие тесты (ТЗ 5.12 e, до переписывания в таблицу)", () => {
  test("0. шапка показывает total из серверного счётчика, а не из числа загруженных строк", async () => {
    const h = await setup({
      pageImpl: async () => ({ items: [dto("h1")], hasMore: false, nextCursor: null }),
      countsImpl: async () => ({ total: 42, byStatus: {} }),
    });
    expect(screen.getByText("1 из 42 активных задач")).toBeTruthy();
    h.ui.unmount();
  });

  test("1a. пустые фильтры по умолчанию скрывают закрытые (closed=hide) в каждом запросе страницы", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    expect(h.pageCalls.length).toBeGreaterThan(0);
    expect(h.pageCalls[0]).toMatchObject({ closed: "hide", sort: "priority", dir: "asc" });
    expect(h.pageCalls[0].status).toBeUndefined();
    h.ui.unmount();
  });

  test("1b. статус/исполнитель/тип/приоритет/метка уходят как параметры запроса и в URL; выбранный статус снимает closed=hide", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    const [statusSel, assigneeSel, typeSel, prioritySel] = screen.getAllByRole("combobox");
    fireEvent.change(statusSel, { target: { value: "s1" } });
    await settle();
    fireEvent.change(assigneeSel, { target: { value: "u2" } });
    await settle();
    fireEvent.change(typeSel, { target: { value: "bug" } });
    await settle();
    fireEvent.change(prioritySel, { target: { value: "high" } });
    await settle();
    fireEvent.change(screen.getByPlaceholderText("Метка"), { target: { value: "billing" } });
    await settle();

    const last = h.pageCalls[h.pageCalls.length - 1];
    expect(last).toMatchObject({ status: "s1", assignee: "u2", type: "bug", priority: "high", label: "billing" });
    // явно выбранный статус важнее общего переключателя «показывать закрытые» (комментарий в Backlog.tsx)
    expect(last.closed).toBeUndefined();

    const qs = new URLSearchParams(location.search);
    expect(qs.get("status")).toBe("s1");
    expect(qs.get("assignee")).toBe("u2");
    expect(qs.get("type")).toBe("bug");
    expect(qs.get("priority")).toBe("high");
    expect(qs.get("label")).toBe("billing");
    h.ui.unmount();
  });

  test("1c. чекбоксы «Просроченные»/«Показывать закрытые» уходят как overdue=1 и снимают closed=hide; отражены в URL", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByLabelText("Просроченные"));
    await settle();
    fireEvent.click(screen.getByLabelText("Показывать закрытые"));
    await settle();

    const last = h.pageCalls[h.pageCalls.length - 1];
    expect(last.overdue).toBe("1");
    expect(last.closed).toBeUndefined();
    const qs = new URLSearchParams(location.search);
    expect(qs.get("overdue")).toBe("1");
    expect(qs.get("done")).toBe("1");
    h.ui.unmount();
  });

  test("1d. текст поиска уходит в q после задержки (debounce), не на каждый ввод", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    const input = screen.getByPlaceholderText("Поиск по названию или ключу");
    fireEvent.change(input, { target: { value: "billing" } });
    await settle();
    expect(h.pageCalls.some((c) => c.q === "billing")).toBe(false);
    await settleDebounce();
    expect(h.pageCalls.some((c) => c.q === "billing")).toBe(true);
    h.ui.unmount();
  });

  test("1e. «Сбросить» очищает фильтры (виден только когда что-то активно) и URL", async () => {
    // непустой результат — иначе список параллельно показал бы свою собственную
    // кнопку «Сбросить» в эмпти-стейте (см. 8b), и заголовочная стала бы не
    // единственной с таким именем.
    const h = await setup({ pageImpl: async () => ({ items: [dto("z1")], hasMore: false, nextCursor: null }) });
    expect(screen.queryByRole("button", { name: "Сбросить" })).toBeNull();
    const [statusSel] = screen.getAllByRole("combobox");
    fireEvent.change(statusSel, { target: { value: "s1" } });
    await settle();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await settle();
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Сбросить" })).toBeNull();
    const qs = new URLSearchParams(location.search);
    expect(qs.get("status")).toBeNull();
    h.ui.unmount();
  });

  test("2a. выбор пункта сортировки меняет sort в каждом следующем запросе", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    // по умолчанию отсортировано по приоритету — заголовок кнопки сортировки = «Приоритет»
    fireEvent.click(screen.getByRole("button", { name: "Приоритет" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ключ" }));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ sort: "key", dir: "asc" });
    h.ui.unmount();
  });

  test("ТЗ 5.12 e: таблица — заголовок сортирует (повторный клик меняет направление), колонки скрываются и запоминаются", async () => {
    localStorage.removeItem("taskira.list.columns");
    const h = await setup({ pageImpl: async () => ({ items: [dto("r1")], hasMore: false, nextCursor: null }) });
    const head = () => within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(head().some((c) => c.textContent === "Срок")).toBe(true);
    h.pageCalls.length = 0;
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Срок" }));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ sort: "due", dir: "asc" });
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Срок" }));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ sort: "due", dir: "desc" });

    fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Метки" }));
    expect(head().some((c) => c.textContent === "Метки")).toBe(false);
    expect(JSON.parse(localStorage.getItem("taskira.list.columns")!)).not.toContain("labels");
    localStorage.removeItem("taskira.list.columns");
    h.ui.unmount();
  });

  test("2b. переключатель направления меняет dir; выбор «Обновление» сам переключает направление на убывание", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Направление сортировки" }));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ sort: "priority", dir: "desc" });

    fireEvent.click(screen.getByRole("button", { name: "Приоритет" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Обновление" }));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ sort: "updated", dir: "desc" });
    h.ui.unmount();
  });

  test("3. подгрузка следующей страницы по «Показать ещё»; «Показаны все задачи (N)», когда доступа больше нет", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => {
        if (!params.cursor) return { items: [dto("a1"), dto("a2")], hasMore: true, nextCursor: "cur-2" };
        return { items: [dto("a3")], hasMore: false, nextCursor: null };
      },
      countsImpl: async () => ({ total: 3, byStatus: {} }),
    });
    expect(document.querySelectorAll("[data-issue-id]")).toHaveLength(2);
    expect(screen.queryByText(/Показаны все задачи/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    await settle();

    expect(document.querySelectorAll("[data-issue-id]")).toHaveLength(3);
    expect(screen.getByText("Показаны все задачи (3)")).toBeTruthy();
    const lastCall = h.pageCalls[h.pageCalls.length - 1];
    expect(lastCall.cursor).toBe("cur-2");
    h.ui.unmount();
  });

  test("4. строка показывает ключ и заголовок; клик по строке открывает задачу (ui.selectedIssueId)", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        !params.cursor
          ? { items: [dto("k1", { title: "Починить биллинг" })], hasMore: false, nextCursor: null }
          : { items: [], hasMore: false, nextCursor: null },
    });
    const row = document.querySelector('[data-issue-id="k1"]') as HTMLElement;
    expect(row).toBeTruthy();
    // Ключ — в своей колонке и (для телефона, скрыт на широком экране) над названием.
    expect(within(row).getAllByText("A21-k1").length).toBeGreaterThan(0);
    expect(within(row).getByText("Починить биллинг")).toBeTruthy();

    expect(h.store().ui.selectedIssueId).toBeNull();
    fireEvent.click(row);
    await settle();
    expect(h.store().ui.selectedIssueId).toBe("k1");
    h.ui.unmount();
  });

  test("5a. режим выделения: «Выделить» показывает чекбоксы; выбор двух строк + массовая смена статуса зовёт bulk API", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        !params.cursor ? { items: [dto("b1"), dto("b2")], hasMore: false, nextCursor: null } : { items: [], hasMore: false, nextCursor: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-b1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-b2" }));
    await settle();
    expect(screen.getByText("Выбрано: 2")).toBeTruthy();

    const panel = screen.getByText("Выбрано: 2").parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "Статус" }));
    await settle();
    fireEvent.click(within(panel).getByRole("button", { name: "В работе" }));
    await settle();

    expect(h.bulkCalls).toHaveLength(1);
    expect(h.bulkCalls[0]).toMatchObject({ action: "status", statusId: "s2" });
    expect(new Set((h.bulkCalls[0] as { issueIds: string[] }).issueIds)).toEqual(new Set(["b1", "b2"]));
    expect(h.store().toasts.some((t) => t.text === "Применено к 2 из 2" && t.kind === "success")).toBe(true);
    // после операции выделение сбрасывается
    expect(screen.queryByText(/Выбрано:/)).toBeNull();
    h.ui.unmount();
  });

  test("5b. массовое назначение исполнителя зовёт bulk API с action=assignee и выбранным пользователем", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        !params.cursor ? { items: [dto("a1"), dto("a2")], hasMore: false, nextCursor: null } : { items: [], hasMore: false, nextCursor: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-a1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-a2" }));
    await settle();
    const panel = screen.getByText("Выбрано: 2").parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "Исполнитель" }));
    await settle();
    fireEvent.click(within(panel).getByRole("button", { name: user2.name }));
    await settle();

    expect(h.bulkCalls[0]).toMatchObject({ action: "assignee", assigneeId: "u2" });
    expect(new Set((h.bulkCalls[0] as { issueIds: string[] }).issueIds)).toEqual(new Set(["a1", "a2"]));
    h.ui.unmount();
  });

  test("5c. массовая смена приоритета зовёт bulk API с action=priority и выбранным значением", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        !params.cursor ? { items: [dto("p1"), dto("p2")], hasMore: false, nextCursor: null } : { items: [], hasMore: false, nextCursor: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-p1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-p2" }));
    await settle();
    const panel = screen.getByText("Выбрано: 2").parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "Приоритет" }));
    await settle();
    fireEvent.click(within(panel).getByRole("button", { name: "Критичный" }));
    await settle();

    expect(h.bulkCalls[0]).toMatchObject({ action: "priority", priorityId: "critical" });
    h.ui.unmount();
  });

  test("5d. массовое удаление сперва просит подтверждения; после подтверждения зовёт bulk API и показывает тост частичного результата", async () => {
    const h = await setup({
      pageImpl: async (_p, params) =>
        !params.cursor ? { items: [dto("d1"), dto("d2")], hasMore: false, nextCursor: null } : { items: [], hasMore: false, nextCursor: null },
      bulkImpl: async () => ({ succeeded: ["d1"], failed: [{ issueId: "d2", reason: "нет прав" }] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-d1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-d2" }));
    await settle();
    const panel = screen.getByText("Выбрано: 2").parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "Удалить" }));
    await settle();

    const dialog = screen.getByRole("dialog", { name: "Удалить задачи?" });
    expect(within(dialog).getByText("Будет удалено задач: 2. Действие необратимо.")).toBeTruthy();
    expect(h.bulkCalls).toHaveLength(0); // подтверждение прежде вызова API

    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    await settle();

    expect(h.bulkCalls).toHaveLength(1);
    expect(h.bulkCalls[0]).toMatchObject({ action: "delete" });
    expect(new Set((h.bulkCalls[0] as { issueIds: string[] }).issueIds)).toEqual(new Set(["d1", "d2"]));
    expect(
      h.store().toasts.some((t) => t.text === "Изменено 1 из 2, 1 пропущено — нет прав" && t.kind === "info"),
    ).toBe(true);
    h.ui.unmount();
  });

  test("6a. список сохранённых вьюх подгружается через savedViewsApi.list", async () => {
    const view: ServerSavedView = { id: "v1", name: "Мои горящие", filter: { priority: "high", status: "s1" }, isDefault: false, createdAt: "t", updatedAt: "t" };
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }), views: [view] });
    fireEvent.click(screen.getByRole("button", { name: /Вьюхи/ }));
    await settle();
    expect(screen.getByText("Мои горящие")).toBeTruthy();
    h.ui.unmount();
  });

  test("6b. выбор сохранённой вьюхи применяет её фильтры (меняются параметры запроса)", async () => {
    const view: ServerSavedView = { id: "v1", name: "Мои горящие", filter: { priority: "high", status: "s1" }, isDefault: false, createdAt: "t", updatedAt: "t" };
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }), views: [view] });
    h.pageCalls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /Вьюхи/ }));
    await settle();
    fireEvent.click(screen.getByText("Мои горящие"));
    await settle();
    expect(h.pageCalls[h.pageCalls.length - 1]).toMatchObject({ priority: "high", status: "s1" });
    h.ui.unmount();
  });

  test("6c. «Сохранить как вьюху» с именем зовёт savedViewsApi.create с текущими фильтрами", async () => {
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    const [, , typeSel] = screen.getAllByRole("combobox");
    fireEvent.change(typeSel, { target: { value: "bug" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Вьюхи/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить как вьюху" }));
    await settle();
    fireEvent.change(screen.getByPlaceholderText("Название вьюхи"), { target: { value: "Баги" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await settle();

    expect(h.viewsCreateCalls).toHaveLength(1);
    expect(h.viewsCreateCalls[0]).toMatchObject({ name: "Баги", filter: { type: "bug" } });
    h.ui.unmount();
  });

  test("6d. удаление вьюхи зовёт savedViewsApi.remove с её id", async () => {
    const view: ServerSavedView = { id: "v1", name: "Мои горящие", filter: {}, isDefault: false, createdAt: "t", updatedAt: "t" };
    const h = await setup({ pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }), views: [view] });
    fireEvent.click(screen.getByRole("button", { name: /Вьюхи/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Удалить вьюху" }));
    await settle();
    expect(h.viewsRemoveCalls).toEqual(["v1"]);
    h.ui.unmount();
  });

  test("7a. роль viewer: нет кнопки импорта; массовое удаление недоступно даже с выделением", async () => {
    const h = await setup({
      role: "viewer",
      pageImpl: async (_p, params) =>
        !params.cursor ? { items: [dto("v1")], hasMore: false, nextCursor: null } : { items: [], hasMore: false, nextCursor: null },
    });
    expect(screen.queryByRole("button", { name: /Импорт из Trello/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить A21-v1" }));
    await settle();
    const panel = screen.getByText("Выбрано: 1").parentElement as HTMLElement;
    // смена статуса/исполнителя/приоритета — не гейтится requirePerm() на клиенте
    // (см. комментарий над bulkApplyIssueAction: сервер проверяет права на
    // каждую задачу индивидуально), но удаление явно скрыто по can("delete").
    expect(within(panel).getByRole("button", { name: "Статус" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Удалить" })).toBeNull();
    h.ui.unmount();
  });

  test("7b. роль viewer + пустой список без фильтров — эмпти-стейт без кнопки создания задачи", async () => {
    const h = await setup({ role: "viewer", pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    expect(screen.getByText("Задач пока нет")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Создать задачу" })).toBeNull();
    h.ui.unmount();
  });

  test("8a. пустой проект без фильтров — эмпти-стейт с кнопкой создания (роль позволяет); клик открывает форму создания", async () => {
    const h = await setup({ role: "manager", pageImpl: async () => ({ items: [], hasMore: false, nextCursor: null }) });
    expect(screen.getByText("Задач пока нет")).toBeTruthy();
    expect(h.store().ui.createOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));
    await settle();
    expect(h.store().ui.createOpen).toBe(true);
    h.ui.unmount();
  });

  test("8b. активные фильтры и ничего не найдено — эмпти-стейт «Ничего не найдено» со сбросом", async () => {
    const h = await setup({
      pageImpl: async (_p, params) => (params.label ? { items: [], hasMore: false, nextCursor: null } : { items: [dto("x1")], hasMore: false, nextCursor: null }),
    });
    fireEvent.change(screen.getByPlaceholderText("Метка"), { target: { value: "nope" } });
    await settle();
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
    expect(screen.getByText("Измените или сбросьте фильтры")).toBeTruthy();
    // и заголовочный, и эмпти-стейтовый «Сбросить» видны одновременно (фильтр
    // активен и результатов нет) и вызывают один и тот же resetFilters —
    // какой из двух нажать, для итога не важно.
    fireEvent.click(screen.getAllByRole("button", { name: "Сбросить" })[0]);
    await settle();
    expect((screen.getByPlaceholderText("Метка") as HTMLInputElement).value).toBe("");
    h.ui.unmount();
  });
});
