import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useNotifications, useStore, useToasts, useUnreadCount } from "./store";
import { createExternalStore, useExternalStore } from "./store/external";
import { ApiError, authApi, departmentsApi, issuesApi, notificationsApi, projectsApi, type ProjectBootstrap } from "./api";

/**
 * ADR-0011, шаги 1–2: тосты и уведомления вынесены из общего контекста во внешние хранилища. Проверяем и поведение
 * (то же, что было, когда они жили в `useStore()`/`data`), и главное свойство — их изменение НЕ перерисовывает
 * потребителей `useStore()` (раньше перерисовывало всё дерево, включая все карточки доски).
 */

const admin = {
  id: "u1",
  username: "admin",
  name: "Админ Админов",
  initials: "АА",
  color: "var(--gray-9)",
  jobRole: "Администратор",
  globalRole: "admin" as const,
  isActive: true,
  authSource: "local" as const,
};
const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };
const bootPayload: ProjectBootstrap = {
  project,
  users: [admin as never],
  members: [],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};
const note = (id: string, read: boolean) => ({
  id, type: "issue.comment", actorId: null, actor: null, projectId: "p1", issueId: "i1", payload: {}, createdAt: new Date().toISOString(), read,
});

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() {
    FakeWebSocket.last = this;
  }
  send(): void {}
  close(): void {}
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });

async function boot() {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  let unread = 2;
  vi.spyOn(authApi, "me").mockResolvedValue(admin as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootPayload);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [note("n1", false), note("n2", false)] as never, nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockImplementation(async () => ({ count: unread }));

  const renders = { store: 0, toasts: 0, unread: 0, feed: 0 };
  let store!: ReturnType<typeof useStore>;
  let toasts!: ReturnType<typeof useToasts>;
  let unreadCount = -1;
  let feed!: ReturnType<typeof useNotifications>;
  function StoreConsumer() {
    renders.store++;
    store = useStore();
    return null;
  }
  function ToastsConsumer() {
    renders.toasts++;
    toasts = useToasts();
    return null;
  }
  function UnreadConsumer() {
    renders.unread++;
    unreadCount = useUnreadCount();
    return null;
  }
  function FeedConsumer() {
    renders.feed++;
    feed = useNotifications();
    return null;
  }
  const utils = render(
    <StoreProvider>
      <StoreConsumer />
      <ToastsConsumer />
      <UnreadConsumer />
      <FeedConsumer />
    </StoreProvider>,
  );
  await act(async () => {
    await store.bootstrap();
  });
  await settle();
  expect(store.bootStatus).toBe("ready");
  return {
    renders,
    store: () => store,
    toasts: () => toasts,
    unread: () => unreadCount,
    feed: () => feed,
    setServerUnread: (n: number) => (unread = n),
    unmount: utils.unmount,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createExternalStore / useExternalStore", () => {
  test("подписчик получает новое значение; тот же объект — без уведомления", () => {
    const s = createExternalStore({ a: 1, b: 1 });
    const l = vi.fn();
    const off = s.subscribe(l);
    s.setState((p) => p);
    expect(l).not.toHaveBeenCalled();
    s.setState((p) => ({ ...p, a: 2 }));
    expect(l).toHaveBeenCalledTimes(1);
    expect(s.getState().a).toBe(2);
    off();
    s.setState((p) => ({ ...p, a: 3 }));
    expect(l).toHaveBeenCalledTimes(1);
  });

  test("компонент перерисовывается, только когда меняется значение его селектора", () => {
    const s = createExternalStore({ a: 1, b: 1 });
    let renders = 0;
    let seen = 0;
    function A() {
      renders++;
      seen = useExternalStore(s, (x) => x.a);
      return null;
    }
    render(<A />);
    expect(renders).toBe(1);
    act(() => s.setState((p) => ({ ...p, b: 2 })));
    expect(renders).toBe(1);
    act(() => s.setState((p) => ({ ...p, a: 5 })));
    expect(renders).toBe(2);
    expect(seen).toBe(5);
  });
});

