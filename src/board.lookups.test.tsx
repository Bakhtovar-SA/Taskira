import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type IssueEpic,
  type IssuePageParams,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import Board from "./components/Board";

/**
 * PERF-06, реестр риска «нет в сторе ≠ не существует» (A12). Доска перестала искать
 * перетаскиваемую задачу и направление карточки в списке всех задач стора. Проверяем
 * ровно те места, где отсутствие в сторе раньше тихо меняло поведение:
 *  - `canDropTo`: перетаскиваемая карточка, которой НЕТ в сторе, по-прежнему получает
 *    подсказку «переход вне схемы» — проверка допустимости не «отключается»;
 *  - бейдж направления берётся из справочника `epics`, а не из стора.
 */

const user = {
  id: "u1",
  username: "u1",
  name: "Пользователь",
  initials: "П",
  color: "#0B5FD9",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
};
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };

const bootWith = (transitions: { id: string; from: string; to: string }[]): ProjectBootstrap => ({
  project,
  users: [user as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: {
    statuses: [
      { id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 },
      { id: "s2", sid: "done", name: "Готово", category: "done", position: 1 },
    ],
    transitions,
  },
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

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); await flush(); await flush(); });
const dataTransfer = () => ({ setData: () => {}, getData: () => "", effectAllowed: "", dropEffect: "" });

/** Стор ПУСТ (list → []): карточки существуют только в страницах колонок, как при ленивой загрузке. */
async function setup(transitions: { id: string; from: string; to: string }[], epics: IssueEpic[] = [], cardEpicId?: string) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(bootWith(transitions));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  vi.spyOn(issuesApi, "assignees").mockResolvedValue({ items: [] });
  vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 1, byStatus: { s1: 1 } });
  const epicsSpy = vi.spyOn(issuesApi, "epics").mockResolvedValue({ items: epics, truncated: false });
  vi.spyOn(issuesApi, "page").mockImplementation(async (_p, params: IssuePageParams) => ({
    items: params.status === "s1" ? [dto("i1", { epicId: cardEpicId ?? epics[0]?.id ?? null })] : [],
    hasMore: false,
    nextCursor: null,
  }));

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  const tree = (withBoard: boolean) => (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        {withBoard && <Board />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  expect(store.data.issues).toHaveLength(0);
  ui.rerender(tree(true));
  await settle();
  return { ui, store: () => store, epicsSpy };
}

const epic = (over: Partial<IssueEpic> = {}): IssueEpic => ({
  id: "e1",
  key: "A21-e1",
  title: "Направление «Альфа»",
  color: "#ff0000",
  tStart: null,
  tSpan: null,
  childTotal: 1,
  childDone: 0,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Доска при частичном сторе", () => {
  test("перетаскивание карточки, которой нет в сторе: переход вне схемы по-прежнему помечен запрещённым", async () => {
    // переходов из «К работе» в «Готово» нет
    const h = await setup([{ id: "t1", from: "s2", to: "s1" }]);
    const card = screen.getByRole("article", { name: /A21-i1/ });
    fireEvent.dragStart(card, { dataTransfer: dataTransfer() });
    const columns = document.querySelectorAll("section");
    fireEvent.dragOver(columns[1], { dataTransfer: dataTransfer() }); // «Готово»
    await settle();
    expect(screen.getByText(/вне схемы/)).toBeTruthy();
    h.ui.unmount();
  });

  test("разрешённый переход подсказки «вне схемы» не даёт, а свою колонку тоже", async () => {
    const h = await setup([{ id: "t1", from: "s1", to: "s2" }]);
    const card = screen.getByRole("article", { name: /A21-i1/ });
    fireEvent.dragStart(card, { dataTransfer: dataTransfer() });
    const columns = document.querySelectorAll("section");
    fireEvent.dragOver(columns[1], { dataTransfer: dataTransfer() });
    await settle();
    expect(screen.queryByText(/вне схемы/)).toBeNull();
    fireEvent.dragOver(columns[0], { dataTransfer: dataTransfer() });
    await settle();
    expect(screen.queryByText(/вне схемы/)).toBeNull();
    h.ui.unmount();
  });

  test("бейдж направления на карточке берётся из справочника epics (в сторе направления нет)", async () => {
    const h = await setup([], [epic()]);
    expect(screen.getByText("Направление «Альфа»")).toBeTruthy();
    expect(h.epicsSpy).toHaveBeenCalledTimes(1); // один запрос на открытие доски
    h.ui.unmount();
  });

  test("направления нет в справочнике: бейдж скрыт, карточка на месте, доска не ломается", async () => {
    const h = await setup([], [epic()], "unknown");
    expect(screen.getByRole("article", { name: /A21-i1/ })).toBeTruthy();
    expect(screen.queryByText("Направление «Альфа»")).toBeNull();
    h.ui.unmount();
  });
});
