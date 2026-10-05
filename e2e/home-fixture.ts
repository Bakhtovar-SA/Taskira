import type { Page } from "@playwright/test";
import { boardFixture } from "./board-fixture";
export async function homeFixture(page: Page, theme = "light", lang = "ru", employee = false) {
  const base = await boardFixture(page, theme, 4, lang);
  await page.addInitScript(() => {
    if (!localStorage.getItem("taskira.home.steps.u1")) localStorage.setItem("taskira.home.steps.u1", JSON.stringify({ profile: true, create: true }));
  });
  const items = [base.issues[0], base.issues[3], base.issues[5], base.issues[6], base.issues[1]].map((i, index) => ({
    issueId: i.id, projectId: "p1", key: i.key, title: i.title, typeId: i.typeId, priorityId: i.priorityId,
    statusId: index === 3 ? "s3" : i.statusId, statusName: index === 3 ? "Проверить результат" : base.statuses.find(s => s.id === i.statusId)!.name,
    statusCategory: index === 0 || index === 4 ? "todo" : "inprogress", statusSid: index === 2 || index === 3 ? "review" : index === 0 ? "todo" : "inprogress",
    projectRole: employee ? "employee" : "manager", returnedForRework: false, dueDate: index === 3 ? null : i.dueDate, projectKey: "CORP", projectName: base.project.name,
  }));
  if (employee) Object.assign(items[2], { statusSid: "inprogress", returnedForRework: true });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me" && employee) return route.fulfill({ json: { ...base.users[0], globalRole: "member" } });
    if (path === "/api/issues/assigned-to-me") return route.fulfill({ json: { items, truncated: false, limit: 100 } });
    if (path === "/api/issues/search") return route.fulfill({ json: { items: [], truncated: false } });
    if (path === "/api/roadmap") return route.fulfill({ json: { projects: [
      { ...base.project, total: 12, done: 7, canEdit: !employee, milestones: [] },
      { ...base.project, id: "p2", key: "LEGAL", name: "Юридические вопросы и согласование договоров", total: 9, done: 3, canEdit: !employee, milestones: [] },
    ], dependencies: [] } });
    if (path === "/api/notifications") return route.fulfill({ json: { items: [
      { id: "n1", type: "issue.status", actor: base.users[1], projectId: "p1", issueId: "i1", payload: { key: "CORP-1", title: items[0].title }, read: false, createdAt: "2026-10-04T06:50:00Z" },
      { id: "n2", type: "issue.comment", actor: base.users[0], projectId: "p1", issueId: "i4", payload: { key: "CORP-4", title: items[1].title }, read: true, createdAt: "2026-10-04T06:30:00Z" },
    ], nextCursor: null } });
    if (/\/api\/projects\/p1\/issues\/i\d+$/.test(path)) return route.fulfill({ json: { ...base.issues.find(i => path.endsWith("/" + i.id)), attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [], comments: [], activity: [], watch: { watching: false, watchers: 0 } } });
    if (path === "/api/projects/p1/issues/epic1") return route.fulfill({ json: { ...base.issues[0], id: "epic1", key: "CORP-E1", title: "Корпоративная платформа", epicId: null, color: null } });
    return route.fallback();
  });
  return { ...base, items };
}
