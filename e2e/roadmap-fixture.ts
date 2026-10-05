import type { Page } from "@playwright/test";
import type { RoadmapDto } from "../server/src/contract";
import { boardFixture } from "./board-fixture";
export async function roadmapFixture(page: Page, theme = "light", lang = "ru", count = 5) {
  const base = await boardFixture(page, theme, 4, lang);
  const projects: RoadmapDto["projects"] = [
    { ...base.project, id: "p1", key: "CORP", name: "Корпоративная платформа", departmentId: "d1", color: "teal", icon: null, createdAt: "2026-01-01", startDate: "2026-09-01", targetDate: "2026-11-15", done: 3, total: 21, canEdit: true, milestones: [{ id: "old", name: "Подготовка", date: "2026-09-10" }, { id: "m1", name: "Пилотный запуск", date: "2026-10-12" }] },
    { ...base.project, id: "p2", key: "LEGAL", name: "Юридические вопросы и согласование договоров", departmentId: "d2", color: "violet", icon: null, createdAt: "2026-01-01", startDate: "2026-10-04", targetDate: "2026-12-01", done: 0, total: 14, canEdit: false, milestones: [{ id: "m2", name: "Согласование", date: "2026-11-01" }] },
    { ...base.project, id: "p3", key: "API", name: "Интеграция сервисов", departmentId: "d1", color: "blue", icon: null, createdAt: "2026-01-01", startDate: "2026-10-08", targetDate: null, done: 10, total: 21, canEdit: true, milestones: [] },
    { ...base.project, id: "p4", key: "WEB", name: "Веб-портал", departmentId: "d1", color: "green", icon: null, createdAt: "2026-01-01", startDate: "2026-09-01", targetDate: "2026-10-04", done: 21, total: 21, canEdit: true, milestones: [] },
    { ...base.project, id: "p5", key: "OPS", name: "Автоматизация работы команды", departmentId: "d2", color: "orange", icon: null, createdAt: "2026-01-01", startDate: null, targetDate: null, done: 0, total: 0, canEdit: true, milestones: [] },
  ];
  for (let i = 5; i < count; i++) projects.push({ ...projects[0], id: `p${i+1}`, key: `PR${i+1}`, name: `Проект ${String(i+1).padStart(3,"0")}`, milestones: [] });
  const roadmap: RoadmapDto = { projects: count === 0 ? [] : projects, dependencies: count === 0 ? [] : [{ sourceId: "p1", dependentId: "p2" }, { sourceId: "p4", dependentId: "p2" }, { sourceId: "p4", dependentId: "p3" }] };
  await page.addInitScript(() => localStorage.setItem("taskira.roadmap.zoom", "month"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/roadmap") return route.fulfill({ json: roadmap });
    if (path === "/api/projects") return route.fulfill({ json: projects });
    const project = projects.find(p => path === `/api/projects/${p.id}`);
    if (project) return route.fulfill({ json: { project, users: base.users, members: base.users.map(u => ({ userId: u.id, role: "admin" })), workflow: { statuses: base.statuses, transitions: [] }, issueTemplates: [], customFields: [], sprints: [] } });
    return route.fallback();
  });
  return roadmap;
}
