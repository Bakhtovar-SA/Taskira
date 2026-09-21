import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  sprintsApi,
  type ProjectBootstrap,
  type ServerIssue,
  type ServerSprint,
} from "./api";

/** Спринты (sprints, миграция 023, опциональный модуль) — клиентская часть
 *  жизненного цикла: addSprint/startSprint/completeSprint/setIssueSprint.
 *  Сервер — источник истины (см. server/test/sprints.test.ts); здесь —
 *  что стор верно отражает ответы API в data.sprints/data.issues, включая
 *  локальное зеркалирование переноса незакрытых задач в бэклог при
 *  завершении спринта (completeSprint делает это одной транзакцией на
 *  сервере — без зеркалирования карточки повисли бы в UI на завершённом
 *  спринте до следующего bootstrap()). */

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

const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: true };

function fakeSprint(id: string, over: Partial<ServerSprint> = {}): ServerSprint {
  return { id, name: `Sprint ${id}`, goal: "", status: "future", startDate: null, endDate: null, ...over };
}

function fakeServerIssue(id: string, over: Partial<ServerIssue> = {}): ServerIssue {
  return {
    id,
    key: `A21-${id}`,
    title: `Задача ${id}`,
    description: "",
    typeId: "task",
    statusId: "s1",
    priorityId: "medium",
    assigneeId: null,
    reporterId: "u1",
    epicId: null,
    parentId: null,
    sprintId: null,
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

const boot = (sprints: ServerSprint[] = [], issues: ServerIssue[] = []): { boot: ProjectBootstrap; issues: ServerIssue[] } => ({
  boot: {
    project,
    users: [baseUser as never],
    members: [{ userId: "u1", role: "manager" }],
    workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
    issueTemplates: [],
    customFields: [],
    sprints,
  },
  issues,
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

async function bootToReady(sprints: ServerSprint[] = [], issues: ServerIssue[] = []): Promise<{ get: () => ReturnType<typeof useStore> }> {
  const { boot: bootPayload, issues: issuesPayload } = boot(sprints, issues);
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootPayload);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: issuesPayload, hasMore: false, nextCursor: null });
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
  await act(async () => {
    // bootstrap больше не грузит задачи (PERF-06): тест исходит из «стор уже знает эти задачи», поэтому догружаем явно
    await latest!.ensureAllIssues();
  });
  expect(latest!.bootStatus).toBe("ready");
  return { get: () => latest! };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("спринты — жизненный цикл в сторе", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("addSprint() добавляет спринт в data.sprints", async () => {
    const store = await bootToReady();
    vi.spyOn(sprintsApi, "create").mockResolvedValue(fakeSprint("s1", { name: "Sprint 1" }));

    await act(async () => {
      store.get().addSprint({ name: "Sprint 1", goal: "" });
      await flush();
    });

    expect(store.get().data.sprints).toHaveLength(1);
    expect(store.get().data.sprints[0]).toMatchObject({ id: "s1", name: "Sprint 1", status: "future" });
  });

  test("startSprint() переводит спринт в active", async () => {
    const store = await bootToReady([fakeSprint("s1")]);
    vi.spyOn(sprintsApi, "start").mockResolvedValue(fakeSprint("s1", { status: "active" }));

    await act(async () => {
      store.get().startSprint("s1");
      await flush();
    });

    expect(store.get().data.sprints[0].status).toBe("active");
  });

  test("setIssueSprint() обновляет sprintId задачи", async () => {
    const store = await bootToReady([fakeSprint("s1")], [fakeServerIssue("i1")]);
    vi.spyOn(issuesApi, "setSprint").mockResolvedValue(fakeServerIssue("i1", { sprintId: "s1" }));

    await act(async () => {
      store.get().setIssueSprint("i1", "s1");
      await flush();
    });

    expect(store.get().data.issues.find((i) => i.id === "i1")?.sprintId).toBe("s1");
  });

  test("setIssueSprint(id, null) возвращает задачу в бэклог", async () => {
    const store = await bootToReady([fakeSprint("s1", { status: "active" })], [fakeServerIssue("i1", { sprintId: "s1" })]);
    vi.spyOn(issuesApi, "setSprint").mockResolvedValue(fakeServerIssue("i1", { sprintId: null }));

    await act(async () => {
      store.get().setIssueSprint("i1", null);
      await flush();
    });

    expect(store.get().data.issues.find((i) => i.id === "i1")?.sprintId).toBeNull();
  });

  test("completeSprint() переводит спринт в completed и локально переносит незакрытые задачи в бэклог", async () => {
    const open = fakeServerIssue("open", { sprintId: "s1", doneAt: null });
    const done = fakeServerIssue("done", { sprintId: "s1", doneAt: new Date().toISOString() });
    const store = await bootToReady([fakeSprint("s1", { status: "active" })], [open, done]);
    vi.spyOn(sprintsApi, "complete").mockResolvedValue({ sprint: fakeSprint("s1", { status: "completed" }), movedToBacklog: 1 });

    await act(async () => {
      store.get().completeSprint("s1");
      await flush();
    });

    expect(store.get().data.sprints[0].status).toBe("completed");
    const issues = store.get().data.issues;
    // Незакрытая — ушла в бэклог локально, зеркаля перенос на сервере.
    expect(issues.find((i) => i.id === "open")?.sprintId).toBeNull();
    // Закрытая — сервер её не трогает, остаётся на (уже завершённом) спринте.
    expect(issues.find((i) => i.id === "done")?.sprintId).toBe("s1");
  });
});
