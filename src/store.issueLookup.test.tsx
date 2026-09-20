import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  ApiError,
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
 * PERF-06, срез стора «issues-lookup». Мутациям нужен объект задачи: правило
 * «сотрудник правит только свои» читает assigneeIds/reporterId именно из него.
 * Раньше при промахе `find(id)` мутация молча выходила. Теперь: известная стору
 * задача — как раньше, синхронно; неизвестная — точечный GET /:id; не нашлась
 * или нет доступа — явная ошибка пользователю, а не тихий return.
 * Плюс явный issuesRevision вместо пересчёта по массиву.
 */

const user = (role: "admin" | "member") => ({
  id: "u1",
  username: "u1",
  name: "Пользователь",
  initials: "П",
  color: "#0B5FD9",
  jobRole: "Тест",
  globalRole: role,
  isActive: true,
  authSource: "local" as const,
});

const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };

const boot = (projectRole: "manager" | "employee"): ProjectBootstrap => ({
  project,
  users: [user("member") as never],
  members: [{ userId: "u1", role: projectRole }],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }], transitions: [] },
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

function Probe({ onSnapshot }: { onSnapshot: (api: ReturnType<typeof useStore>) => void }) {
  onSnapshot(useStore());
  return null;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); await flush(); });

async function setup(opts: { role: "manager" | "employee"; listed: ServerIssue[] }) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user("member") as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot(opts.role));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: opts.listed, hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  const get = vi.spyOn(issuesApi, "get");
  const patch = vi.spyOn(issuesApi, "patch");

  let latest!: ReturnType<typeof useStore>;
  const ui = render(
    <StoreProvider>
      <Probe onSnapshot={(api) => (latest = api)} />
    </StoreProvider>,
  );
  await act(async () => {
    await latest.bootstrap();
  });
  await act(async () => {
    // bootstrap больше не грузит задачи (PERF-06): тест исходит из «стор уже знает эти задачи», поэтому догружаем явно
    await latest.ensureAllIssues();
  });
  expect(latest.bootStatus).toBe("ready");
  return {
    store: () => latest,
    get,
    patch,
    errors: () => latest.toasts.filter((t) => t.kind === "error").map((t) => t.text),
    unmount: ui.unmount,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("мутация по id: кэш → точечный GET → явная ошибка", () => {
  test("задача известна стору: GET не нужен, мутация идёт синхронно, как раньше", async () => {
    const h = await setup({ role: "manager", listed: [dto("i1")] });
    h.patch.mockResolvedValue(dto("i1", { title: "Новое" }));
    await act(async () => {
      h.store().updateIssue("i1", { title: "Новое" });
      await flush();
    });
    expect(h.get).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch.mock.calls[0][1]).toBe("i1");
    expect(h.patch.mock.calls[0][2]).toEqual({ title: "Новое" });
    h.unmount();
  });

  test("задачи нет в сторе: подтягивается GET /:id один раз, затем правка; задача остаётся в кэше", async () => {
    const h = await setup({ role: "manager", listed: [] });
    h.get.mockResolvedValue({ ...dto("i9"), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    h.patch.mockResolvedValue(dto("i9", { title: "Новое" }));
    expect(h.store().data.issues).toHaveLength(0);
    await act(async () => {
      h.store().updateIssue("i9", { title: "Новое" });
      await flush();
      await flush();
    });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get.mock.calls[0][1]).toBe("i9");
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.store().data.issues.map((i) => i.id)).toEqual(["i9"]);
    expect(h.errors()).toEqual([]);
    h.unmount();
  });

  test("задача не найдена (удалена параллельно) — явная ошибка, а не тихий return; правка не уходит", async () => {
    const h = await setup({ role: "manager", listed: [] });
    h.get.mockRejectedValue(new ApiError(404, "NOT_FOUND", "не найдено"));
    await act(async () => {
      h.store().updateIssue("gone", { title: "Новое" });
      await flush();
      await flush();
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0]).toMatch(/недоступна/);
    h.unmount();
  });

  test("нет доступа (403) при подтяжке — та же явная ошибка", async () => {
    const h = await setup({ role: "manager", listed: [] });
    h.get.mockRejectedValue(new ApiError(403, "FORBIDDEN", "нет доступа"));
    await act(async () => {
      h.store().updateIssue("closed", { title: "Новое" });
      await flush();
      await flush();
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.errors()[0]).toMatch(/недоступна/);
    h.unmount();
  });

  test("сеть недоступна при подтяжке — ошибка запроса, правка не уходит", async () => {
    const h = await setup({ role: "manager", listed: [] });
    h.get.mockRejectedValue(new ApiError(0, "NETWORK", "Нет связи с сервером"));
    await act(async () => {
      h.store().updateIssue("x", { title: "Новое" });
      await flush();
      await flush();
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.errors()).toHaveLength(1);
    h.unmount();
  });

  test("правило «сотрудник правит только свои» применяется к подтянутой задаче: чужая — отказ с причиной", async () => {
    const h = await setup({ role: "employee", listed: [] });
    h.get.mockResolvedValue({ ...dto("i5", { reporterId: "u9", assigneeIds: ["u8"] }), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    await act(async () => {
      h.store().updateIssue("i5", { title: "Чужое" });
      await flush();
      await flush();
    });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.errors()).toHaveLength(1); // причина отказа показана, а не молчание
    h.unmount();
  });

  test("та же подтянутая задача, но своя (reporter = я): правка проходит", async () => {
    const h = await setup({ role: "employee", listed: [] });
    h.get.mockResolvedValue({ ...dto("i6", { reporterId: "u1" }), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    h.patch.mockResolvedValue(dto("i6", { title: "Своё" }));
    await act(async () => {
      h.store().updateIssue("i6", { title: "Своё" });
      await flush();
      await flush();
    });
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.errors()).toEqual([]);
    h.unmount();
  });
});

describe("issuesRevision — явный счётчик, а не пересчёт по массиву", () => {
  test("растёт при правке, не растёт при комментарии и при открытии карточки", async () => {
    const h = await setup({ role: "manager", listed: [dto("i1")] });
    const r0 = h.store().issuesRevision;

    h.patch.mockResolvedValue(dto("i1", { title: "Новое" }));
    await act(async () => {
      h.store().updateIssue("i1", { title: "Новое" });
      await flush();
    });
    const r1 = h.store().issuesRevision;
    expect(r1).toBeGreaterThan(r0);

    vi.spyOn(commentsApi, "create").mockResolvedValue({ id: "c1", authorId: "u1", body: "привет", createdAt: new Date().toISOString() } as never);
    await act(async () => {
      h.store().addComment("i1", "привет");
      await flush();
    });
    expect(h.store().issuesRevision).toBe(r1); // состав наборов не менялся

    h.get.mockResolvedValue({ ...dto("i1"), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    vi.spyOn(commentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "activity").mockResolvedValue([]);
    await act(async () => {
      h.store().openIssue("i1");
      await flush();
      await flush();
    });
    expect(h.store().issuesRevision).toBe(r1); // заполнение кэша не перезапускает наборы
    h.unmount();
  });

  test("подтяжка неизвестной задачи (заполнение кэша) ревизию не трогает; успешная правка после неё — трогает", async () => {
    const h = await setup({ role: "manager", listed: [] });
    const r0 = h.store().issuesRevision;
    h.get.mockResolvedValue({ ...dto("i9"), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    h.patch.mockResolvedValue(dto("i9", { title: "Новое" }));
    await act(async () => {
      h.store().updateIssue("i9", { title: "Новое" });
      await flush();
      await flush();
    });
    expect(h.store().issuesRevision).toBe(r0 + 1); // ровно одна: от правки, не от подтяжки
    h.unmount();
  });
});

describe("epicsRevision — отдельный сигнал справочника направлений", () => {
  test("растёт от смены заголовка/направления, но не от смены приоритета", async () => {
    const h = await setup({ role: "manager", listed: [dto("i1")] });
    const r0 = h.store().epicsRevision;
    h.patch.mockResolvedValue(dto("i1", { priorityId: "high" }));
    await act(async () => {
      h.store().updateIssue("i1", { priorityId: "high" });
      await flush();
    });
    expect(h.store().epicsRevision).toBe(r0); // порядок/состав наборов мог измениться, справочник — нет

    h.patch.mockResolvedValue(dto("i1", { title: "Новое имя" }));
    await act(async () => {
      h.store().updateIssue("i1", { title: "Новое имя" });
      await flush();
    });
    expect(h.store().epicsRevision).toBe(r0 + 1);

    h.patch.mockResolvedValue(dto("i1", { epicId: "e1" }));
    await act(async () => {
      h.store().updateIssue("i1", { epicId: "e1" });
      await flush();
    });
    expect(h.store().epicsRevision).toBe(r0 + 2);
    h.unmount();
  });
});
