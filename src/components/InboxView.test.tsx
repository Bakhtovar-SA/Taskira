/** Характеризация Входящих (ТЗ 5.12 g, шаг 1 — снята ДО правки): фильтр «Непрочитанные», группы по дням, переход к
 *  задаче полной страницей с отметкой «прочитано», «Прочитать все», убрать одно, клавиши J/K/E/Enter. */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { NotificationT } from "../types";
import { countTo, enter, exit, flipFrom } from "../motion";
vi.mock("../motion", async importOriginal => ({ ...(await importOriginal<typeof import("../motion")>()),
  motionReduced: () => false, cssZoom: () => 1, enter: vi.fn(), exit: vi.fn(() => Promise.resolve()),
  flipFrom: vi.fn(() => Promise.resolve()), countTo: vi.fn(() => () => undefined) }));

const now = new Date("2026-10-03T12:00:00Z").getTime();
const n = (over: Partial<NotificationT>): NotificationT => ({
  id: "n1",
  type: "issue.comment",
  actor: { id: "u2", name: "Борис Петров", initials: "БП", color: "#5283e0" },
  projectId: "p1",
  issueId: "i1",
  payload: { key: "A-1", title: "Починить биллинг" },
  createdAt: now - 60_000,
  read: false,
  ...over,
});
const LIST: NotificationT[] = [
  n({ id: "n1" }),
  n({ id: "n2", type: "issue.status", payload: { key: "A-1", title: "Починить биллинг", from: "В работе", to: "На ревью" }, createdAt: now - 120_000, read: true }),
  n({ id: "n3", issueId: "i2", projectId: "p2", payload: { key: "B-7", title: "Созвон с клиентом" }, createdAt: now - 3 * 864e5 }),
];

const store = {
  data: {
    currentProjectId: "p1",
    projects: [
      { id: "p1", key: "A", name: "Альфа", icon: null, color: null },
      { id: "p2", key: "B", name: "Бета", icon: null, color: null },
    ],
  },
  openIssue: vi.fn(),
  switchProject: vi.fn(),
  refreshNotifications: vi.fn(async () => undefined),
  markNotificationsRead: vi.fn(),
  dismissNotifications: vi.fn(),
};
let notifications = LIST;
vi.mock("../store", () => ({
  useStore: () => store,
  useNotifications: () => ({ notifications, unreadCount: notifications.filter((x) => !x.read).length }),
}));

import InboxView from "./InboxView";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  notifications = LIST;
});
const renderInbox = () =>
  render(
    <I18nProvider>
      <InboxView />
    </I18nProvider>,
  );

describe("Входящие", () => {
  test("группы по дням; «Непрочитанные» сужает ленту", () => {
    renderInbox();
    expect(screen.getByRole("heading", { name: "Сегодня" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Раньше" })).toBeTruthy();
    expect(screen.getAllByText(/Починить биллинг/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: /Непрочитанные/ }));
    expect(screen.getByText(/Созвон с клиентом/)).toBeTruthy();
  });

  test("переход к задаче: тот же проект — openIssue(page), другой — switchProject(page); непрочитанное отмечается", () => {
    renderInbox();
    fireEvent.click(screen.getByText(/Созвон с клиентом/));
    expect(store.markNotificationsRead).toHaveBeenCalledWith(["n3"]);
    expect(store.switchProject).toHaveBeenCalledWith("p2", "i2", "page");
    fireEvent.click(screen.getAllByText(/Починить биллинг/)[0]);
    expect(store.openIssue).toHaveBeenCalledWith("i1", "page");
  });

  test("«Прочитать все» и «Очистить» — без аргументов; крестик строки — только её", () => {
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: /Прочитать всё/ }));
    expect(store.markNotificationsRead).toHaveBeenCalledWith();
    const dismiss = screen.getAllByRole("button", { name: /Скрыть это уведомление/ });
    fireEvent.click(dismiss[dismiss.length - 1]);
    expect(store.dismissNotifications).toHaveBeenCalledWith(["n3"]);
  });

  test("клавиши: J — вниз, E — прочитано, Enter — открыть", () => {
    renderInbox();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "e" });
    expect(store.markNotificationsRead).toHaveBeenLastCalledWith(["n3"]);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(store.switchProject).toHaveBeenCalledWith("p2", "i2", "page");
  });

  test("пусто — EmptyState", () => {
    notifications = [];
    renderInbox();
    expect(screen.getByText("Всё прочитано")).toBeTruthy();
  });

  test("ТЗ 5.12 g: события одной задачи за день — одна строка «ещё N»; крестик убирает все её события", () => {
    renderInbox();
    expect(screen.getAllByText(/Починить биллинг/)).toHaveLength(1);
    expect(screen.getByText("ещё 1")).toBeTruthy();
    const dismiss = screen.getAllByRole("button", { name: /Скрыть это уведомление/ });
    fireEvent.click(dismiss[0]);
    expect(store.dismissNotifications).toHaveBeenCalledWith(["n1", "n2"]);
  });
});


