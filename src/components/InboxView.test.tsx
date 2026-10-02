/** Характеризация Входящих (ТЗ 5.12 g, шаг 1 — снята ДО правки): фильтр «Непрочитанные», группы по дням, переход к
 *  задаче полной страницей с отметкой «прочитано», «Прочитать все», убрать одно, клавиши J/K/E/Enter. */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { NotificationT } from "../types";

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
