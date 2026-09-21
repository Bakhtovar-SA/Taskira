import { describe, expect, test, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  customFieldsApi,
  departmentsApi,
  issuesApi,
  membersApi,
  notificationsApi,
  projectsApi,
  workflowApi,
  type ProjectBootstrap,
} from "./api";

/** Характеризационные тесты действий, вынесенных из store.tsx в src/store/meta.ts и org.ts (ТЗ 2.3, шаг 3): до выноса
 *  их не покрывал ни один тест. Проверяют, что стор верно отражает ответы API и что права проверяются до запроса. */

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
const viewerUser = { ...admin, id: "u2", username: "v", globalRole: "member" as const };
const project = { id: "p1", key: "A21", name: "Проект 1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };

const bootPayload = (users: unknown[] = [admin]): ProjectBootstrap => ({
  project,
  users: users as never,
  members: [{ userId: "u2", role: "viewer" }],
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
});

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

let unmountCurrent: (() => void) | null = null;

async function bootAs(me: typeof admin | typeof viewerUser) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(me as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootPayload([admin, viewerUser]));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
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
  expect(latest!.bootStatus).toBe("ready");
  return () => latest!;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workflow / поля (src/store/meta.ts)", () => {
  test("addTransition: переход из ответа API попадает в data.workflow.transitions; одинаковые статусы — сообщение без запроса", async () => {
    const get = await bootAs(admin);
    const spy = vi.spyOn(workflowApi, "addTransition").mockResolvedValue({ id: "t1", from: "s1", to: "s2" });
    expect(get().addTransition("s1", "s1")).toMatch(/совпадают|same/);
    expect(spy).not.toHaveBeenCalled();
    act(() => {
      expect(get().addTransition("s1", "s2")).toBeNull();
    });
    await settle();
    expect(spy).toHaveBeenCalledWith("p1", "s1", "s2");
    expect(get().data.workflow.transitions).toEqual([{ id: "t1", from: "s1", to: "s2" }]);
  });

  test("addCustomField: пустое имя — тост и без запроса; иначе поле добавляется в data.customFields", async () => {
    const get = await bootAs(admin);
    const create = vi.spyOn(customFieldsApi, "create").mockResolvedValue({ id: "f1", name: "Оценка", fieldType: "number", options: [], position: 0 });
    act(() => get().addCustomField("   ", "text", []));
    expect(create).not.toHaveBeenCalled();
    act(() => get().addCustomField(" Оценка ", "number", []));
    await settle();
    expect(create).toHaveBeenCalledWith("p1", { name: "Оценка", fieldType: "number", options: [] });
    expect(get().data.customFields.map((f) => f.name)).toEqual(["Оценка"]);
  });
});

describe("участники / проекты (src/store/org.ts)", () => {
  test("setMemberRole и removeMember отражают ответ API в data.members", async () => {
    const get = await bootAs(admin);
    vi.spyOn(membersApi, "set").mockResolvedValue({ userId: "u2", role: "employee" });
    const remove = vi.spyOn(membersApi, "remove").mockResolvedValue(undefined as never);
    act(() => get().setMemberRole("u2", "employee"));
    await settle();
    expect(get().data.members.u2).toBe("employee");
    act(() => get().removeMember("u2"));
    await settle();
    expect(remove).toHaveBeenCalledWith("p1", "u2");
    expect(get().data.members.u2).toBeUndefined();
  });

  test("createProject: после ответа API список проектов перечитывается (refreshOrg)", async () => {
    const get = await bootAs(admin);
    const created = { ...project, id: "p2", key: "NEW", name: "Новый" };
    vi.spyOn(projectsApi, "create").mockResolvedValue(created as never);
    vi.spyOn(projectsApi, "list").mockResolvedValue([project, created] as never);
    act(() => get().createProject({ key: "NEW", name: "Новый", departmentId: "d1" }));
    await settle();
    expect(get().data.projects.map((p) => p.key)).toEqual(["A21", "NEW"]);
  });

  test("без права manageAccess/editWorkflow действие не доходит до API (не админ)", async () => {
    const get = await bootAs(viewerUser);
    const set = vi.spyOn(membersApi, "set");
    const tr = vi.spyOn(workflowApi, "addTransition");
    act(() => get().setMemberRole("u2", "employee"));
    act(() => {
      get().addTransition("s1", "s2");
    });
    await settle();
    expect(set).not.toHaveBeenCalled();
    expect(tr).not.toHaveBeenCalled();
  });
});
