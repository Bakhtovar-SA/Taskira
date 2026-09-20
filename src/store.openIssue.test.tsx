import { describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
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
 * openIssue() — регрессия найдена вручную при smoke-тесте множественных
 * исполнителей (не связана с самой этой задачей). upsertIssue() раньше
 * принудительно возвращал comments/activity к тому, что уже было в
 * data.issues ДО открытия карточки — обычно [] (список задач их не знает,
 * см. mapIssue()). openIssue() сам кладёт в mapped свежие comments/activity
 * ПОСЛЕ mapIssue() именно затем, чтобы их показать, но upsertIssue() эту
 * подстановку тут же затирал обратно. Итог: вкладки «Комментарии»/«История»
 * при первом открытии карточки всегда выглядели пустыми, даже когда на
 * сервере были и комментарии, и записи истории.
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

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openIssue() — вкладки Комментарии/История отражают свежий fetch, а не то, что было в списке (регрессия)", () => {
  test("GET .../issues/:id + comments + activity, вызванные openIssue(), попадают в data.issues, а не теряются", async () => {
    localStorage.setItem("taskira.token", "test-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(authApi, "me").mockResolvedValue(baseUser as never);
    vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
    vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
    vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
    vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
    vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
    // Задача уже в списке (как после обычной загрузки доски) — до открытия
    // карточки comments/activity у неё пустые, как и мэппит mapIssue() для
    // списочного ответа.
    vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [fakeServerIssue("i1")], hasMore: false });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });

    let latest: ReturnType<typeof useStore> | null = null;
    const { unmount } = render(
      <StoreProvider>
        <Probe onSnapshot={(api) => { latest = api; }} />
      </StoreProvider>,
    );
    try {
      await act(async () => {
        await latest!.bootstrap();
      });
      expect(latest!.bootStatus).toBe("ready");
      expect(latest!.data.issues.find((i) => i.id === "i1")?.comments).toEqual([]);
      expect(latest!.data.issues.find((i) => i.id === "i1")?.activity).toEqual([]);

      vi.spyOn(issuesApi, "get").mockResolvedValue(fakeServerIssue("i1"));
      vi.spyOn(commentsApi, "list").mockResolvedValue([
        { id: "c1", authorId: "u1", body: "первый комментарий", createdAt: new Date().toISOString() },
      ] as never);
      vi.spyOn(issuesApi, "activity").mockResolvedValue([
        {
          id: "a1",
          actorId: "u1",
          actor: { id: "u1", name: baseUser.name, initials: baseUser.initials, color: baseUser.color },
          text: "создал(а) задачу",
          createdAt: new Date().toISOString(),
        },
      ] as never);

      await act(async () => {
        latest!.openIssue("i1");
        await flush();
      });

      const opened = latest!.data.issues.find((i) => i.id === "i1");
      expect(opened?.comments).toHaveLength(1);
      expect(opened?.comments[0].body).toBe("первый комментарий");
      expect(opened?.activity).toHaveLength(1);
      expect(opened?.activity[0].text).toBe("создал(а) задачу");
    } finally {
      unmount();
      localStorage.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
