/** Характеризация Главной (ТЗ 5.12 b, шаг 1 — снята ДО переписывания): что должно пережить новый вид.
 *  Цифры полосы фокуса фильтруют список; поиск в шапке — по ключу, названию и проекту; открытие задачи —
 *  switchProject(projectId, issueId, "page"); проект — enterProject; «Создать задачу» — в проект с открытой формой. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { AssignedIssue } from "../types";

const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const issue = (over: Partial<AssignedIssue>): AssignedIssue => ({
  issueId: "i1", projectId: "p1", key: "A-1", title: "Задача", typeId: "task", priorityId: "medium",
  statusId: "s1", statusName: "К работе", statusCategory: "todo", dueDate: null, projectKey: "A", projectName: "Альфа", ...over,
});
const ASSIGNED: AssignedIssue[] = [
  issue({ issueId: "i1", key: "A-1", title: "Просроченный отчёт", dueDate: iso(-2) }),
  issue({ issueId: "i2", key: "A-2", title: "Сдать макет", dueDate: iso(3), statusCategory: "inprogress", statusName: "В работе" }),
  issue({ issueId: "i3", key: "B-7", title: "Созвон с клиентом", projectId: "p2", projectKey: "B", projectName: "Бета" }),
];

const store = {
  data: {
    currentUserId: "u1",
    users: [{ id: "u1", name: "Анна Соколова" }],
    projects: [
      { id: "p1", key: "A", name: "Альфа", departmentId: "d1", isShared: false, icon: null, color: null },
      { id: "p2", key: "B", name: "Бета", departmentId: "d1", isShared: true, icon: null, color: null },
    ],
    departments: [{ id: "d1", name: "Общий отдел" }],
    assignedToMe: ASSIGNED,
    assignedTruncated: false,
  },
  enterProject: vi.fn(),
  switchProject: vi.fn(),
  setCreateOpen: vi.fn(),
  setView: vi.fn(),
};
vi.mock("../store", () => ({
  useStore: () => store,
  useNotifications: () => ({ notifications: [] }),
  useUnreadCount: () => 0,
  useToasts: () => [],
}));
vi.mock("../onboarding", () => ({ useOnboarding: () => null, STEPS: [], hideOnboarding: vi.fn() }));

import HomeView from "./HomeView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const renderHome = () =>
  render(
    <I18nProvider>
      <HomeView onLogout={vi.fn()} />
    </I18nProvider>,
  );
const titles = () => ASSIGNED.map((i) => i.title).filter((tt) => screen.queryByText(tt));

describe("Главная", () => {
  test("полоса фокуса: цифры и фильтр списка", () => {
    renderHome();
    const tabs = screen.getByRole("tablist");
    const tab = (re: RegExp) => within(tabs).getByRole("tab", { name: re });
    expect(tab(/Все мои/).textContent).toContain("3");
    expect(tab(/Просрочено/).textContent).toContain("1");
    expect(titles()).toHaveLength(3);
    fireEvent.click(tab(/Просрочено/));
    expect(titles()).toEqual(["Просроченный отчёт"]);
    fireEvent.click(tab(/В работе/));
    expect(titles()).toEqual(["Сдать макет"]);
  });

  test("поиск — по ключу, названию и проекту", () => {
    renderHome();
    const box = screen.getByPlaceholderText(/Поиск/);
    fireEvent.change(box, { target: { value: "b-7" } });
    expect(titles()).toEqual(["Созвон с клиентом"]);
    fireEvent.change(box, { target: { value: "альфа" } });
    expect(titles().sort()).toEqual(["Просроченный отчёт", "Сдать макет"].sort());
  });

  test("задача открывается полной страницей в своём проекте; проект — enterProject", () => {
    renderHome();
    fireEvent.click(screen.getByText("Созвон с клиентом"));
    expect(store.switchProject).toHaveBeenCalledWith("p2", "i3", "page");
    fireEvent.click(screen.getByRole("button", { name: /Бета/ }));
    expect(store.enterProject).toHaveBeenCalledWith("p2");
  });

  test("«Все мои» — группы по срочности: просрочено → неделя → без срока", () => {
    const { container } = renderHome();
    expect([...container.querySelectorAll("[data-urgency]")].map((e) => e.getAttribute("data-urgency"))).toEqual(["overdue", "week", "nodate"]);
    // Фильтр или поиск — плоский список без групп.
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: /В работе/ }));
    expect(container.querySelectorAll("[data-urgency]")).toHaveLength(0);
  });
});

describe("groupByUrgency", () => {
  test("сегодня отдельно, внутри группы — по сроку, затем по приоритету", async () => {
    const { groupByUrgency } = await import("./MyIssues");
    const now = "2026-09-27";
    const g = groupByUrgency(
      [
        issue({ issueId: "a", dueDate: "2026-09-30", priorityId: "low" }),
        issue({ issueId: "b", dueDate: "2026-09-27" }),
        issue({ issueId: "c", dueDate: "2026-09-30", priorityId: "critical" }),
        issue({ issueId: "d", dueDate: "2026-12-01" }),
        issue({ issueId: "e", dueDate: "2026-09-01", statusCategory: "done" }),
      ],
      now,
    );
    expect(g.map((x) => [x.id, x.items.map((i) => i.issueId)])).toEqual([
      ["today", ["b"]],
      ["week", ["c", "a"]],
      ["later", ["d"]],
      ["nodate", ["e"]],
    ]);
  });
});
