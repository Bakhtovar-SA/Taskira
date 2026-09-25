import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import { authApi, departmentsApi, issuesApi, notificationsApi, projectsApi, type ProjectBootstrap, type ServerIssue } from "./api";
import { I18nProvider } from "./i18n";
import CommandPalette from "./components/CommandPalette";

/**
 * Командная палитра (ТЗ 5.8 п.4): команды находятся нечётко и в чужой раскладке,
 * Enter выполняет выбранную строку и закрывает палитру, задачи ищутся и в текущем
 * проекте по подстроке, и во всех проектах.
 */

const user = { id: "u1", username: "u1", name: "Пользователь", initials: "П", color: "#0B5FD9", jobRole: "", globalRole: "member" as const, isActive: true, authSource: "local" as const };
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };
const boot: ProjectBootstrap = {
  project,
  users: [user as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: {
    statuses: [
      { id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 },
      { id: "s2", sid: "done", name: "Готово", category: "done", position: 1 },
    ],
    transitions: [],
  },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};
const dto = (id: string, title: string): ServerIssue =>
  ({
    id, key: `A21-${id}`, title, description: "", typeId: "task", statusId: "s1", priorityId: "medium", assigneeIds: [], reporterId: "u1",
    epicId: null, parentId: null, labels: [], complexity: null, dueDate: null, rank: 1,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", doneAt: null, archivedAt: null,
  }) as unknown as ServerIssue;

class FakeWebSocket {
  onopen = null;
  onclose = null;
  onmessage = null;
  send(): void {}
  close(): void {}
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });

async function setup() {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  vi.spyOn(issuesApi, "page").mockResolvedValue({ items: [dto("i1", "Интеграция с 1С")], hasMore: false, nextCursor: null });
  vi.spyOn(issuesApi, "search").mockResolvedValue({ items: [], truncated: false });

  let store!: ReturnType<typeof useStore>;
  const onClose = vi.fn();
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (open: boolean) => (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        {open && <CommandPalette onClose={onClose} onShortcuts={() => {}} />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  ui.rerender(tree(true));
  await settle();
  return { store: () => store, onClose, input: screen.getByRole("combobox") };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Командная палитра", () => {
  test("запрос в чужой раскладке находит раздел, Enter переключает вид и закрывает палитру", async () => {
    const h = await setup();
    fireEvent.change(h.input, { target: { value: "cgbcjr" } }); // «список» на QWERTY
    const first = screen.getAllByRole("option")[0];
    expect(first.textContent).toContain("Список задач");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Ищем «список»")).toBeTruthy();
    fireEvent.keyDown(h.input, { key: "Enter" });
    expect(h.onClose).toHaveBeenCalled();
    expect(h.store().ui.view).toBe("backlog");
  });

  test("стрелки двигают выделение по кругу", async () => {
    const h = await setup();
    const options = () => screen.getAllByRole("option");
    fireEvent.keyDown(h.input, { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(h.input, { key: "ArrowUp" });
    fireEvent.keyDown(h.input, { key: "ArrowUp" });
    expect(options()[options().length - 1].getAttribute("aria-selected")).toBe("true");
  });

  test("часть слова находит задачу текущего проекта", async () => {
    const h = await setup();
    await act(async () => {
      fireEvent.change(h.input, { target: { value: "интегр" } });
      await new Promise((r) => setTimeout(r, 450));
    });
    await settle();
    const opt = screen.getAllByRole("option").find((o) => o.textContent?.includes("Интеграция с 1С"));
    expect(opt?.textContent).toContain("A21-i1");
  });
});
