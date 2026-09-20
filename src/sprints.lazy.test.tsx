import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import SprintsView from "./components/SprintsView";

/**
 * PERF-06 A15: Sprints — осознанное исключение «обернуть, не оптимизировать». Его единственная
 * особенность — полный набор задач проекта, поэтому экран сам запрашивает его при входе
 * (`ensureAllIssues`), а bootstrap в режиме `eagerIssues={false}` больше ничего целиком не грузит.
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
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: true };
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
    sprintId: null,
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

type ListPage = { items: ServerIssue[]; hasMore: boolean; nextCursor: string | null };

async function setup(eager: boolean, listed: ServerIssue[], showSprints: boolean, listImpl?: () => Promise<ListPage>) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  const list = vi.spyOn(issuesApi, "list").mockImplementation(listImpl ?? (async () => ({ items: listed, hasMore: false, nextCursor: null })));
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (withSprints: boolean) => (
    <I18nProvider>
      <StoreProvider eagerIssues={eager}>
        <Grab />
        {withSprints && <SprintsView />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  const afterBootstrap = list.mock.calls.length;
  if (showSprints) ui.rerender(tree(true));
  await settle();
  return { ui, store: () => store, list, afterBootstrap };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Sprints — единственный потребитель полной загрузки", () => {
  test("не-eager bootstrap ничего целиком не грузит: стор пуст, issuesComplete = false", async () => {
    const h = await setup(false, [dto("i1")], false);
    expect(h.afterBootstrap).toBe(0);
    expect(h.store().data.issues).toHaveLength(0);
    expect(h.store().data.issuesComplete).toBe(false);
    h.ui.unmount();
  });

  test("вход на экран Sprints догружает все задачи один раз, бэклог показывает их", async () => {
    const h = await setup(false, [dto("i1", { title: "Из бэклога" }), dto("i2")], true);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.store().data.issuesComplete).toBe(true);
    expect(h.store().data.issues.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
    expect(screen.getByText("Из бэклога")).toBeTruthy();
    h.ui.unmount();
  });

  test("eager-режим (прежнее поведение): экран повторно ничего не грузит", async () => {
    const h = await setup(true, [dto("i1")], true);
    expect(h.afterBootstrap).toBe(1);
    expect(h.list).toHaveBeenCalledTimes(1); // только bootstrap
    expect(h.store().data.issuesComplete).toBe(true);
    h.ui.unmount();
  });

  test("ensureAllIssues идемпотентна: одновременные вызовы — один обход; повторный после загрузки — ни одного", async () => {
    const h = await setup(false, [dto("i1")], false);
    await act(async () => {
      await Promise.all([h.store().ensureAllIssues(), h.store().ensureAllIssues(), h.store().ensureAllIssues()]);
    });
    expect(h.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.store().ensureAllIssues();
    });
    expect(h.list).toHaveBeenCalledTimes(1);
    h.ui.unmount();
  });

  test("догрузка не затирает уже известные объекты и не теряет известные задачи вне списка", async () => {
    const h = await setup(false, [dto("i1", { title: "Из списка" })], false);
    vi.spyOn(issuesApi, "get").mockResolvedValue({ ...dto("known", { title: "Открытая архивная" }), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    // «архивная» задача известна стору (её открывали), но в списке активных её нет
    const known = await h.store().lookupIssue("known");
    expect(known?.title).toBe("Открытая архивная");
    await act(async () => {
      await h.store().ensureAllIssues();
    });
    expect(h.store().data.issues.map((i) => i.id).sort()).toEqual(["i1", "known"]);
    h.ui.unmount();
  });

  test("до загрузки экран не показывает ложное «в бэклоге пусто»: скелет и подпись, затем задачи", async () => {
    let release!: (v: ListPage) => void;
    const h = await setup(false, [], true, () => new Promise<ListPage>((r) => (release = r)));
    expect(screen.getAllByLabelText("Загружаем задачи проекта…").length).toBeGreaterThan(0);
    expect(screen.queryByText(/пуст/i)).toBeNull();
    await act(async () => {
      release({ items: [dto("i1", { title: "Пришла позже" })], hasMore: false, nextCursor: null });
      await flush();
      await flush();
    });
    expect(screen.getByText("Пришла позже")).toBeTruthy();
    expect(screen.queryByLabelText("Загружаем задачи проекта…")).toBeNull();
    h.ui.unmount();
  });
});
