import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore, useToasts } from "./store";
import { ApiError, authApi, departmentsApi, issuesApi, notificationsApi, projectsApi, type ProjectBootstrap, type ServerIssue } from "./api";

/** `useStore()` + вынесенные из него домены (ADR-0011, шаги 1–2): тосты и уведомления — отдельные хранилища. */
function useStoreSnapshot() {
  return { ...useStore(), toasts: useToasts() };
}

/** Характеризационные тесты CRUD задач в сторе (createIssue, updateIssue, moveStatus, deleteIssue), написанные ДО выноса
 *  в src/store/issueCrud.ts (ТЗ 2.3, шаг 5). Эти действия не «оптимистичны» в узком смысле: сначала запрос, потом
 *  применение ответа сервера (DTO) к стору; отдельные свойства, которые легко потерять при переносе: проверка «проект не
 *  сменился, пока шёл запрос», поправка `subtasksSummary` у родителя, обнуление `epicId/parentId` у зависимых при
 *  удалении, инкремент `issuesRevision`/`epicsRevision`, `ui.lastEvent`, повторная загрузка задач при неудаче moveStatus. */

const admin = {
  id: "u1", username: "admin", name: "Админ", initials: "А", color: "#0B5FD9", jobRole: "Админ",
  globalRole: "admin" as const, isActive: true, authSource: "local" as const,
};
const employee = { ...admin, id: "u2", username: "e", globalRole: "member" as const };
const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };

const workflow = {
  statuses: [
    { id: "s1", sid: "todo", name: "К работе", category: "todo" as const, position: 0 },
    { id: "s2", sid: "done", name: "Готово", category: "done" as const, position: 1 },
  ],
  transitions: [{ id: "t1", from: "s1", to: "s2" }],
};
const bootPayload = (users: unknown[], members: { userId: string; role: "manager" | "employee" | "viewer" }[]): ProjectBootstrap => ({
  project, users: users as never, members, workflow, issueTemplates: [], customFields: [], sprints: [],
});

