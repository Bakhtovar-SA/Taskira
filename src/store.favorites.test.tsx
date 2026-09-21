import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
} from "./api";

/** Избранные проекты (миграция 024) — toggleFavoriteProject() оптимистично
 *  переключает data.favoriteProjectIds и откатывает при отказе сервера;
 *  searchAllProjects() — тонкая обёртка над issuesApi.search() с обработкой
 *  ошибки (не бросает наружу, чтобы SearchBox не падал на неудачном запросе). */

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

async function bootToReady(favoriteProjectIds: string[] = []): Promise<{ get: () => ReturnType<typeof useStore> }> {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue({ ...baseUser, favoriteProjectIds } as never);
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

describe("избранные проекты и кросс-проектный поиск", () => {
  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("bootstrap() подтягивает favoriteProjectIds из /api/auth/me", async () => {
    const store = await bootToReady(["p1"]);
    expect(store.get().data.favoriteProjectIds).toEqual(["p1"]);
  });

  test("toggleFavoriteProject() добавляет проект оптимистично, до ответа сервера", async () => {
    const store = await bootToReady([]);
    let resolveFavorite: () => void = () => {};
    vi.spyOn(projectsApi, "favorite").mockImplementation(
      () => new Promise((resolve) => { resolveFavorite = () => resolve(undefined); }),
    );

    act(() => {
      store.get().toggleFavoriteProject("p1");
    });
    // Мгновенно, ещё до резолва промиса — это и есть смысл оптимистичного апдейта.
    expect(store.get().data.favoriteProjectIds).toEqual(["p1"]);

    await act(async () => {
      resolveFavorite();
      await flush();
    });
    expect(store.get().data.favoriteProjectIds).toEqual(["p1"]);
  });

  test("toggleFavoriteProject() откатывает оптимистичный апдейт при отказе сервера", async () => {
    const store = await bootToReady([]);
    vi.spyOn(projectsApi, "favorite").mockRejectedValue(new Error("network"));

    await act(async () => {
      store.get().toggleFavoriteProject("p1");
      await flush();
    });

    expect(store.get().data.favoriteProjectIds).toEqual([]);
  });

  test("toggleFavoriteProject() снимает уже избранный проект", async () => {
    const store = await bootToReady(["p1"]);
    vi.spyOn(projectsApi, "unfavorite").mockResolvedValue(undefined);

    await act(async () => {
      store.get().toggleFavoriteProject("p1");
      await flush();
    });

    expect(store.get().data.favoriteProjectIds).toEqual([]);
  });

  test("searchAllProjects() возвращает результаты сервера", async () => {
    const store = await bootToReady([]);
    vi.spyOn(issuesApi, "search").mockResolvedValue({
      items: [
        {
          id: "i1",
          projectId: "p2",
          key: "SEC-1",
          title: "Найденная задача",
          typeId: "task",
          priorityId: "medium",
          statusId: "s1",
          statusName: "К работе",
          statusCategory: "todo",
          projectKey: "SEC",
          projectName: "Проект 2",
        },
      ],
      truncated: false,
    });

    const res = await store.get().searchAllProjects("Найденная");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].projectKey).toBe("SEC");
  });

  test("searchAllProjects() не бросает наружу при ошибке сервера — возвращает пустой результат", async () => {
    const store = await bootToReady([]);
    vi.spyOn(issuesApi, "search").mockRejectedValue(new Error("network"));

    const res = await store.get().searchAllProjects("что угодно");
    expect(res).toEqual({ items: [], truncated: false });
  });
});
