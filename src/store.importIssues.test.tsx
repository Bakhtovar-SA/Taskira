import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore, type CreateInput } from "./store";
import {
  ApiError,
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";

/**
 * importIssues() — импорт из Trello и т.п. (ревью PR #48): раньше 401 посреди
 * пачки не отличался от любой другой ошибки (терялась сессия молча, UI
 * оставался в залипшем «залогинен» виде), а невалидные description/labels
 * молча заменялись на ""/[] и всё равно засчитывались как успех.
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

const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false };

const boot: ProjectBootstrap = {
  project,
  users: [baseUser as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: {
    statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }],
    transitions: [],
  },
  issueTemplates: [],
  customFields: [],
};

function fakeServerIssue(id: string): ServerIssue {
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
    labels: [],
    complexity: null,
    dueDate: null,
    rank: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
  } as unknown as ServerIssue;
}

const input = (title: string, over: Partial<CreateInput> = {}): CreateInput => ({
  title,
  description: "",
  typeId: "task",
  priorityId: "medium",
  assigneeId: null,
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

/** bootStatus="ready" включает polling уведомлений и WS-пуш (store.tsx) — оба
 *  бьют в реальный WebSocket/сеть, если их не подменить, что в среде без
 *  реального сервера роняет тест необработанным исключением из undici.
 *  Фейковый WebSocket ничего не подключает и не шлёт, но даёт эффекту
 *  корректно смонтироваться/размонтироваться (close() на unmount). */
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

let unmountCurrent: (() => void) | null = null;

/** Держим ссылку живой через весь тест (не возвращаем один снэпшот) — после
 *  importIssues() store может ещё раз перерендериться (401 → setBootStatus),
 *  и снэпшот, снятый до этого, не увидит новое значение bootStatus. */
async function bootToReady(): Promise<{ get: () => ReturnType<typeof useStore> }> {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null, unread: 0 });
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

describe("importIssues()", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("401 посреди пачки — импорт останавливается, остаток считается failed, сессия сбрасывается", async () => {
    const store = await bootToReady();

    let call = 0;
    vi.spyOn(issuesApi, "create").mockImplementation(async () => {
      call++;
      if (call === 1) return fakeServerIssue("i1");
      throw new ApiError(401, "UNAUTHORIZED", "Токен недействителен");
    });

    const inputs = [input("A"), input("B"), input("C"), input("D")];
    let result: { ok: number; failed: number; cancelled: boolean } | undefined;
    await act(async () => {
      result = await store.get().importIssues(inputs);
    });

    // Первая карточка создалась, вторая упала 401'ом — третья и четвёртая
    // вообще не должны были уйти на сервер (issuesApi.create вызван дважды).
    expect(issuesApi.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: 1, failed: 3, cancelled: false });
    expect(store.get().bootStatus).toBe("unauthenticated");
  });

  test("невалидное description — карточка считается failed, а не молча создаётся с пустым описанием", async () => {
    const store = await bootToReady();
    const created = vi.spyOn(issuesApi, "create").mockImplementation(async () => fakeServerIssue("ok"));

    const tooLong = "x".repeat(100_000);
    const inputs = [input("Нормальная"), input("Плохая карточка", { description: tooLong })];
    let result: { ok: number; failed: number; cancelled: boolean } | undefined;
    await act(async () => {
      result = await store.get().importIssues(inputs);
    });

    expect(result).toEqual({ ok: 1, failed: 1, cancelled: false });
    expect(created).toHaveBeenCalledTimes(1);
  });

  test("403 посреди пачки — тоже останавливает импорт (как 401), не просто failed++ на одну карточку", async () => {
    const store = await bootToReady();

    let call = 0;
    vi.spyOn(issuesApi, "create").mockImplementation(async () => {
      call++;
      if (call === 1) return fakeServerIssue("i1");
      throw new ApiError(403, "FORBIDDEN", "Недостаточно прав");
    });

    const inputs = [input("A"), input("B"), input("C")];
    let result: { ok: number; failed: number; cancelled: boolean } | undefined;
    await act(async () => {
      result = await store.get().importIssues(inputs);
    });

    expect(issuesApi.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: 1, failed: 2, cancelled: false });
  });

  test("isCancelled() — цикл останавливается перед следующей карточкой, не досоздаёт остаток", async () => {
    const store = await bootToReady();
    const created = vi.spyOn(issuesApi, "create").mockImplementation(async () => fakeServerIssue("ok"));

    let cancelAfterFirst = false;
    const inputs = [input("A"), input("B"), input("C")];
    let result: { ok: number; failed: number; cancelled: boolean } | undefined;
    await act(async () => {
      result = await store.get().importIssues(
        inputs,
        (done) => {
          if (done === 1) cancelAfterFirst = true;
        },
        () => cancelAfterFirst,
      );
    });

    expect(created).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: 1, failed: 0, cancelled: true });
    // setData после цикла (не на каждую карточку) — успешно созданная всё
    // равно долетела до data.issues одним батчем.
    expect(store.get().data.issues).toHaveLength(1);
  });
});