const dto = (id: string, over: Record<string, unknown> = {}): ServerIssue =>
  ({
    id, projectId: "p1", num: 1, key: `A21-${id}`, title: `Задача ${id}`, description: "", typeId: "task", statusId: "s1",
    priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
    tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

let unmountCurrent: (() => void) | null = null;

async function boot(opts: { me?: typeof admin | typeof employee; issues?: ServerIssue[]; members?: { userId: string; role: "manager" | "employee" | "viewer" }[] } = {}) {
  const me = opts.me ?? admin;
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(me as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootPayload([admin, employee], opts.members ?? [{ userId: "u2", role: "employee" }]));
  const listSpy = vi.spyOn(issuesApi, "list").mockResolvedValue({ items: opts.issues ?? [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  let latest: ReturnType<typeof useStoreSnapshot> | null = null;
  function Probe() {
    latest = useStoreSnapshot();
    return null;
  }
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  unmountCurrent = unmount;
  await act(async () => {
    await latest!.bootstrap();
  });
  await act(async () => {
    await latest!.ensureAllIssues();
  });
  expect(latest!.bootStatus).toBe("ready");
  return { get: () => latest!, listSpy };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
const find = (get: () => ReturnType<typeof useStoreSnapshot>, id: string) => get().data.issues.find((i) => i.id === id);

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createIssue", () => {
  test("успех: задача добавляется по ответу сервера, растёт issuesRevision, ставится ui.lastEvent; epicId → растёт и epicsRevision", async () => {
    const { get } = await boot();
    const create = vi.spyOn(issuesApi, "create").mockResolvedValue(dto("n1", { epicId: "e1" }));
    const rev0 = [get().issuesRevision, get().epicsRevision];
    act(() => get().createIssue({ title: "Новая", description: "", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, labels: [], complexity: null } as never));
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(find(get, "n1")).toBeTruthy();
    expect(get().issuesRevision).toBe(rev0[0] + 1);
    expect(get().epicsRevision).toBe(rev0[1] + 1);
    expect(get().ui.lastEvent?.issueId).toBe("n1");
  });

  test("без epicId epicsRevision не растёт", async () => {
    const { get } = await boot();
    vi.spyOn(issuesApi, "create").mockResolvedValue(dto("n2"));
    const e0 = get().epicsRevision;
    act(() => get().createIssue({ title: "Ещё", description: "", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, labels: [], complexity: null } as never));
    await settle();
    expect(get().epicsRevision).toBe(e0);
  });

  test("пустой заголовок — в API не идёт; не-участник (нет права create) — тоже", async () => {
    const { get } = await boot();
    const create = vi.spyOn(issuesApi, "create").mockResolvedValue(dto("x"));
    act(() => get().createIssue({ title: "   ", description: "", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, labels: [], complexity: null } as never));
    await settle();
    expect(create).not.toHaveBeenCalled();
    unmountCurrent?.();
    vi.restoreAllMocks();
    const viewer = await boot({ me: employee, members: [{ userId: "u2", role: "viewer" }] });
    const create2 = vi.spyOn(issuesApi, "create").mockResolvedValue(dto("y"));
    act(() => viewer.get().createIssue({ title: "Нельзя", description: "", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, labels: [], complexity: null } as never));
    await settle();
    expect(create2).not.toHaveBeenCalled();
  });
});

describe("updateIssue", () => {
  test("в API уходят только изменённые поля (заголовок обрезается); ответ сервера заменяет задачу; title → epicsRevision растёт", async () => {
    const { get } = await boot({ issues: [dto("i1")] });
    const patch = vi.spyOn(issuesApi, "patch").mockResolvedValue(dto("i1", { title: "Новый", priorityId: "high" }));
    const [r0, e0] = [get().issuesRevision, get().epicsRevision];
    act(() => get().updateIssue("i1", { title: "  Новый  ", priorityId: "high" }));
    await settle();
    expect(patch).toHaveBeenCalledWith("p1", "i1", { title: "Новый", priorityId: "high" });
    expect(find(get, "i1")!.title).toBe("Новый");
    expect(find(get, "i1")!.priorityId).toBe("high");
    expect(get().issuesRevision).toBe(r0 + 1);
    expect(get().epicsRevision).toBe(e0 + 1);
  });

  test("приоритет без title/epicId/color epicsRevision не трогает", async () => {
    const { get } = await boot({ issues: [dto("i1")] });
    vi.spyOn(issuesApi, "patch").mockResolvedValue(dto("i1", { priorityId: "low" }));
    const e0 = get().epicsRevision;
    act(() => get().updateIssue("i1", { priorityId: "low" }));
    await settle();
    expect(get().epicsRevision).toBe(e0);
  });

  test("пустой патч и невалидный заголовок в API не идут; ошибка API оставляет задачу как есть", async () => {
    const { get } = await boot({ issues: [dto("i1")] });
    const patch = vi.spyOn(issuesApi, "patch").mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    act(() => get().updateIssue("i1", {}));
    act(() => get().updateIssue("i1", { title: "   " }));
    await settle();
    expect(patch).not.toHaveBeenCalled();
    act(() => get().updateIssue("i1", { priorityId: "high" }));
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(find(get, "i1")!.priorityId).toBe("medium");
  });
});

describe("moveStatus", () => {
  test("переход вне схемы workflow — в API не идёт, статус прежний", async () => {
    const { get } = await boot({ issues: [dto("i1", { statusId: "s2", doneAt: new Date().toISOString() })] });
    const tr = vi.spyOn(issuesApi, "transition").mockResolvedValue(dto("i1"));
    act(() => get().moveStatus("i1", "s1")); // done → todo в схеме нет
    await settle();
    expect(tr).not.toHaveBeenCalled();
    expect(find(get, "i1")!.statusId).toBe("s2");
  });

  test("успех: задача обновляется по ответу, у родителя done +1 при закрытии подзадачи, растёт issuesRevision, ставится lastEvent", async () => {
    const parent = dto("p", { subtasksSummary: { total: 1, done: 0 } });
    const child = dto("c", { parentId: "p" });
    const { get } = await boot({ issues: [parent, child] });
    const tr = vi.spyOn(issuesApi, "transition").mockResolvedValue(dto("c", { parentId: "p", statusId: "s2", doneAt: new Date().toISOString() }));
    const r0 = get().issuesRevision;
    act(() => get().moveStatus("c", "s2", "x"));
    await settle();
    expect(tr).toHaveBeenCalledWith("p1", "c", "s2", "x");
    expect(find(get, "c")!.statusId).toBe("s2");
    expect(find(get, "c")!.doneAt).not.toBeNull();
    expect(find(get, "p")!.subtasksSummary).toEqual({ total: 1, done: 1 });
    expect(get().issuesRevision).toBe(r0 + 1);
    expect(get().ui.lastEvent?.issueId).toBe("c");
  });

  test("ошибка сервера: стор не меняется локально, но задачи перечитываются (issuesApi.list вызывается снова)", async () => {
    const { get, listSpy } = await boot({ issues: [dto("i1")] });
    vi.spyOn(issuesApi, "transition").mockRejectedValue(new ApiError(409, "CONFLICT", "нельзя"));
    const calls0 = listSpy.mock.calls.length;
    act(() => get().moveStatus("i1", "s2"));
    await settle();
    expect(find(get, "i1")!.statusId).toBe("s1");
    expect(listSpy.mock.calls.length).toBeGreaterThan(calls0);
  });
});

describe("deleteIssue", () => {
  test("удаление: задача уходит, у зависимых обнуляются epicId/parentId, у родителя total −1 (done −1 для закрытой), растут обе ревизии", async () => {
    const epic = dto("e1");
    const dependant = dto("d1", { epicId: "e1" });
    const kid = dto("k1", { parentId: "e1" });
    const parent = dto("pp", { subtasksSummary: { total: 2, done: 1 } });
    const closedChild = dto("cc", { parentId: "pp", statusId: "s2", doneAt: new Date().toISOString() });
    const { get } = await boot({ issues: [epic, dependant, kid, parent, closedChild] });
    const remove = vi.spyOn(issuesApi, "remove").mockResolvedValue(undefined as never);
    const [r0, e0] = [get().issuesRevision, get().epicsRevision];
    act(() => get().deleteIssue("e1"));
    await settle();
    expect(remove).toHaveBeenCalledWith("p1", "e1");
    expect(find(get, "e1")).toBeUndefined();
    expect(find(get, "d1")!.epicId).toBeNull();
    expect(find(get, "k1")!.parentId).toBeNull();
    act(() => get().deleteIssue("cc"));
    await settle();
    expect(find(get, "pp")!.subtasksSummary).toEqual({ total: 1, done: 0 });
    expect(get().issuesRevision).toBe(r0 + 2);
    expect(get().epicsRevision).toBe(e0 + 2);
  });

  test("ошибка API — задача остаётся; нет права delete (сотрудник) — в API не идёт", async () => {
    const { get } = await boot({ issues: [dto("i1")] });
    vi.spyOn(issuesApi, "remove").mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    act(() => get().deleteIssue("i1"));
    await settle();
    expect(find(get, "i1")).toBeTruthy();
    unmountCurrent?.();
    vi.restoreAllMocks();
    const emp = await boot({ me: employee, issues: [dto("i1", { reporterId: "u2" })] });
    const remove = vi.spyOn(issuesApi, "remove").mockResolvedValue(undefined as never);
    act(() => emp.get().deleteIssue("i1"));
    await settle();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("защита от смены проекта во время запроса", () => {
  test("create / transition, ответившие ПОСЛЕ выхода из проекта (logout → data сброшена), в стор не попадают и ui.lastEvent не ставят", async () => {
    const { get } = await boot({ issues: [dto("i1")] });
    vi.spyOn(authApi, "logout").mockResolvedValue(undefined as never);
    let resolveCreate!: (v: ServerIssue) => void;
    let resolveMove!: (v: ServerIssue) => void;
    vi.spyOn(issuesApi, "create").mockReturnValue(new Promise<ServerIssue>((r) => (resolveCreate = r)));
    vi.spyOn(issuesApi, "transition").mockReturnValue(new Promise<ServerIssue>((r) => (resolveMove = r)));
    act(() => get().createIssue({ title: "Поздняя", description: "", typeId: "task", priorityId: "medium", assigneeIds: [], epicId: null, labels: [], complexity: null } as never));
    act(() => get().moveStatus("i1", "s2"));
    await settle();
    act(() => get().logout());
    await act(async () => {
      resolveCreate(dto("late"));
      resolveMove(dto("i1", { statusId: "s2", doneAt: new Date().toISOString() }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(get().data.issues).toEqual([]);
    expect(get().ui.lastEvent).toBeNull();
  });
});

describe("bulkApplyIssueAction — ТЗ 3.3 (план v2 Трек 3)", () => {
  test("succeeded>0 — issuesRevision растёт (refreshIssues/bumpIssues), тост success/info по наличию failed", async () => {
    const { get } = await boot();
    vi.spyOn(issuesApi, "bulk").mockResolvedValue({ succeeded: ["a", "b"], failed: [] });
    const rev0 = get().issuesRevision;
    let res: { succeeded: string[]; failed: { issueId: string; reason: string }[] } | null | undefined;
    await act(async () => {
      res = await get().bulkApplyIssueAction({ action: "priority", issueIds: ["a", "b"], priorityId: "high" });
    });
    expect(res).toEqual({ succeeded: ["a", "b"], failed: [] });
    expect(get().issuesRevision).toBeGreaterThan(rev0);
    expect(get().toasts.at(-1)?.kind).toBe("success");
  });

  test("частичный успех — тост info с точным текстом «Изменено N из M, K пропущено — нет прав»", async () => {
    const { get } = await boot();
    vi.spyOn(issuesApi, "bulk").mockResolvedValue({
      succeeded: ["a"],
      failed: [{ issueId: "b", reason: "Нет прав на эту задачу" }],
    });
    await act(async () => {
      await get().bulkApplyIssueAction({ action: "status", issueIds: ["a", "b"], statusId: "s2" });
    });
    const last = get().toasts.at(-1);
    expect(last?.kind).toBe("info");
    expect(last?.text).toBe("Изменено 1 из 2, 1 пропущено — нет прав");
  });

  test("succeeded=0 (полный отказ) — issuesRevision не растёт, тост error, список не перечитывается зря", async () => {
    const { get } = await boot();
    const bulk = vi.spyOn(issuesApi, "bulk").mockResolvedValue({
      succeeded: [],
      failed: [{ issueId: "a", reason: "Нет прав на эту задачу" }],
    });
    const rev0 = get().issuesRevision;
    await act(async () => {
      await get().bulkApplyIssueAction({ action: "delete", issueIds: ["a"] });
    });
    expect(bulk).toHaveBeenCalledWith("p1", { action: "delete", issueIds: ["a"] });
    expect(get().issuesRevision).toBe(rev0);
    expect(get().toasts.at(-1)?.kind).toBe("error");
  });

  test("ошибка сети/сервера — handleApiError-тост, возвращает null (не путать с «0 успехов, но запрос дошёл»)", async () => {
    const { get } = await boot();
    vi.spyOn(issuesApi, "bulk").mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    let res: unknown = "not set";
    await act(async () => {
      res = await get().bulkApplyIssueAction({ action: "priority", issueIds: ["a"], priorityId: "high" });
    });
    expect(res).toBeNull();
    expect(get().toasts.at(-1)?.kind).toBe("error");
  });
});
