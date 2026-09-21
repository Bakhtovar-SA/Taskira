import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  attachmentsApi,
  authApi,
  avatarApi,
  collaboratorsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";

/** Характеризационные тесты действий подсущностей задачи и уведомлений/аватара, вынесенных из store.tsx в
 *  src/store/issueSub.ts и notifications.ts (ТЗ 2.3, шаг 4): до выноса их почти не покрывал ни один тест. */

const admin = {
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

const bootPayload: ProjectBootstrap = {
  project,
  users: [admin as never],
  members: [],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};

const issue = (id: string): ServerIssue =>
  ({
    id, projectId: "p1", num: 1, key: `A21-${id}`, title: `Задача ${id}`, description: "", typeId: "task", statusId: "s1",
    priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, sprintId: null, color: null,
    tStart: null, tSpan: null, complexity: null, labels: [], dueDate: null, rank: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: null, archivedAt: null,
  }) as unknown as ServerIssue;

const note = (id: string, read: boolean) => ({
  id, type: "issue.comment", actorId: null, actor: null, projectId: "p1", issueId: "i1", payload: {}, createdAt: new Date().toISOString(), read,
});

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

let unmountCurrent: (() => void) | null = null;

async function boot() {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(admin as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootPayload);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [issue("i1")], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [note("n1", false), note("n2", false), note("n3", true)] as never, nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 2 });
  let latest: ReturnType<typeof useStore> | null = null;
  function Probe() {
    latest = useStore();
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
  return () => latest!;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
const theIssue = (get: () => ReturnType<typeof useStore>) => get().data.issues.find((i) => i.id === "i1")!;

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("подсущности задачи (src/store/issueSub.ts)", () => {
  test("addCollaborator / removeCollaborator", async () => {
    const get = await boot();
    vi.spyOn(collaboratorsApi, "add").mockResolvedValue({ userId: "u9", name: "Гость", initials: "Г", color: "#000", jobRole: "x", addedAt: "" });
    const remove = vi.spyOn(collaboratorsApi, "remove").mockResolvedValue(undefined as never);
    act(() => get().addCollaborator("i1", "u9"));
    await settle();
    expect(theIssue(get).collaborators.map((c) => c.userId)).toEqual(["u9"]);
    act(() => get().removeCollaborator("i1", "u9"));
    await settle();
    expect(remove).toHaveBeenCalledWith("p1", "i1", "u9");
    expect(theIssue(get).collaborators).toEqual([]);
  });

  test("addIssueLink / removeIssueLink берут links из ответа API", async () => {
    const get = await boot();
    const link = { id: "l1", dir: "relates", issue: { id: "i2", key: "A21-2", title: "T", typeId: "task", statusId: "s1", statusCategory: "todo" }, createdAt: new Date().toISOString() };
    vi.spyOn(issuesApi, "addLink").mockResolvedValue({ id: "l1", links: [link] } as never);
    vi.spyOn(issuesApi, "removeLink").mockResolvedValue({ links: [] } as never);
    act(() => get().addIssueLink("i1", "i2", "relates"));
    await settle();
    expect(theIssue(get).links.map((l) => l.id)).toEqual(["l1"]);
    act(() => get().removeIssueLink("i1", "l1"));
    await settle();
    expect(theIssue(get).links).toEqual([]);
  });

  test("чек-лист: add → toggle → remove", async () => {
    const get = await boot();
    const item = (done: boolean) => ({ id: "c1", text: "пункт", done, position: 0, createdAt: new Date().toISOString() });
    vi.spyOn(issuesApi, "addChecklistItem").mockResolvedValue({ item: item(false), checklist: [item(false)] } as never);
    vi.spyOn(issuesApi, "patchChecklistItem").mockResolvedValue({ item: item(true), checklist: [item(true)] } as never);
    vi.spyOn(issuesApi, "removeChecklistItem").mockResolvedValue({ checklist: [] } as never);
    act(() => get().addChecklistItem("i1", "пункт"));
    await settle();
    expect(theIssue(get).checklist.map((c) => c.done)).toEqual([false]);
    act(() => get().toggleChecklistItem("i1", "c1", true));
    await settle();
    expect(theIssue(get).checklist.map((c) => c.done)).toEqual([true]);
    act(() => get().removeChecklistItem("i1", "c1"));
    await settle();
    expect(theIssue(get).checklist).toEqual([]);
  });

  test("setCustomFieldValue кладёт values из ответа", async () => {
    const get = await boot();
    const spy = vi.spyOn(issuesApi, "setCustomFieldValue").mockResolvedValue({ values: [{ fieldId: "f1", value: "5" }] } as never);
    act(() => get().setCustomFieldValue("i1", "f1", "5"));
    await settle();
    expect(spy).toHaveBeenCalledWith("p1", "i1", "f1", "5");
    expect(theIssue(get).customFieldValues).toEqual([{ fieldId: "f1", value: "5" }]);
  });

  test("вложения: слишком большой файл не уходит в API; загрузка и удаление отражаются в карточке", async () => {
    const get = await boot();
    const up = vi.spyOn(attachmentsApi, "upload").mockResolvedValue({ id: "a1", issueId: "i1", filename: "a.txt", contentType: "text/plain", byteSize: 3, sha256: "x", uploadedById: "u1", createdAt: new Date().toISOString() });
    const rm = vi.spyOn(attachmentsApi, "remove").mockResolvedValue(undefined as never);
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 1024 * 1024 * 1024 });
    act(() => get().uploadAttachment("i1", big));
    await settle();
    expect(up).not.toHaveBeenCalled();
    act(() => get().uploadAttachment("i1", new File(["abc"], "a.txt", { type: "text/plain" })));
    await settle();
    expect(theIssue(get).attachments.map((a) => a.id)).toEqual(["a1"]);
    act(() => get().removeAttachment("i1", "a1"));
    await settle();
    expect(rm).toHaveBeenCalledWith("p1", "i1", "a1");
    expect(theIssue(get).attachments).toEqual([]);
  });
});

