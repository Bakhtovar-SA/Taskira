import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  ApiError,
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type IssuePageParams,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import IssueModal from "./components/IssueModal";
import { useIssue } from "./issuePages";
import type { Issue } from "./types";

/**
 * PERF-06, модалки: карточка перестаёт искать связанные задачи в списке всех задач
 * проекта. Подзадачи — запрос `?parentId=`; эпик и родитель — точечный запрос по id
 * (или кэш); признак «сама является направлением» — поле `epicChildrenCount`
 * детального ответа. Общая загрузка проекта здесь не нужна.
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
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }], transitions: [] },
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

const detail = (id: string, over: Partial<ServerIssue> = {}) =>
  ({
    ...dto(id, over),
    links: [],
    checklist: [],
    attachments: [],
    collaborators: [],
    participants: [],
    customFieldValues: [],
    subtasksSummary: { total: 1, done: 0 },
    epicChildrenCount: 0,
    ...over,
  }) as never;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); await flush(); await flush(); });

/** `listed` — то, что «знает» стор после bootstrap; остальное карточка обязана добыть сама. */
function Probe({ id, onIssue }: { id: string | null; onIssue: (i: Issue | null) => void }) {
  onIssue(useIssue(id));
  return null;
}

async function setup(
  listed: ServerIssue[],
  api: { get: (id: string) => unknown; children?: ServerIssue[] },
  probe?: { id: string | null; on: (i: Issue | null) => void },
) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: listed, hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  vi.spyOn(commentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
  const get = vi.spyOn(issuesApi, "get").mockImplementation(async (_p, id) => api.get(id) as never);
  const page = vi.spyOn(issuesApi, "page").mockImplementation(async (_p, params: IssuePageParams) => ({
    items: params.parentId ? (api.children ?? []) : [],
    hasMore: false,
    nextCursor: null,
  }));

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (withProbe: boolean) => (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        <IssueModal />
        {withProbe && probe && <Probe id={probe.id} onIssue={probe.on} />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  await act(async () => {
    // bootstrap больше не грузит задачи (PERF-06): тест исходит из «стор уже знает эти задачи», поэтому догружаем явно
    await store.ensureAllIssues();
  });
  // Хук useIssue монтируется после bootstrap, как и компоненты приложения (до него стор пуст)
  ui.rerender(tree(true));
  return { store: () => store, get, page, ui };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("карточка задачи не ищет связанные задачи в общем списке", () => {
  test("подзадачи запрашиваются у сервера по parentId, не выбираются из списка", async () => {
    // в списке стора ребёнка НЕТ — если бы карточка фильтровала data.issues, подзадач не было бы
    const h = await setup([dto("i1")], { get: (id) => detail(id), children: [dto("c1", { parentId: "i1", title: "Подзадача из сервера" })] });
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();
    const call = h.page.mock.calls.find((c) => c[1].parentId === "i1");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ parentId: "i1", sort: "rank", dir: "asc" });
    expect(screen.getByText("Подзадача из сервера")).toBeTruthy();
    h.ui.unmount();
  });

  test("эпик и родитель, которых нет в сторе, подтягиваются точечно по id и показываются бейджами", async () => {
    const h = await setup([dto("i1", { epicId: "e9", parentId: "p9" })], {
      get: (id) => (id === "e9" ? detail("e9", { title: "Направление из сервера" }) : id === "p9" ? detail("p9", { title: "Родитель из сервера", key: "A21-77" }) : detail(id, { epicId: "e9", parentId: "p9" })),
    });
    expect(h.store().data.issues.map((i) => i.id)).toEqual(["i1"]);
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();
    const ids = h.get.mock.calls.map((c) => c[1]);
    expect(ids).toEqual(expect.arrayContaining(["i1", "e9", "p9"]));
    expect(ids.filter((id) => id === "e9")).toHaveLength(1); // один запрос, не по запросу на рендер
    expect(screen.getAllByText("Направление из сервера").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/A21-77/).length).toBeGreaterThan(0); // бейдж «подзадача A21-77»
    h.ui.unmount();
  });

  test("эпик недоступен (удалён): бейдж скрыт, тоста об ошибке нет", async () => {
    const h = await setup([dto("i1", { epicId: "gone" })], {
      get: (id) => {
        if (id === "gone") throw new ApiError(404, "NOT_FOUND", "нет");
        return detail(id, { epicId: "gone" });
      },
    });
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();
    expect(h.store().toasts.filter((t) => t.kind === "error")).toEqual([]);
    h.ui.unmount();
  });

  test("поле «Направление» скрыто у задачи, на которую уже ссылаются (epicChildrenCount > 0), и есть у обычной", async () => {
    const asDirection = await setup([dto("i1")], { get: (id) => detail(id, { epicChildrenCount: 2 }) });
    await act(async () => {
      asDirection.store().openIssue("i1");
    });
    await settle();
    expect(screen.queryByText("Направление")).toBeNull();
    asDirection.ui.unmount();
    cleanup();
    vi.restoreAllMocks();

    const plain = await setup([dto("i1")], { get: (id) => detail(id, { epicChildrenCount: 0 }) });
    await act(async () => {
      plain.store().openIssue("i1");
    });
    await settle();
    expect(screen.getByText("Направление")).toBeTruthy();
    plain.ui.unmount();
  });
});

describe("useIssue", () => {
  const notFound = () => {
    throw new ApiError(404, "NOT_FOUND", "нет");
  };

  test("известная стору задача — из кэша, без запроса", async () => {
    let got: Issue | null = null;
    const h = await setup([dto("known")], { get: (id) => detail(id) }, { id: "known", on: (i) => (got = i) });
    await settle();
    expect(got).not.toBeNull();
    expect((got as unknown as Issue).id).toBe("known");
    expect(h.get).not.toHaveBeenCalled();
    h.ui.unmount();
  });

  test("неизвестная — один точечный GET, затем задача доступна; повторные рендеры не запрашивают заново", async () => {
    let got: Issue | null = null;
    const h = await setup([], { get: (id) => detail(id, { title: "Из сервера" }) }, { id: "far", on: (i) => (got = i) });
    await settle();
    expect(h.get.mock.calls.filter((c) => c[1] === "far")).toHaveLength(1);
    expect((got as unknown as Issue).title).toBe("Из сервера");
    await settle();
    expect(h.get.mock.calls.filter((c) => c[1] === "far")).toHaveLength(1);
    h.ui.unmount();
  });

  test("недоступная (404) — null, без тоста об ошибке", async () => {
    let got: Issue | null = null;
    const h = await setup([], { get: (id) => (id === "gone" ? notFound() : detail(id)) }, { id: "gone", on: (i) => (got = i) });
    await settle();
    expect(got).toBeNull();
    expect(h.store().toasts.filter((t) => t.kind === "error")).toEqual([]);
    h.ui.unmount();
  });

  test("id = null: запросов нет", async () => {
    let got: Issue | null = null;
    const h = await setup([], { get: (id) => detail(id) }, { id: null, on: (i) => (got = i) });
    await settle();
    expect(got).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
    h.ui.unmount();
  });
});