test("automatic reminder shows its deadline without inventing an actor", () => {
  notifications = [n({ type: "issue.dueSoon", payload: { key: "A-1", dueDate: "2026-10-04", leadDays: "1" } })];
  renderInbox();
  expect(screen.getByText(/Напоминание о сроке задачи/)).toBeTruthy();
  expect(screen.getByText(/2026-10-04/)).toBeTruthy();
  expect(screen.queryByText("Борис Петров")).toBeNull();
});

function inboxRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.dataset.enterId ? [...document.querySelectorAll('[data-enter-id]')].indexOf(this) : 0;
    const top = this.dataset.enterId ? 40 + Math.max(0, index) * 50 : 0;
    return { x: 0, y: top, left: 0, top, width: 600, height: 40, right: 600, bottom: top + 40, toJSON: () => ({}) } as DOMRect;
  });
}
const redrawInbox = (view: ReturnType<typeof renderInbox>) => view.rerender(<I18nProvider><InboxView /></I18nProvider>);

test("unread row leaves only after read confirmation, calls exit once and focuses the next live row", () => {
  inboxRects();
  const view = renderInbox();
  fireEvent.click(screen.getByRole('tab', { name: /Непрочитанные/ }));
  const first = document.querySelector<HTMLElement>('[data-enter-id="n1"] button')!;
  first.focus(); fireEvent.keyDown(first, { key: 'e' });
  expect(store.markNotificationsRead).toHaveBeenCalledWith(['n1']);
  expect(document.querySelectorAll('.inbox-row')).toHaveLength(2);
  expect(document.activeElement).toBe(first);
  notifications = LIST.map(item => item.id === 'n1' ? { ...item, read: true } : item);
  redrawInbox(view);
  expect(exit).toHaveBeenCalledTimes(1);
  expect(flipFrom).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('.inbox-row')).toHaveLength(1);
  expect(document.activeElement?.closest('[data-enter-id]')?.getAttribute('data-enter-id')).toBe('n3');
});

test("the final unread row and disappearing read-all button return focus to the active filter", () => {
  inboxRects();
  const view = renderInbox();
  const tab = screen.getByRole('tab', { name: /Непрочитанные/ }); fireEvent.click(tab);
  const readAll = screen.getByRole('button', { name: /Прочитать всё/ });
  readAll.focus(); fireEvent.click(readAll);
  notifications = LIST.map(item => ({ ...item, read: true })); redrawInbox(view);
  expect(document.querySelectorAll('.inbox-row')).toHaveLength(0);
  expect(document.activeElement).toBe(tab);
});

test("only one unread CountUp grows on an update; first show, filter change and decrease stay immediate", () => {
  const view = renderInbox();
  expect(document.querySelectorAll('.count-up')).toHaveLength(1);
  expect(countTo).not.toHaveBeenCalled();
  notifications = [...LIST, n({ id: 'n4', issueId: 'i4' })]; redrawInbox(view);
  expect(countTo).toHaveBeenCalledTimes(1);
  expect(vi.mocked(countTo).mock.calls[0].slice(1, 3)).toEqual([2, 3]);
  vi.mocked(countTo).mockClear(); vi.mocked(enter).mockClear();
  notifications = [...notifications, n({ id: 'n5', issueId: 'i5' })];
  fireEvent.click(screen.getByRole('tab', { name: /Непрочитанные/ }));
  expect(countTo).not.toHaveBeenCalled(); expect(enter).not.toHaveBeenCalled();
  notifications = notifications.map(item => item.id === 'n5' ? { ...item, read: true } : item); redrawInbox(view);
  expect(countTo).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.count-up')).toHaveLength(1);
});

test("E acts on the keyboard-focused row rather than a stale mouse cursor", () => {
  renderInbox();
  const button = document.querySelector<HTMLElement>('[data-enter-id="n3"] button')!;
  fireEvent.focus(button);
  // A pointer can remain over the other row while keyboard focus is on this one.
  fireEvent.mouseEnter(document.querySelector('[data-enter-id="n1"]')!);
  fireEvent.keyDown(button, { key: 'e' });
  expect(store.markNotificationsRead).toHaveBeenLastCalledWith(['n3']);
  expect(document.activeElement).toBe(button);
});
