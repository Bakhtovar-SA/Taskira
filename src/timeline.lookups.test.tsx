import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type IssueEpic,
  type IssuePageParams,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import TimelineView from "./components/TimelineView";

/**
 * PERF-06 A14: Timeline читает направления и счётчики у сервера (`epics`), а раскрытый узел —
 * постраничный набор `?epicId=`. Все тесты идут на ПУСТОМ сторе: раньше «направления» выводились
 * из epicId загруженных задач, и при частичном сторе Timeline остался бы пустым или неверным.
 *
 * Важное соглашение: число в шапке узла — агрегат сервера по ВСЕМ детям, а раскрытый список
 * показывает лишь загруженную часть, поэтому сумма видимых карточек может не совпадать с числом
 * в шапке. Это ожидаемо (под списком подписано «Показано N из M»), а не рассинхрон.
 */

const user = {
  id: "u1",
  username: "u1",
  name: "Пользователь",
  initials: "П",
  color: "#0B5FD9",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
};
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };
const boot: ProjectBootstrap = {
  project,
  users: [user as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};

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

const epic = (over: Partial<IssueEpic> = {}): IssueEpic => ({
  id: "e1",
  key: "A21-e1",
  title: "Альфа",
  color: "#ff0000",
  tStart: 2,
  tSpan: 4,
  childTotal: 87,
  childDone: 3,
  ...over,
});

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); await flush(); await flush(); });

