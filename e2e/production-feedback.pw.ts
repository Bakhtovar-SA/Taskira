import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

const project = (id: string, key: string) => ({ id, key, name: `${key} project`, description: "", departmentId: null, isShared: false, sprintsEnabled: true, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false });
const user = { id: "u1", username: "admin", name: "Test Admin", initials: "TA", color: "", jobRole: "", globalRole: "admin", isActive: true, authSource: "local" };
const issue = (n: number, key = "TEST", priorityId = "medium") => ({ id: `i${n}`, key: `${key}-${n}`, title: `Task ${key} ${n}`, description: "", typeId: "task", priorityId, statusId: "s1", assigneeIds: ["u1"], reporterId: "u1", dueDate: null, epicId: null, parentId: null, sprintId: null, labels: [], complexity: null, rank: n, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", archivedAt: null, doneAt: null });
async function api(page: Page, multiple = false) {
  await mockApi(page);
  const projects = [project("p1", "TEST"), ...(multiple ? [project("p2", "OTHER")] : [])];
  const issues = [issue(1, "TEST", "low"), issue(2), issue(3, "TEST", "high"), issue(4, "TEST", "critical"), issue(5, "OTHER")];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/projects") return route.fulfill({ json: projects });
    const p = projects.find(p => path === `/api/projects/${p.id}`);
    if (p) return route.fulfill({ json: { project: p, users: [user], members: [{ userId: "u1", role: "admin" }], workflow: { statuses: [{ id: "s1", sid: "todo", name: "Todo", category: "todo", position: 0 }], transitions: [] }, issueTemplates: [], customFields: [], sprints: [] } });
    if (path === "/api/issues/assigned-to-me") return route.fulfill({ json: { items: projects.map(p => { const i = issues.find(i => i.key.startsWith(`${p.key}-`))!; return { issueId: i.id, projectId: p.id, key: i.key, title: i.title, typeId: i.typeId, priorityId: i.priorityId, statusId: "s1", statusName: "Todo", statusCategory: "todo", dueDate: null, projectKey: p.key, projectName: p.name }; }), truncated: false, limit: 100 } });
    if (path === "/api/issues/search") return route.fulfill({ json: { items: issues.map(i => ({ id: i.id, projectId: i.key.startsWith("OTHER") ? "p2" : "p1", key: i.key, title: i.title, statusCategory: "todo" })), hasMore: false } });
    if (path === "/api/issues/resolve") { const i = issues.find(i => i.key === url.searchParams.get("key")); return route.fulfill({ json: { id: i?.id, projectId: i?.key.startsWith("OTHER") ? "p2" : "p1", key: i?.key } }); }
    const match = path.match(/^\/api\/projects\/(p[12])\/issues(?:\/(i\d+))?$/);
    if (match) { const selected = issues.filter(i => match[1] === "p2" ? i.key.startsWith("OTHER") : i.key.startsWith("TEST")); return route.fulfill({ json: match[2] ? selected.find(i => i.id === match[2]) : { items: selected, hasMore: false, nextCursor: null } }); }
    return route.fallback();
  });
}

test("home cards, logo, history, palette and assigned tasks across two projects", async ({ page }) => {
  await api(page, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /OTHER project/ }).first().click();
  await expect(page).toHaveURL(/\/p\/OTHER\/board$/);
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack(); await expect(page).toHaveURL(/\/p\/OTHER\/board$/);
  await page.goForward(); await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox"); await expect(input).toBeVisible(); await input.fill("OTHER project"); await input.press("Enter");
  await expect(page).toHaveURL(/\/p\/OTHER\/board$/);
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await page.getByText("Task OTHER 5", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/p\/OTHER\/issue\/OTHER-5$/);
  await expect(page.locator('[data-issue-details="i5"]')).toBeVisible();
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await page.getByText("Task TEST 1", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/p\/TEST\/issue\/TEST-1$/);
  await expect(page.locator('[data-issue-details="i1"]')).toBeVisible();
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await page.keyboard.press("Control+k"); await page.getByRole("combobox").fill("OTHER-5");
  await page.getByRole("option", { name: /Task OTHER 5/ }).click();
  await expect(page).toHaveURL(/\/p\/OTHER\/issue\/OTHER-5$/);
});

for (const theme of ["light", "dark"]) test(`all four priorities, single-project logo and calendar label (${theme})`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
  await api(page);
  await page.goto("/p/TEST/board");
  const cards = page.locator("article[data-issue-id]"); await expect(cards).toHaveCount(4);
  for (const [n, label] of [[1, "Низкий"], [2, "Средний"], [3, "Высокий"], [4, "Критичный"]] as const) await expect(page.locator(`article[data-issue-id="i${n}"]`).getByRole("img", { name: label, exact: true })).toBeVisible();
  const calendar = page.getByRole("link", { name: "Календарь", exact: true });
  await expect(calendar).toHaveAttribute("href", "/p/TEST/calendar");
  await expect.poll(() => calendar.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim() !== "Календарь") continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      return box.width > 20 && box.height > 10;
    }
    return false;
  })).toBe(true);
  await calendar.click(); await expect(page).toHaveURL(/\/calendar$/); await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("button", { name: "На главный экран", exact: true }).click(); await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: /TEST project/ }).first().click(); await expect(page).toHaveURL(/\/p\/TEST\//);
});

for (const lang of ["ru", "en"]) test(`help navigation follows scrolling and clicks (${lang})`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem("taskira.lang", lang), lang);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await api(page); await page.goto("/help");
  const prefix = lang === "ru" ? "doc-" : "doc-en-";
  const nav = page.locator("main nav");
  await expect(nav.locator('[aria-current="location"]')).toContainText(lang === "ru" ? "Обзор системы" : "System overview");
  await page.locator(`#${prefix}notifications`).evaluate(el => el.scrollIntoView({ block: "start" }));
  await expect(nav.locator('[aria-current="location"]')).toContainText(lang === "ru" ? "Уведомления" : "Notifications");
  await nav.getByRole("button", { name: lang === "ru" ? "Рабочий процесс" : "Workflow", exact: true }).click();
  await expect(nav.locator('[aria-current="location"]')).toContainText(lang === "ru" ? "Рабочий процесс" : "Workflow");
  await page.locator(`#${prefix}storage`).evaluate(el => el.scrollIntoView({ block: "start" }));
  await expect(nav.locator('[aria-current="location"]')).toContainText(lang === "ru" ? "Хранение и сессия" : "Storage and sessions");
});
