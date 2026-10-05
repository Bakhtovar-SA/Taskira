import type { Page } from "@playwright/test";
import { shellFixture } from "./shell-fixture";

export async function boardFixture(page: Page, theme = "light", columns = 4, lang = "ru") {
  await shellFixture(page, theme, lang);
  await page.clock.setFixedTime(new Date("2026-10-04T07:00:00Z"));
  const users = [
    { id: "u1", username: "admin", name: "Анна Смирнова", initials: "АС", color: "", jobRole: "Руководитель", globalRole: "admin", isActive: true, authSource: "local" },
    { id: "u2", username: "igor", name: "Игорь Петров", initials: "ИП", color: "", jobRole: "Разработчик", globalRole: "member", isActive: true, authSource: "local" },
  ];
  const statuses = Array.from({ length: columns }, (_, i) => ({
    id: `s${i + 1}`, sid: ["todo", "inprogress", "review"][i] ?? (i === columns - 1 ? "done" : `custom${i}`),
    name: i === 0 ? "К выполнению" : i === columns - 1 ? "Готово" : i === 1 ? "В работе" : i === 2 ? "На ревью" : `Этап ${i + 1}`,
    category: i === 0 ? "todo" : i === columns - 1 ? "done" : "inprogress", position: i,
  }));
  const issues = [
    ["Единая авторизация для корпоративных сервисов", "s1", "2026-10-02", "critical", ["u1", "u2"], "epic1"],
    ["Подготовить план запуска", "s1", "2026-10-07", "high", ["u1"], null],
    ["Согласовать правила доступа", "s1", "2026-10-08", "medium", [], "epic2"],
    ["Настроить уведомления о новых задачах", "s2", "2026-10-04", "medium", ["u2"], "epic1"],
    ["Уточнить роли и права участников", "s2", "2026-10-01", "high", ["u1"], null],
    ["Проверить документы перед запуском", "s3", null, "low", ["u2"], "epic2"],
    ["Добавить журнал изменений", "s3", "2026-10-03", "medium", [], null],
    ["Обновить страницу проекта", `s${columns}`, "2026-10-01", "critical", ["u1"], "epic1"],
    ["Согласовать прошлый релиз", `s${columns}`, null, "low", [], null],
  ].map(([title, statusId, dueDate, priorityId, assigneeIds, epicId], i) => ({
    id: `i${i + 1}`, key: `CORP-${i + 1}`, title, statusId, dueDate, priorityId, assigneeIds, epicId,
    description: "", typeId: "task", reporterId: "u1", parentId: null, labels: ["internal-label"], complexity: null, sprintId: null, rank: i,
    createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z", archivedAt: null,
    doneAt: i === 7 ? "2026-10-03T12:00:00Z" : i === 8 ? "2026-09-01T12:00:00Z" : null,
  }));
  const doneId = `s${columns}`;
  const project = { id: "p1", key: "CORP", name: "Корпоративные задачи", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, p = url.searchParams;
    if (path === "/api/projects/p1") return route.fulfill({ json: {
      project,
      users, members: users.map(u => ({ userId: u.id, role: "admin" })), workflow: { statuses, transitions: statuses.flatMap(from => statuses.filter(to => to.id !== from.id).map(to => ({ id: from.id + to.id, from: from.id, to: to.id }))) }, issueTemplates: [], customFields: [], sprints: [],
    } });
    if (path.endsWith("/issues/epics")) return route.fulfill({ json: { items: [{ id: "epic1", key: "CORP-E1", tStart: null, tSpan: null, childTotal: 4, childDone: 1, title: "Корпоративная платформа", color: null }, { id: "epic2", key: "CORP-E2", tStart: null, tSpan: null, childTotal: 2, childDone: 0, title: "Юридические вопросы и согласование договоров", color: null }], truncated: false, limit: 200 } });
    if (path.endsWith("/issues/assignees")) return route.fulfill({ json: { items: users.map(u => ({ userId: u.id, count: 4 })), truncated: false, limit: 24 } });
    if (path === "/api/projects/p1/issues" && route.request().method() === "POST") {
      const created = { ...issues[0], ...route.request().postDataJSON(), id: "created", key: "CORP-10", doneAt: null };
      issues.push(created);
      return route.fulfill({ json: created });
    }
    if (path.endsWith("/issues/counts") || path === "/api/projects/p1/issues" && route.request().method() === "GET") {
      const items = issues.filter(i => (!p.get("status") || i.statusId === p.get("status")) &&
        (!p.get("assignee") || (p.get("assignee") === "none" ? (i.assigneeIds as string[]).length === 0 : (i.assigneeIds as string[]).includes(p.get("assignee")!))) &&
        (!p.get("overdue") || i.statusId !== doneId && !!i.dueDate && i.dueDate < "2026-10-04") &&
        (!p.get("q") || (i.title as string).toLowerCase().includes(p.get("q")!.toLowerCase())) &&
        (p.get("closed") !== "hide" || i.statusId !== doneId) && (p.get("closed") !== "older" || i.id === "i9") && (p.get("closed") !== "recent" || i.id !== "i9"));
      if (path.endsWith("/counts")) return route.fulfill({ json: { total: items.length, byStatus: Object.fromEntries(statuses.map(st => [st.id, items.filter(i => i.statusId === st.id).length])) } });
      return route.fulfill({ json: { items, hasMore: false, nextCursor: null } });
    }
    return route.fallback();
  });
  return { issues, users, statuses, project };
}
