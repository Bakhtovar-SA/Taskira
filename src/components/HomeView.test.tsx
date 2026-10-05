import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { AssignedIssue } from "../types";
const issue = (over: Partial<AssignedIssue>): AssignedIssue => ({
  issueId: "i1", projectId: "p1", key: "A-1", title: "Задача", typeId: "task", priorityId: "medium",
  statusId: "s1", statusName: "К работе", statusCategory: "todo", dueDate: null, projectKey: "A", projectName: "Альфа", ...over,
});
const ASSIGNED = [
  issue({ title: "Просроченный отчёт", dueDate: "2026-10-02" }),
  issue({ issueId: "i2", key: "A-2", title: "Сдать макет", dueDate: "2026-10-04" }),
  issue({ issueId: "i3", key: "B-7", title: "Созвон с клиентом", projectId: "p2", projectKey: "B", projectName: "Бета" }),
];
const store = {
  me: { id: "u1", name: "Анна Соколова", globalRole: "admin", avatarUpdatedAt: null },
  data: { currentUserId: "u1", currentProjectId: "", users: [{ id: "u1", name: "Анна Соколова" }],
    projects: [
      { id: "p1", key: "A", name: "Альфа", departmentId: "d1", isShared: false, icon: null, color: null },
      { id: "p2", key: "B", name: "Бета", departmentId: "d1", isShared: true, icon: null, color: null },
    ],
    departments: [{ id: "d1", name: "Общий отдел" }], assignedToMe: ASSIGNED, assignedTruncated: false,
  },
  enterProject: vi.fn(), switchProject: vi.fn(), openIssue: vi.fn(), setCreateOpen: vi.fn(), setView: vi.fn(),
};
vi.mock("../store", () => ({
  useStore: () => store, useNotifications: () => ({ notifications: [] }),
  useUnreadCount: () => 0, useToasts: () => [],
}));
vi.mock("../api", async importOriginal => ({
  ...await importOriginal<object>(),
  roadmapApi: { get: vi.fn(async () => ({ projects: [{ id: "p1", total: 10, done: 5 }, { id: "p2", total: 8, done: 3 }], dependencies: [] })) },
}));
import HomeView from "./HomeView";
import { markHomeStep } from "../homeSteps";
import { homeGroup } from "../homeGroups";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); localStorage.clear(); store.data.assignedToMe = ASSIGNED; });
const renderHome = async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-04T12:00:00"));
  const result = render(<I18nProvider><HomeView /></I18nProvider>);
  await screen.findAllByText("открыто 5"); return result;
};
describe("Главная", () => {
  test("summary replaces filters and keeps later tasks visible", async () => {
    const { container } = await renderHome();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(container.querySelector(".home-summary")!.textContent).toContain("1 задача просрочена, 1 со сроком на этой неделе, 0 ждут вашего ревью.");
    expect([...container.querySelectorAll("[data-urgency]")].map(e => e.getAttribute("data-urgency"))).toEqual(["overdue", "week", "other"]);
    expect(screen.getByText("Созвон с клиентом")).toBeTruthy();
    expect(screen.queryByText("Недавняя активность")).toBeNull();
  });
  test("open issue page across projects; modified clicks retain a real link", async () => {
    await renderHome();
    const link = screen.getByRole("link", { name: /Созвон с клиентом/ });
    expect(link.getAttribute("href")).toBe("/p/B/issue/B-7");
    fireEvent.click(link, { ctrlKey: true }); expect(store.switchProject).not.toHaveBeenCalled();
    fireEvent.click(link); expect(store.switchProject).toHaveBeenCalledWith("p2", "i3", "page");
  });
  test("all my issues leaves home; project enters its board", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Все мои задачи" }));
    expect(store.setView).toHaveBeenCalledWith("my", undefined);
    expect(store.enterProject).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /Бета/ }));
    expect(store.enterProject).toHaveBeenCalledWith("p2");
    expect(store.setView).toHaveBeenLastCalledWith("board", undefined);
  });
  test("empty assigned list still requires a project choice for creation", async () => {
    store.data.assignedToMe = []; await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));
    expect(store.enterProject).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Бета" }));
    expect(store.setCreateOpen).toHaveBeenCalledWith(true);
    expect(store.enterProject).toHaveBeenCalledWith("p2");
  });
  test("counts use project totals, not assigned issues", async () => {
    await renderHome();
    expect(screen.getAllByText("открыто 5")).toHaveLength(2);
    const progress = screen.getByRole("progressbar", { name: "Готовность проекта «Альфа»" });
    expect(progress.getAttribute("aria-valuenow")).toBe("50");
  });
  test("hide and complete first steps persist separately for each account", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть первые шаги" }));
    expect(screen.queryByRole("region", { name: "Первые шаги" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("taskira.home.steps.u1")!).hidden).toBe(true);
    expect(localStorage.getItem("taskira.home.steps.u2")).toBeNull();
    cleanup(); localStorage.clear();
    for (const step of ["profile", "create", "invite", "shortcuts"] as const) markHomeStep("u1", step);
    await renderHome(); expect(screen.queryByRole("region", { name: "Первые шаги" })).toBeNull();
  });
  test("review uses stable status metadata and the role in that project", async () => {
    store.data.assignedToMe = [issue({ statusSid: "review", statusName: "Проверить документы", projectRole: "manager" })];
    const { container } = await renderHome();
    expect(container.querySelector('[data-urgency="review"]')).toBeTruthy();
  });
});
describe("homeGroup", () => {
  test("calendar week ends Sunday and old servers preserve uncategorized tasks", () => {
    expect(homeGroup(issue({ dueDate: "2026-10-05" }), false, "2026-10-04")).toBe("other");
    expect(homeGroup(issue({ dueDate: "2026-10-04" }), false, "2026-10-04")).toBe("week");
    expect(homeGroup(issue({ statusName: "На ревью", statusCategory: "inprogress" }), false, "2026-10-04")).toBe("other");
  });
  test.each(["manager", "employee", "viewer", null] as const)("review is role-specific: %s", role => {
    expect(homeGroup(issue({ statusSid: "review", projectRole: role }), false)).toBe(role === "manager" ? "review" : "other");
  });
  test("rework belongs to an employee; urgent tasks appear once", () => {
    expect(homeGroup(issue({ statusSid: "rework", projectRole: "employee" }), false)).toBe("rework");
    expect(homeGroup(issue({ statusSid: "rework", projectRole: "manager" }), false)).toBe("other");
    expect(homeGroup(issue({ statusSid: "review", projectRole: "manager", dueDate: "2026-10-01" }), false, "2026-10-04")).toBe("overdue");
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
