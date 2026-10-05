import type { Page } from "@playwright/test";
import { mockApi } from "./fixtures";

export async function shellFixture(page: Page, theme = "light", lang = "ru") {
  await page.addInitScript(({ theme, lang }) => {
    localStorage.setItem("taskira.theme", theme);
    localStorage.setItem("taskira.lang", lang);
  }, { theme, lang });
  await page.routeWebSocket("**/api/ws", socket => socket.close());
  const users = [
    { id: "u1", username: "admin", name: "Анна Смирнова", initials: "АС", color: "", jobRole: "Руководитель", globalRole: "admin", isActive: true, authSource: "local" },
    { id: "u2", username: "igor", name: "Игорь Петров", initials: "ИП", color: "", jobRole: "Разработчик", globalRole: "member", isActive: true, authSource: "local" },
  ];
  const project = { id: "p1", key: "CORP", name: "Корпоративные задачи", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
  const projects = [project, { ...project, id: "p2", key: "LEGAL", name: "Юридические вопросы и согласование договоров", departmentId: "d2" }];
  await mockApi(page, { ...users[0], favoriteProjectIds: ["p1"] });
  const writes: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/favorite")) { writes.push(route.request().method()); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/projects") return route.fulfill({ json: projects });
    if (path === "/api/departments") return route.fulfill({ json: [{ id: "d1", name: "Общий отдел" }, { id: "d2", name: "Юридический отдел с длинным названием" }] });
    if (path === "/api/projects/p1") return route.fulfill({ json: { project, users, members: users.map(u => ({ userId: u.id, role: "admin" })), workflow: { statuses: [{ id: "s1", sid: "todo", name: "К выполнению", category: "todo", position: 0 }], transitions: [] }, issueTemplates: [], customFields: [], sprints: [] } });
    if (path === "/api/notifications/unread-count") return route.fulfill({ json: { count: 3 } });
    return route.fallback();
  });
  return writes;
}
