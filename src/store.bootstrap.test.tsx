import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import { authApi, departmentsApi, issuesApi, notificationsApi, projectsApi, type ProjectBootstrap } from "./api";
import type { AssignedIssue } from "./types";

/**
 * bootstrap() → главный экран (≥2 проектов). Ловит класс бага, который дошёл
 * до main: issuesApi.assignedToMe() отдаёт {items, truncated, limit}, а не
 * голый массив — если код положит объект целиком в data.assignedToMe, тест
 * должен упасть здесь, а не крашем HomeView в браузере.
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

const projects = [
  { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false },
  { id: "p2", key: "CORP", name: "Проект 2", description: "", departmentId: "d2", isShared: true, sprintsEnabled: false },
];

const assignedItems: AssignedIssue[] = [
  {
    issueId: "i1",
    projectId: "p1",
    key: "A21-1",
    title: "Тестовая задача",
    typeId: "task",
    priorityId: "medium",
    statusId: "s1",
    statusName: "К работе",
    statusCategory: "todo",
    dueDate: null,
    projectKey: "A21",
    projectName: "Проект 1",
  },
];

function Probe({ onSnapshot }: { onSnapshot: (api: ReturnType<typeof useStore>) => void }) {
  const api = useStore();
  onSnapshot(api);
  return null;
}

describe("bootstrap → главный экран (≥2 проектов)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("data.assignedToMe остаётся массивом задач, а не {items, truncated}", async () => {
    localStorage.setItem("taskira.token", "test-token");
    vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
    vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
    vi.spyOn(projectsApi, "list").mockResolvedValue(projects as never);
    vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
    vi.spyOn(issuesApi, "assignedToMe").mockResolvedValue({ items: assignedItems, truncated: false, limit: 200 });
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });

    let latest: ReturnType<typeof useStore> | null = null;
    render(
      <StoreProvider>
        <Probe onSnapshot={(api) => { latest = api; }} />
      </StoreProvider>,
    );

    await act(async () => {
      await latest!.bootstrap();
    });

    expect(latest!.bootStatus).toBe("home");
    expect(Array.isArray(latest!.data.assignedToMe)).toBe(true);
    expect(latest!.data.assignedToMe).toHaveLength(1);
    expect(latest!.data.assignedToMe[0].key).toBe("A21-1");
    expect(latest!.data.assignedTruncated).toBe(false);
  });
});

/** bootstrap() → один проект (single-project path, buildProjectData()).
 *  Ревью PR #47: миграция 022 добавила обязательное поле issueTemplates
 *  в ProjectBootstrap, и store.tsx сразу делает
 *  boot.issueTemplates.map(mapIssueTemplate) без опционального доступа —
 *  тот же класс риска, что и assignedToMe выше (сборка/деплой
 *  рассинхронизировали клиент и сервер, поле отсутствует/undefined на
 *  реальном ответе → .map() на undefined крашит вход в проект целиком). */
describe("bootstrap → один проект (single-project path)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    send(): void {}
    close(): void {}
  }

  test("boot.issueTemplates корректно превращается в data.issueTemplates, не крашит вход в проект", async () => {
    localStorage.setItem("taskira.token", "test-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
    vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
    vi.spyOn(projectsApi, "list").mockResolvedValue([projects[0]] as never);
    vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
    vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false });
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
    const boot: ProjectBootstrap = {
      project: projects[0],
      users: [baseUser as never],
      members: [{ userId: "u1", role: "manager" }],
      workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo" }], transitions: [] },
      issueTemplates: [
        { id: "t1", name: "Баг-репорт", typeId: "bug", priorityId: "high", title: "Баг: ", description: "", statusId: null, position: 0 },
      ],
      customFields: [],
      sprints: [],
    };
    vi.spyOn(projectsApi, "get").mockResolvedValue(boot);

    let latest: ReturnType<typeof useStore> | null = null;
    const { unmount } = render(
      <StoreProvider>
        <Probe onSnapshot={(api) => { latest = api; }} />
      </StoreProvider>,
    );
    await act(async () => {
      await latest!.bootstrap();
    });

    expect(latest!.bootStatus).toBe("ready");
    expect(Array.isArray(latest!.data.issueTemplates)).toBe(true);
    expect(latest!.data.issueTemplates).toHaveLength(1);
    expect(latest!.data.issueTemplates[0]).toMatchObject({ id: "t1", name: "Баг-репорт", typeId: "bug" });
    unmount();
  });
});