describe("тосты — отдельное хранилище (ADR-0011, шаг 1)", () => {
  test("toast() показывает тост, не перерисовывая потребителей useStore(); тост гаснет через 4.2 с", async () => {
    const h = await boot();
    const toastFn = h.store().toast;
    const before = { ...h.renders };
    vi.useFakeTimers();
    act(() => h.store().toast("info", "Привет"));
    expect(h.toasts().map((t) => t.text)).toEqual(["Привет"]);
    expect(h.renders.toasts).toBe(before.toasts + 1);
    expect(h.renders.store).toBe(before.store); // провайдер не перерисовывался
    expect(h.store().toast).toBe(toastFn); // функция стабильна
    act(() => vi.advanceTimersByTime(4200));
    expect(h.toasts()).toEqual([]);
    h.unmount();
  });

  test("не больше четырёх тостов одновременно — старые вытесняются", async () => {
    const h = await boot();
    act(() => {
      for (let i = 1; i <= 6; i++) h.store().toast("info", `t${i}`);
    });
    expect(h.toasts().map((t) => t.text)).toEqual(["t3", "t4", "t5", "t6"]);
    h.unmount();
  });
});

describe("уведомления — отдельное хранилище (ADR-0011, шаг 2)", () => {
  test("после bootstrap: лента и счётчик из API", async () => {
    const h = await boot();
    expect(h.feed().notifications.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(h.unread()).toBe(2);
    h.unmount();
  });

  test("WS notify → счётчик обновляется у подписчиков, потребители useStore() и ленты не перерисовываются", async () => {
    const h = await boot();
    const before = { ...h.renders };
    h.setServerUnread(5);
    await act(async () => {
      FakeWebSocket.last!.onmessage!({ data: JSON.stringify({ type: "notify" }) });
    });
    await settle();
    expect(h.unread()).toBe(5);
    expect(h.renders.unread).toBe(before.unread + 1);
    expect(h.renders.store).toBe(before.store);
    // useNotifications() подписан на всё состояние — он перерисуется; useUnreadCount() — только на число.
    expect(h.feed().unreadCount).toBe(5);
    h.unmount();
  });

  test("тот же счётчик с сервера — никто не перерисовывается", async () => {
    const h = await boot();
    const before = { ...h.renders };
    await act(async () => {
      FakeWebSocket.last!.onmessage!({ data: JSON.stringify({ type: "notify" }) });
    });
    await settle();
    expect(h.renders).toEqual(before);
    h.unmount();
  });

  test("markNotificationsRead меняет ленту без перерисовки потребителей useStore()", async () => {
    const h = await boot();
    vi.spyOn(notificationsApi, "markRead").mockResolvedValue(undefined as never);
    const before = h.renders.store;
    act(() => h.store().markNotificationsRead(["n1"]));
    await settle();
    expect(h.feed().notifications.find((n) => n.id === "n1")!.read).toBe(true);
    expect(h.unread()).toBe(1);
    expect(h.renders.store).toBe(before);
    h.unmount();
  });

  test("logout сбрасывает ленту и счётчик (как раньше вместе с data)", async () => {
    const h = await boot();
    act(() => h.store().logout());
    await settle();
    expect(h.feed().notifications).toEqual([]);
    expect(h.unread()).toBe(0);
    h.unmount();
  });

  test("401 от API сбрасывает ленту и счётчик вместе с сессией", async () => {
    const h = await boot();
    vi.spyOn(notificationsApi, "markRead").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Сессия истекла"));
    act(() => h.store().markNotificationsRead(["n1"]));
    await settle();
    expect(h.store().bootStatus).toBe("unauthenticated");
    expect(h.feed().notifications).toEqual([]);
    expect(h.unread()).toBe(0);
    h.unmount();
  });
});
