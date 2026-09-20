import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type IssuePageParams,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { ISSUE_SEARCH_DEBOUNCE_MS, useIssueSearch, type IssueSearchState } from "./issueSearch";
import IssueSearchBox from "./components/IssueSearchBox";
import { I18nProvider } from "./i18n";

/**
 * Серверный поиск для пикеров (связи, направление): вместо плоского <select> на
 * весь список проекта. Проверяем поведение хука (пустой запрос → недавние,
 * debounce, исключения, устаревшие ответы, ошибка) и то, что пользователь видит
 * в каждом состоянии — включая «пусто» и «нет совпадений», которые у <select>
 * не существовали и не должны превращаться в необъяснённую пустоту.
 */

const dto = (n: number, over: Partial<ServerIssue> = {}): ServerIssue =>
  ({
    id: `i${n}`,
    key: `A21-${n}`,
    title: `Задача ${n}`,
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
    rank: n,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = (ms = ISSUE_SEARCH_DEBOUNCE_MS + 60) => act(async () => { await wait(ms); });

function page(items: ServerIssue[]) {
  return { items, hasMore: false, nextCursor: null };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useIssueSearch", () => {
  function HookProbe({ term, exclude, limit, onState }: { term: string; exclude?: string[]; limit?: number; onState: (s: IssueSearchState) => void }) {
    onState(useIssueSearch("p1", term, { excludeIds: exclude, limit }));
    return null;
  }
  function mount(term: string, exclude?: string[], limit?: number) {
    let latest!: IssueSearchState;
    const ui = render(<HookProbe term={term} exclude={exclude} limit={limit} onState={(s) => (latest = s)} />);
    return {
      get s() {
        return latest;
      },
      rerender: (t: string, e?: string[]) => ui.rerender(<HookProbe term={t} exclude={e ?? exclude} limit={limit} onState={(s) => (latest = s)} />),
      unmount: ui.unmount,
    };
  }

  test("пустой запрос — недавно обновлённые (список не пуст), без текстового поиска", async () => {
    const spy = vi.spyOn(issuesApi, "page").mockResolvedValue(page([dto(1), dto(2)]));
    const h = mount("");
    expect(h.s.status).toBe("loading");
    await settle(30);
    expect(h.s.status).toBe("ready");
    expect(h.s.isRecent).toBe(true);
    expect(h.s.results.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(spy.mock.calls[0][1]).toMatchObject({ sort: "updated", dir: "desc" });
    expect(spy.mock.calls[0][1]).not.toHaveProperty("q");
    h.unmount();
  });

  test("ввод текста: одна пауза — один запрос с q (не по запросу на символ)", async () => {
    const spy = vi.spyOn(issuesApi, "page").mockResolvedValue(page([dto(1)]));
    const h = mount("");
    await settle(30);
    spy.mockClear();
    h.rerender("а");
    h.rerender("аб");
    h.rerender("абв");
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject({ q: "абв" });
    expect(h.s.isRecent).toBe(false);
    expect(h.s.term).toBe("абв");
    h.unmount();
  });

  test("исключённые (сама задача, уже связанные) не показываются, страница не пустеет из-за них", async () => {
    const spy = vi.spyOn(issuesApi, "page").mockResolvedValue(page([dto(1), dto(2), dto(3), dto(4)]));
    const h = mount("", ["i1", "i2"], 2);
    await settle(30);
    expect(spy.mock.calls[0][1].limit).toBe(4); // limit + число исключённых
    expect(h.s.results.map((i) => i.id)).toEqual(["i3", "i4"]);
    h.unmount();
  });

  test("опоздавший ответ прежнего запроса не перетирает новый", async () => {
    let resolveOld!: (v: ReturnType<typeof page>) => void;
    const spy = vi.spyOn(issuesApi, "page");
    spy.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    spy.mockResolvedValueOnce(page([dto(9)]));
    const h = mount("");
    await wait(10);
    h.rerender("новый");
    await settle();
    expect(h.s.results.map((i) => i.id)).toEqual(["i9"]);
    await act(async () => {
      resolveOld(page([dto(1)]));
      await flush();
    });
    expect(h.s.results.map((i) => i.id)).toEqual(["i9"]);
    h.unmount();
  });

  test("ошибка: статус error без результатов; retry повторяет запрос", async () => {
    const spy = vi.spyOn(issuesApi, "page");
    spy.mockRejectedValueOnce(new Error("сеть"));
    spy.mockResolvedValueOnce(page([dto(1)]));
    const h = mount("");
    await settle(30);
    expect(h.s.status).toBe("error");
    expect(h.s.results).toEqual([]);
    await act(async () => {
      h.s.retry();
      await flush();
      await flush();
    });
    expect(h.s.status).toBe("ready");
    expect(h.s.results).toHaveLength(1);
    h.unmount();
  });
});

/* ------------------------------------------------------------------ компонент */

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
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

type Page = ReturnType<typeof page>;

/** `initial` — ответ на ПЕРВЫЙ запрос пикера (он уходит сразу после bootstrap). */
async function mountBox(onPick: (id: string) => void, initial: () => Promise<Page> = async () => page([]), excludeIds?: string[]) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  const search = vi.spyOn(issuesApi, "page").mockImplementation(initial);

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  function Box() {
    const { data } = useStore();
    // пикер рендерим после bootstrap, когда известен проект
    return data.currentProjectId ? (
      <IssueSearchBox ariaLabel="Поиск задачи" excludeIds={excludeIds} onPick={(i) => onPick(i.id)} />
    ) : null;
  }
  const ui = render(
    <I18nProvider>
      <StoreProvider>
        <Grab />
        <Box />
      </StoreProvider>
    </I18nProvider>,
  );
  await act(async () => {
    await store.bootstrap();
  });
  return { search, ui, input: () => screen.getByRole("combobox") as HTMLInputElement };
}

describe("IssueSearchBox — что видит пользователь в каждом состоянии", () => {
  test("пустое поле: заголовок «Недавно обновлённые» и строки, а не пустота", async () => {
    const h = await mountBox(() => {}, async () => page([dto(1), dto(2)]));
    await settle(80);
    expect(screen.getByText("Недавно обновлённые")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    h.ui.unmount();
  });

  test("ввод без совпадений: «Ничего не найдено по «…»» и подсказка, что ввести", async () => {
    const h = await mountBox(() => {}, async () => page([dto(1)]));
    await settle(80);
    h.search.mockImplementation(async () => page([]));
    fireEvent.change(h.input(), { target: { value: "опечаткаа" } });
    await settle();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Ничего не найдено по «опечаткаа»")).toBeTruthy();
    expect(screen.getByText(/Проверьте ключ/)).toBeTruthy();
    h.ui.unmount();
  });

  test("в проекте нет других задач: отдельное объяснение, а не голый список", async () => {
    const h = await mountBox(() => {}, async () => page([]));
    await settle(80);
    expect(screen.getByText("В проекте пока нет других задач")).toBeTruthy();
    h.ui.unmount();
  });

  test("идёт запрос: скелет строк; ошибка: сообщение и «Повторить»", async () => {
    let release!: (v: Page) => void;
    const h = await mountBox(() => {}, () => new Promise<Page>((r) => (release = r)));
    await settle(30);
    expect(screen.getByLabelText("Поиск…")).toBeTruthy();
    await act(async () => {
      release(page([dto(1)]));
      await flush();
    });
    // ошибка на следующий запрос
    h.search.mockRejectedValueOnce(new Error("сеть")).mockImplementation(async () => page([dto(1)]));
    fireEvent.change(h.input(), { target: { value: "x" } });
    await settle();
    expect(screen.getByText("Не удалось выполнить поиск")).toBeTruthy();
    fireEvent.click(screen.getByText("Повторить"));
    await settle(80);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    h.ui.unmount();
  });

  test("клавиатура: ↓ и Enter выбирают вторую строку; клик выбирает строку", async () => {
    const picked: string[] = [];
    const h = await mountBox((id) => picked.push(id), async () => page([dto(1), dto(2), dto(3)]));
    await settle(80);
    fireEvent.keyDown(h.input(), { key: "ArrowDown" });
    fireEvent.keyDown(h.input(), { key: "Enter" });
    expect(picked).toEqual(["i2"]);
    fireEvent.click(screen.getAllByRole("option")[2]);
    expect(picked).toEqual(["i2", "i3"]);
    h.ui.unmount();
  });
});
