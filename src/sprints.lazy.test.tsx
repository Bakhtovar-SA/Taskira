import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoreProvider, useStore, useToasts } from "./store";
import {
  authApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  sprintsApi,
  type ProjectBootstrap,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import SprintsView from "./components/SprintsView";

import { enter, exit, flipFrom } from "./motion";
vi.mock("./motion", async importOriginal => ({ ...(await importOriginal<typeof import("./motion")>()),
  motionReduced: () => false, cssZoom: () => 1, enter: vi.fn(), exit: vi.fn(() => Promise.resolve()), flipFrom: vi.fn(() => Promise.resolve()) }));

/**
 * PERF-06 A15: Sprints — осознанное исключение «обернуть, не оптимизировать». Его единственная
 * особенность — полный набор задач проекта, поэтому экран сам запрашивает его при входе
 * (`ensureAllIssues`), а bootstrap больше ничего целиком не грузит (финальный шаг PERF-06: eager-режима нет).
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
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: true, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
const boot: ProjectBootstrap = {
  project,
  users: [user as never],
  members: [{ userId: "u1", role: "manager" }],
  workflow: { statuses: [{ id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 }], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
};

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
    sprintId: null,
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

type ListPage = { items: ServerIssue[]; hasMore: boolean; nextCursor: string | null };

async function setup(listed: ServerIssue[], showSprints: boolean, listImpl?: () => Promise<ListPage>, sprints: ProjectBootstrap["sprints"] = []) {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue({ ...boot, sprints });
  const list = vi.spyOn(issuesApi, "list").mockImplementation(listImpl ?? (async () => ({ items: listed, hasMore: false, nextCursor: null })));
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });

  let store!: ReturnType<typeof useStore>;
  let toasts: ReturnType<typeof useToasts> = [];
  function Grab() {
    store = useStore();
    toasts = useToasts();
    return null;
  }
  const tree = (withSprints: boolean) => (
    <I18nProvider>
      <StoreProvider>
        <Grab />
        {withSprints && <SprintsView />}
      </StoreProvider>
    </I18nProvider>
  );
  const ui = render(tree(false));
  await act(async () => {
    await store.bootstrap();
  });
  const afterBootstrap = list.mock.calls.length;
  if (showSprints) ui.rerender(tree(true));
  await settle();
  return { ui, store: () => store, toasts: () => toasts, list, afterBootstrap };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Sprints — единственный потребитель полной загрузки", () => {
  test("не-eager bootstrap ничего целиком не грузит: стор пуст, issuesComplete = false", async () => {
    const h = await setup([dto("i1")], false);
    expect(h.afterBootstrap).toBe(0);
    expect(h.store().data.issues).toHaveLength(0);
    expect(h.store().data.issuesComplete).toBe(false);
    h.ui.unmount();
  });

  test("вход на экран Sprints догружает все задачи один раз, бэклог показывает их", async () => {
    const h = await setup([dto("i1", { title: "Из бэклога" }), dto("i2")], true);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.store().data.issuesComplete).toBe(true);
    expect(h.store().data.issues.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
    expect(screen.getByText("Из бэклога")).toBeTruthy();
    h.ui.unmount();
  });

  test("ensureAllIssues идемпотентна: одновременные вызовы — один обход; повторный после загрузки — ни одного", async () => {
    const h = await setup([dto("i1")], false);
    await act(async () => {
      await Promise.all([h.store().ensureAllIssues(), h.store().ensureAllIssues(), h.store().ensureAllIssues()]);
    });
    expect(h.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.store().ensureAllIssues();
    });
    expect(h.list).toHaveBeenCalledTimes(1);
    h.ui.unmount();
  });

  test("догрузка не затирает уже известные объекты и не теряет известные задачи вне списка", async () => {
    const h = await setup([dto("i1", { title: "Из списка" })], false);
    vi.spyOn(issuesApi, "get").mockResolvedValue({ ...dto("known", { title: "Открытая архивная" }), links: [], checklist: [], attachments: [], collaborators: [], participants: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0 } as never);
    // «архивная» задача известна стору (её открывали), но в списке активных её нет
    const known = await h.store().lookupIssue("known");
    expect(known?.title).toBe("Открытая архивная");
    await act(async () => {
      await h.store().ensureAllIssues();
    });
    expect(h.store().data.issues.map((i) => i.id).sort()).toEqual(["i1", "known"]);
    h.ui.unmount();
  });

  test("до загрузки экран не показывает ложное «в бэклоге пусто»: скелет и подпись, затем задачи", async () => {
    let release!: (v: ListPage) => void;
    const h = await setup([], true, () => new Promise<ListPage>((r) => (release = r)));
    expect(screen.getAllByLabelText("Загружаем задачи проекта…").length).toBeGreaterThan(0);
    expect(screen.queryByText(/пуст/i)).toBeNull();
    await act(async () => {
      release({ items: [dto("i1", { title: "Пришла позже" })], hasMore: false, nextCursor: null });
      await flush();
      await flush();
    });
    expect(screen.getByText("Пришла позже")).toBeTruthy();
    expect(screen.queryByLabelText("Загружаем задачи проекта…")).toBeNull();
    h.ui.unmount();
  });
});

describe("Спринты: перенос в завершённый спринт", () => {
  test("зона завершённого спринта не принимает задачу и объясняет почему, а не молчит", async () => {
    const done = { id: "sp0", name: "Спринт 6", goal: "", status: "completed" as const, startDate: null, endDate: null };
    const h = await setup([dto("i1")], true, undefined, [done]);
    const setSprint = vi.spyOn(issuesApi, "setSprint");
    expect(screen.getByText("В этом спринте не осталось задач")).toBeTruthy();
    const zone = document.querySelector('[data-blocked="true"]') as HTMLElement;
    expect(zone).toBeTruthy();
    const dataTransfer = { getData: () => "i1" };
    fireEvent.dragOver(zone, { dataTransfer });
    expect(screen.getByText(/Спринт завершён — задачи в него не переносятся/)).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer });
    await settle();
    expect(setSprint).not.toHaveBeenCalled();
    expect(h.toasts().some((x) => x.text.startsWith("Спринт завершён"))).toBe(true);
    h.ui.unmount();
  });
});

describe("Создание спринта через ds", () => {
  test("пустое название не отправляется; выбранные даты и обрезанные поля приходят в прежний API", async () => {
    const create = vi.spyOn(sprintsApi, "create").mockResolvedValue({ id: "sp-new", name: "Спринт 12", goal: "Релиз", status: "future", startDate: "2026-10-01", endDate: "2026-10-15" });
    const h = await setup([], true);
    fireEvent.click(screen.getByRole("button", { name: "Новый спринт" }));
    const dialog = within(screen.getByRole("dialog", { name: "Новый спринт" }));
    const submit = dialog.getByRole("button", { name: "Создать" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(submit);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText("Название"), { target: { value: "  Спринт 12  " } });
    fireEvent.change(dialog.getByLabelText("Цель (необязательно)"), { target: { value: "  Релиз  " } });
    for (const [label, value] of [["Начало", "2026-10-01"], ["Конец", "2026-10-15"]]) {
      fireEvent.click(dialog.getByRole("button", { name: new RegExp(`^${label}:`) }));
      const input = screen.getByRole("textbox", { name: label, hidden: true });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    fireEvent.click(submit);
    await settle();
    expect(create).toHaveBeenCalledExactlyOnceWith("p1", { name: "Спринт 12", goal: "Релиз", startDate: "2026-10-01", endDate: "2026-10-15" });
    expect(screen.queryByRole("dialog", { name: "Новый спринт" })).toBeNull();
    h.ui.unmount();
  });

  test("cancel возвращает фокус и следующая форма забывает предыдущий черновик", async () => {
    const h = await setup([], true);
    const trigger = screen.getByRole("button", { name: "Новый спринт" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Новый спринт" });
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Черновик" } });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await settle();
    expect(screen.queryByRole("dialog", { name: "Новый спринт" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("");
    h.ui.unmount();
  });
});


test("confirmed sprint removals retain the old row until API response and focus the live neighbor or list", async () => {
  const sprint = { id: "sp1", name: "Sprint 1", goal: "", status: "future" as const, startDate: null, endDate: null };
  const h = await setup([dto("i1", { sprintId: "sp1" }), dto("i2", { sprintId: "sp1" }), dto("i3")], true, undefined, [sprint]);
  let release!: (issue: ServerIssue) => void;
  const patch = vi.spyOn(issuesApi, "setSprint").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const list = screen.getByRole("group", { name: "Sprint 1" });
  const remove = within(list).getAllByRole("button", { name: "Убрать из спринта" })[0];
  remove.focus(); fireEvent.click(remove);
  expect(patch).toHaveBeenCalledWith("p1", "i1", null);
  expect(list.querySelectorAll('[data-issue-id]')).toHaveLength(2);
  expect(document.activeElement).toBe(remove);
  await act(async () => { release(dto("i1", { sprintId: null })); await flush(); await flush(); });
  expect(list.querySelectorAll('[data-issue-id]')).toHaveLength(1);
  expect(document.activeElement?.closest('[data-issue-id]')?.getAttribute('data-issue-id')).toBe('i2');
  expect(screen.getByRole('group', { name: 'Список задач' }).querySelectorAll('[data-issue-id]')).toHaveLength(2);
  const last = within(list).getByRole("button", { name: "Убрать из спринта" });
  last.focus(); fireEvent.click(last);
  await act(async () => { release(dto("i2", { sprintId: null })); await flush(); await flush(); });
  expect(list.querySelectorAll('[data-issue-id]')).toHaveLength(0);
  expect(document.activeElement).toBe(list);
  h.ui.unmount();
});

test("failed sprint move retains its focused row and leaves destination unchanged", async () => {
  const sprint = { id: "sp1", name: "Sprint 1", goal: "", status: "future" as const, startDate: null, endDate: null };
  const h = await setup([dto("i1", { sprintId: "sp1" }), dto("i2")], true, undefined, [sprint]);
  vi.spyOn(issuesApi, "setSprint").mockRejectedValue(new Error('offline'));
  const list = screen.getByRole('group', { name: 'Sprint 1' });
  const remove = within(list).getByRole('button', { name: 'Убрать из спринта' }); remove.focus(); fireEvent.click(remove);
  await settle();
  expect(list.querySelectorAll('[data-issue-id]')).toHaveLength(1);
  expect(screen.getByRole('group', { name: 'Список задач' }).querySelectorAll('[data-issue-id]')).toHaveLength(1);
  expect(document.activeElement).toBe(remove);
  h.ui.unmount();
});


test("confirmed round-trip animates each local arrival and never flies a task between list viewports", async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const list = this.closest('.sprint-issue-list');
    const left = list?.getAttribute('aria-label') === 'Sprint 1' ? 500 : 0;
    const top = this.dataset.issueId ? Math.max(0, [...(list?.querySelectorAll('[data-issue-id]') ?? [])].indexOf(this)) * 40 : 0;
    return { left, top, x: left, y: top, width: 300, height: 40, right: left + 300, bottom: top + 40, toJSON: () => ({}) } as DOMRect;
  });
  const sprint = { id: 'sp1', name: 'Sprint 1', goal: '', status: 'future' as const, startDate: null, endDate: null };
  const h = await setup([dto('i1', { sprintId: 'sp1' }), dto('i2', { sprintId: 'sp1' }), dto('i3')], true, undefined, [sprint]);
  expect(enter).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled();
  let release!: (issue: ServerIssue) => void;
  vi.spyOn(issuesApi, 'setSprint').mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const sprintList = screen.getByRole('group', { name: 'Sprint 1' });
  fireEvent.click(within(sprintList).getAllByRole('button', { name: 'Убрать из спринта' })[0]);
  expect(exit).not.toHaveBeenCalled();
  await act(async () => { release(dto('i1')); await flush(); await flush(); });
  expect(exit).toHaveBeenCalledTimes(1);
  expect(vi.mocked(enter).mock.calls.map(call => call[0].closest('[role="group"]')?.getAttribute('aria-label'))).toEqual(['Список задач']);
  expect(vi.mocked(flipFrom).mock.calls.every(call => call[0].dataset.issueId !== 'i1')).toBe(true);
  vi.mocked(enter).mockClear(); vi.mocked(exit).mockClear(); vi.mocked(flipFrom).mockClear();
  fireEvent.drop(sprintList.parentElement!, { dataTransfer: { getData: () => 'i1' } });
  await act(async () => { release(dto('i1', { sprintId: 'sp1' })); await flush(); await flush(); });
  expect(exit).toHaveBeenCalledTimes(1);
  expect(vi.mocked(enter).mock.calls.map(call => call[0].closest('[role="group"]')?.getAttribute('aria-label'))).toEqual(['Sprint 1']);
  expect(vi.mocked(flipFrom).mock.calls.every(call => call[0].dataset.issueId !== 'i1')).toBe(true);
  h.ui.unmount();
});

test("same-size deferred batch departures become fresh arrivals on the next confirmed round-trip", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest(".sprint-issue-list");
    const left = list?.getAttribute("aria-label") === "Sprint 1" ? 500 : 0;
    return { left, top: 0, x: left, y: 0, width: 300, height: 40, right: left + 300, bottom: 40, toJSON: () => ({}) } as DOMRect;
  });
  const sprint = { id: "sp1", name: "Sprint 1", goal: "", status: "future" as const, startDate: null, endDate: null };
  const h = await setup([dto("i1", { sprintId: "sp1" }), dto("i2")], true, undefined, [sprint]);
  const pending = new Map<string, (issue: ServerIssue) => void>();
  const patch = vi.spyOn(issuesApi, "setSprint").mockImplementation((_projectId, id) => new Promise(resolve => pending.set(id, resolve)));
  const sprintList = screen.getByRole("group", { name: "Sprint 1" });
  const backlog = screen.getByRole("group", { name: "Список задач" });
  const ids = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("[data-issue-id]")].map(row => row.dataset.issueId);
  const arrivals = () => vi.mocked(enter).mock.calls.map(([row]) => [row.dataset.issueId, row.closest('[role="group"]')?.getAttribute("aria-label")]);
  expect(enter).not.toHaveBeenCalled();

  fireEvent.click(within(sprintList).getByRole("button", { name: "Убрать из спринта" }));
  fireEvent.drop(sprintList.parentElement!, { dataTransfer: { getData: () => "i2" } });
  expect(patch.mock.calls).toEqual([["p1", "i1", null], ["p1", "i2", "sp1"]]);
  expect(ids(sprintList)).toEqual(["i1"]); expect(ids(backlog)).toEqual(["i2"]);
  expect(enter).not.toHaveBeenCalled();
  await act(async () => {
    pending.get("i1")!(dto("i1")); pending.get("i2")!(dto("i2", { sprintId: "sp1" }));
    await flush(); await flush();
  });
  expect(ids(sprintList)).toEqual(["i2"]); expect(ids(backlog)).toEqual(["i1"]);
  expect(arrivals()).toEqual(expect.arrayContaining([["i2", "Sprint 1"], ["i1", "Список задач"]]));
  expect(enter).toHaveBeenCalledTimes(2);
  vi.mocked(enter).mockClear();

  fireEvent.click(within(sprintList).getByRole("button", { name: "Убрать из спринта" }));
  fireEvent.drop(sprintList.parentElement!, { dataTransfer: { getData: () => "i1" } });
  expect(ids(sprintList)).toEqual(["i2"]); expect(ids(backlog)).toEqual(["i1"]);
  await act(async () => {
    pending.get("i2")!(dto("i2")); pending.get("i1")!(dto("i1", { sprintId: "sp1" }));
    await flush(); await flush();
  });
  expect(patch.mock.calls.slice(2)).toEqual([["p1", "i2", null], ["p1", "i1", "sp1"]]);
  expect(ids(sprintList)).toEqual(["i1"]); expect(ids(backlog)).toEqual(["i2"]);
  expect(arrivals()).toEqual(expect.arrayContaining([["i1", "Sprint 1"], ["i2", "Список задач"]]));
  expect(enter).toHaveBeenCalledTimes(2);
  h.ui.unmount();
});