describe("уведомления и аватар (src/store/notifications.ts)", () => {
  test("после bootstrap лента и счётчик из API; markNotificationsRead / dismissNotifications", async () => {
    const get = await boot();
    expect(get().data.notifications.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(get().data.unreadCount).toBe(2);
    const mark = vi.spyOn(notificationsApi, "markRead").mockResolvedValue(undefined as never);
    const dis = vi.spyOn(notificationsApi, "dismiss").mockResolvedValue(undefined as never);
    act(() => get().markNotificationsRead(["n1"]));
    await settle();
    expect(mark).toHaveBeenCalledWith(["n1"]);
    expect(get().data.notifications.find((n) => n.id === "n1")!.read).toBe(true);
    expect(get().data.unreadCount).toBe(1);
    act(() => get().dismissNotifications(["n2"]));
    await settle();
    expect(dis).toHaveBeenCalledWith(["n2"]);
    expect(get().data.notifications.map((n) => n.id)).toEqual(["n1", "n3"]);
  });

  test("refreshNotifications перечитывает ленту; setNotifyPrefs сохраняет ответ сервера", async () => {
    const get = await boot();
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [note("n9", false)] as never, nextCursor: null });
    vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 1 });
    await act(async () => {
      await get().refreshNotifications();
    });
    expect(get().data.notifications.map((n) => n.id)).toEqual(["n9"]);
    vi.spyOn(notificationsApi, "setPrefs").mockResolvedValue({ notifyPrefs: { email: "daily" } } as never);
    act(() => get().setNotifyPrefs({ email: "daily" }));
    await settle();
    expect(get().data.notifyPrefs).toEqual({ email: "daily" });
  });

  test("uploadAvatar / removeAvatar меняют avatarUpdatedAt текущего пользователя", async () => {
    const get = await boot();
    vi.spyOn(avatarApi, "upload").mockResolvedValue({ avatarUpdatedAt: 12345 });
    vi.spyOn(avatarApi, "remove").mockResolvedValue(undefined as never);
    await act(async () => {
      await get().uploadAvatar(new File(["x"], "me.png", { type: "image/png" }));
    });
    expect(get().data.users.find((u) => u.id === "u1")!.avatarUpdatedAt).toBe(12345);
    await act(async () => {
      await get().removeAvatar();
    });
    expect(get().data.users.find((u) => u.id === "u1")!.avatarUpdatedAt).toBeNull();
  });
});