/** children(epicId) → страницы детей; курсор — просто индекс следующей страницы. */
async function setup(opts: { epics?: IssueEpic[]; truncated?: boolean; pages?: ServerIssue[][]; firstEpicsError?: boolean }) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // jsdom не знает ResizeObserver, которым Timeline следит за шириной панели
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  const epicsSpy = vi.spyOn(issuesApi, "epics").mockResolvedValue({ items: opts.epics ?? [], truncated: opts.truncated ?? false });
  if (opts.firstEpicsError) epicsSpy.mockRejectedValueOnce(new Error("сеть"));
  const pages = opts.pages ?? [];
  const pageSpy = vi.spyOn(issuesApi, "page").mockImplementation(async (_p, params: IssuePageParams) => {
    const idx = params.cursor ? Number(params.cursor.replace("c", "")) : 0;
    const items = pages[idx] ?? [];
    const hasMore = idx + 1 < pages.length;
    return { items, hasMore, nextCursor: hasMore ? `c${idx + 1}` : null };
  });

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (withTimeline: boolean) => (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        {withTimeline && <TimelineView />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  expect(store.data.issues).toHaveLength(0); // стор пуст
  ui.rerender(tree(true));
  await settle();
  return { ui, store: () => store, epicsSpy, pageSpy };
}

const toggle = async (title: string) => {
  fireEvent.click(screen.getByText(title).closest("button")!);
  await settle();
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Timeline при частичном сторе", () => {
  test("направления и счётчики приходят от сервера (в сторе задач нет); шапка — агрегат по всем детям", async () => {
    const h = await setup({ epics: [epic(), epic({ id: "e2", key: "A21-e2", title: "Бета", childTotal: 5, childDone: 5 })] });
    expect(screen.getByText("Альфа")).toBeTruthy();
    expect(screen.getByText("Бета")).toBeTruthy();
    expect(screen.getByText("3/87 задач · A21-e1")).toBeTruthy();
    expect(screen.getByText("5/5 задач · A21-e2")).toBeTruthy();
    expect(h.epicsSpy).toHaveBeenCalledTimes(1);
    expect(h.pageSpy).not.toHaveBeenCalled(); // свернутые узлы детей не запрашивают
    h.ui.unmount();
  });

  test("раскрытие узла: постраничный набор ?epicId=; в шапке 87, показано 2 — это ожидаемо, подписано «Показано 2 из 87»", async () => {
    const page1 = [dto("c1", { title: "Первая" }), dto("c2", { title: "Вторая" })];
    const page2 = [dto("c3", { title: "Третья" })];
    const h = await setup({ epics: [epic()], pages: [page1, page2] });
    await toggle("Альфа");
    const call = h.pageSpy.mock.calls.find((c) => c[1].epicId === "e1");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ epicId: "e1", sort: "rank", dir: "asc" });
    expect(screen.getByText("Первая")).toBeTruthy();
    expect(screen.getByText("Вторая")).toBeTruthy();
    // видимых строк меньше, чем в шапке узла, — не рассинхрон
    expect(screen.getByText("3/87 задач · A21-e1")).toBeTruthy();
    expect(screen.getByText("Показано 2 из 87")).toBeTruthy();
    expect(screen.getByText("Показать ещё")).toBeTruthy();
    h.ui.unmount();
  });

  test("«Показать ещё» дочитывает следующую страницу без дублей; по концу набора подпись пропадает", async () => {
    const h = await setup({ epics: [epic()], pages: [[dto("c1", { title: "Первая" }), dto("c2", { title: "Вторая" })], [dto("c3", { title: "Третья" })]] });
    await toggle("Альфа");
    fireEvent.click(screen.getByText("Показать ещё"));
    await settle();
    expect(screen.getByText("Третья")).toBeTruthy();
    expect(screen.getAllByText(/^Задача c|Первая|Вторая|Третья/).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("Показать ещё")).toBeNull();
    expect(screen.queryByText(/Показано \d+ из/)).toBeNull();
    // курсор второй страницы пришёл из ответа первой
    expect(h.pageSpy.mock.calls.filter((c) => c[1].epicId === "e1").map((c) => c[1].cursor)).toEqual([undefined, "c1"]);
    h.ui.unmount();
  });

  test("узел без задач в раскрытом виде: сообщение, а не пустота; свёртка убирает список", async () => {
    const h = await setup({ epics: [epic({ childTotal: 0, childDone: 0 })], pages: [[]] });
    await toggle("Альфа");
    expect(screen.getByText("В направлении пока нет задач.")).toBeTruthy();
    await toggle("Альфа");
    expect(screen.queryByText("В направлении пока нет задач.")).toBeNull();
    h.ui.unmount();
  });

  test("нет направлений: объяснённое пустое состояние", async () => {
    const h = await setup({ epics: [] });
    expect(screen.getByText("Направлений пока нет")).toBeTruthy();
    h.ui.unmount();
  });

  test("направлений больше потолка сервера: явная подпись, а не молчаливое усечение", async () => {
    const h = await setup({ epics: [epic()], truncated: true });
    expect(screen.getByText("Показаны первые 1 направлений")).toBeTruthy();
    h.ui.unmount();
  });

  test("ошибка загрузки направлений: сообщение и «Повторить», повтор показывает направления", async () => {
    const h = await setup({ epics: [epic({ title: "После повтора" })], firstEpicsError: true });
    expect(screen.getByText("Не удалось загрузить направления")).toBeTruthy();
    fireEvent.click(screen.getByText("Повторить"));
    await settle();
    expect(screen.getByText("После повтора")).toBeTruthy();
    expect(h.epicsSpy).toHaveBeenCalledTimes(2);
    h.ui.unmount();
  });

  test("узел с >100 детьми (250): три страницы 100+100+50, счётчик «Показано N из 250», курсоры по цепочке, без дублей", async () => {
    const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => dto(`k${from + i}`, { title: `Ребёнок ${from + i}` }));
    const h = await setup({ epics: [epic({ childTotal: 250, childDone: 40 })], pages: [mk(0, 100), mk(100, 100), mk(200, 50)] });
    await toggle("Альфа");
    expect(screen.getAllByText(/^Ребёнок \d+$/)).toHaveLength(100);
    expect(screen.getByText("Показано 100 из 250")).toBeTruthy();
    fireEvent.click(screen.getByText("Показать ещё"));
    await settle();
    expect(screen.getAllByText(/^Ребёнок \d+$/)).toHaveLength(200);
    expect(screen.getByText("Показано 200 из 250")).toBeTruthy();
    fireEvent.click(screen.getByText("Показать ещё"));
    await settle();
    // все 250 разные карточки, повторов при склейке страниц нет
    const titles = screen.getAllByText(/^Ребёнок \d+$/).map((el) => el.textContent);
    expect(titles).toHaveLength(250);
    expect(new Set(titles).size).toBe(250);
    expect(screen.queryByText("Показать ещё")).toBeNull();
    expect(screen.queryByText(/Показано \d+ из/)).toBeNull();
    expect(h.pageSpy.mock.calls.filter((c) => c[1].epicId === "e1").map((c) => c[1].cursor)).toEqual([undefined, "c1", "c2"]);
    // шапка узла — агрегат сервера, подгрузка её не меняет
    expect(screen.getByText("40/250 задач · A21-e1")).toBeTruthy();
    h.ui.unmount();
  });
});
