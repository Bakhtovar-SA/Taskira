import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore, type CreateInput } from "./store";
import {
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";

/**
 * Ревью PR #46, доводки:
 * 1. createIssue() раньше безусловно закрывал модалку создания
 *    (createOpen: false) после ответа сервера — чекбокс «создать ещё одну
 *    следом» в CreateIssueModal не мог удержать её открытой ни при каких
 *    обстоятельствах, потому что этот коллбэк срабатывал уже ПОСЛЕ того,
 *    как синхронный код в submit() решил, закрывать или нет.
 * 2. deleteIssue() зеркалил ON DELETE SET NULL сервера только для epicId,
 *    не для parentId (миграция 021) — у оставшихся в data.issues бывших
 *    подзадач удалённого родителя parentId зависал на уже удалённый id.
 */

const baseUser = {
  id: "u1",
  username: "admin",
  name: "Админ Админов",
  initials: "АА",
  color: "#0B5FD9",
  jobRole: "Администратор",
  globalRole: "admin" as const,
  isActive: true,
  authSource: "local" as const,
};

const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };

const boot: ProjectBootstrap = {
  project,
  users: [baseUser as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};

function fakeServerIssue(id: string, over: Partial<ServerIssue> = {}): ServerIssue {
  return {
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
    rank: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
    ...over,
  } as unknown as ServerIssue;
}

const input = (title: string, over: Partial<CreateInput> = {}): CreateInput => ({
  title,
  description: "",
  typeId: "task",
  priorityId: "medium",
  assigneeIds: [],
  epicId: null,
  labels: [],
  complexity: null,
  ...over,
});

function Probe({ onSnapshot }: { onSnapshot: (api: ReturnType<typeof useStore>) => void }) {
  const api = useStore();
  onSnapshot(api);
  return null;
}

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

let unmountCurrent: (() => void) | null = null;

async function bootToReady(): Promise<{ get: () => ReturnType<typeof useStore> }> {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });

  let latest: ReturnType<typeof useStore> | null = null;
  const { unmount } = render(
    <StoreProvider>
      <Probe onSnapshot={(api) => { latest = api; }} />
    </StoreProvider>,
  );
  unmountCurrent = unmount;
  await act(async () => {
    await latest!.bootstrap();
  });
  expect(latest!.bootStatus).toBe("ready");
  return { get: () => latest! };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createIssue() — чекбокс «создать ещё одну» (ревью PR #46)", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("createIssue() не трогает ui.createOpen — решение закрывать модалку остаётся за вызывающим компонентом", async () => {
    const store = await bootToReady();
    vi.spyOn(issuesApi, "create").mockResolvedValue(fakeServerIssue("i1"));

    await act(async () => {
      store.get().setCreateOpen(true);
    });
    expect(store.get().ui.createOpen).toBe(true);

    await act(async () => {
      store.get().createIssue(input("Новая"));
      await flush();
    });

    // CreateIssueModal сам решает (по чекбоксу "again") — createIssue() не
    // должен принудительно закрывать модалку своим success-коллбэком.
    expect(store.get().ui.createOpen).toBe(true);
  });
});

describe("deleteIssue() — зеркалит ON DELETE SET NULL для parentId, не только epicId (ревью PR #46)", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("удаление родителя обнуляет parentId у оставшегося в data.issues ребёнка", async () => {
    const store = await bootToReady();
    vi.spyOn(issuesApi, "create")
      .mockResolvedValueOnce(fakeServerIssue("parent"))
      .mockResolvedValueOnce(fakeServerIssue("child", { parentId: "parent" }));
    vi.spyOn(issuesApi, "remove").mockResolvedValue(undefined);

    await act(async () => {
      store.get().createIssue(input("Родитель"));
      await flush();
    });
    await act(async () => {
      store.get().createIssue(input("Ребёнок"));
      await flush();
    });
    expect(store.get().data.issues.map((i) => i.id).sort()).toEqual(["child", "parent"]);

    await act(async () => {
      store.get().deleteIssue("parent");
      await flush();
    });

    const remaining = store.get().data.issues;
    expect(remaining.map((i) => i.id)).toEqual(["child"]);
    expect(remaining[0].parentId).toBeNull();
  });
});

describe("subtasksSummary родителя — обновляется локально, без ожидания переоткрытия карточки (ревью PR #46, второй раунд)", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("createIssue() новой подзадачи увеличивает total у уже загруженного родителя", async () => {
    const store = await bootToReady();
    vi.spyOn(issuesApi, "create").mockResolvedValue(fakeServerIssue("parent"));
    await act(async () => {
      store.get().createIssue(input("Родитель"));
      await flush();
    });

    // Симулируем, что карточка родителя уже была открыта (GET /issues/:id) —
    // subtasksSummary у неё не null, как было бы после создания через createIssue.
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    vi.spyOn(issuesApi, "get").mockResolvedValue(fakeServerIssue("parent", { subtasksSummary: { total: 0, done: 0 } }));
    await act(async () => {
      store.get().openIssue("parent");
      await flush();
    });
    expect(store.get().data.issues.find((i) => i.id === "parent")?.subtasksSummary).toEqual({ total: 0, done: 0 });

    vi.spyOn(issuesApi, "create").mockResolvedValue(fakeServerIssue("child", { parentId: "parent" }));
    await act(async () => {
      store.get().createIssue(input("Подзадача", { parentId: "parent" }));
      await flush();
    });

    // Бейдж "N/M" должен вырасти сразу, не дожидаясь закрытия/переоткрытия карточки.
    expect(store.get().data.issues.find((i) => i.id === "parent")?.subtasksSummary).toEqual({ total: 1, done: 0 });
  });

  test("deleteIssue() удалённой подзадачи уменьшает total (и done, если она была закрыта)", async () => {
    const store = await bootToReady();
    vi.spyOn(issuesApi, "create")
      .mockResolvedValueOnce(fakeServerIssue("parent"))
      .mockResolvedValueOnce(fakeServerIssue("child", { parentId: "parent", doneAt: new Date().toISOString() }));
    await act(async () => {
      store.get().createIssue(input("Родитель"));
      await flush();
    });
    await act(async () => {
      store.get().createIssue(input("Подзадача", { parentId: "parent" }));
      await flush();
    });

    // Родитель "открывается" после того, как ребёнок уже создан и закрыт —
    // сервер отдаёт актуальный агрегат {total:1, done:1} за один этот шаг.
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    vi.spyOn(issuesApi, "get").mockResolvedValue(fakeServerIssue("parent", { subtasksSummary: { total: 1, done: 1 } }));
    await act(async () => {
      store.get().openIssue("parent");
      await flush();
    });
    expect(store.get().data.issues.find((i) => i.id === "parent")?.subtasksSummary).toEqual({ total: 1, done: 1 });

    vi.spyOn(issuesApi, "remove").mockResolvedValue(undefined);
    await act(async () => {
      store.get().deleteIssue("child");
      await flush();
    });

    expect(store.get().data.issues.find((i) => i.id === "parent")?.subtasksSummary).toEqual({ total: 0, done: 0 });
  });
});
