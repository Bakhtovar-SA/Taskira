import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import { authApi, departmentsApi, issuesApi, notificationsApi, projectsApi } from "./api";
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
  { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false },
  { id: "p2", key: "CORP", name: "Проект 2", description: "", departmentId: "d2", isShared: true },
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
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null, unread: 0 });

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
