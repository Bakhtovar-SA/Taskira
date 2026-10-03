import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

test("read-only project retains its permission guard on a narrow screen", async ({ page }) => {
  await workspace(page, "dark");
  const profile = { id: "u1", username: "viewer", name: "Test Viewer", initials: "TV", color: "", jobRole: "", globalRole: "member", isActive: true, authSource: "local" };
  await page.route("**/api/auth/me", route => route.fulfill({ json: profile }));
  await page.route("**/api/projects/p1", route => route.fulfill({ json: {
    project: projects[0], users: [profile], members: [{ userId: "u1", role: "viewer" }],
    workflow: { statuses, transitions: [] }, issueTemplates: [], customFields: [], sprints: [],
  } }));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/p/TEST/board");
  const create = page.getByRole("button", { name: "Создать задачу", exact: true });
  await expect(create).toBeDisabled();
  await expect(page.locator("article[data-issue-id]")).toHaveCount(3);
  await expect(page.locator("article[draggable=true]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

const projects = [
  { id: "p1", key: "TEST", name: "Корпоративные задачи", departmentId: null, isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false, description: "" },
  { id: "p2", key: "SALES", name: "Sales", departmentId: null, isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false, description: "" },
];
const statuses = [
  { id: "s1", sid: "todo", name: "К выполнению", category: "todo", position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress", position: 1 },
  { id: "s3", sid: "review", name: "На ревью", category: "inprogress", position: 2 },
  { id: "s4", sid: "done", name: "Готово", category: "done", position: 3 },
];
const issues = ["Подготовить предложение для клиента", "Проверить договор", "Согласовать макет"].map((title, n) => ({
  id: `i${n + 1}`, key: `TEST-${n + 1}`, title, description: "", typeId: "task", statusId: n === 0 ? "s2" : "s3",
  priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, labels: [], complexity: null,
  dueDate: null, rank: n, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z",
  doneAt: null, archivedAt: null, sprintId: null, attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [],
}));

async function workspace(page: Page, theme: string) {
  await page.addInitScript(theme => { localStorage.setItem("taskira.theme", theme); localStorage.setItem("taskira.lang", "ru"); }, theme);
  const writes = await mockApi(page);
  await page.route("**/api/projects", route => route.fulfill({ json: projects }));
  await page.route(/\/api\/projects\/p[12]$/, route => route.fulfill({ json: {
    project: projects.find(p => new URL(route.request().url()).pathname.endsWith(p.id)),
    users: [{ id: "u1", username: "admin", name: "Test Admin", initials: "TA", color: "", jobRole: "", globalRole: "admin", isActive: true, authSource: "local" }],
    members: [{ userId: "u1", role: "admin" }], workflow: { statuses, transitions: [{ from: "s2", to: "s3" }] }, issueTemplates: [], customFields: [], sprints: [],
  } }));
  await page.route("**/api/projects/p1/issues**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/counts")) return route.fulfill({ json: { total: 3, byStatus: { s1: 0, s2: 1, s3: 2, s4: 0 } } });
    if (url.pathname.endsWith("/epics") || url.pathname.endsWith("/assignees")) return route.fulfill({ json: { items: [], truncated: false } });
    return route.fulfill({ json: { items: issues.filter(i => !url.searchParams.get("statusId") || i.statusId === url.searchParams.get("statusId")), hasMore: false, nextCursor: null } });
  });
  await page.route("**/api/issues/assigned-to-me*", route => route.fulfill({ json: { items: [], truncated: false, limit: 100 } }));
  return writes;
}

for (const theme of ["light", "dark"]) {
  test(`home search, project choice and mobile empty state (${theme})`, async ({ page }) => {
    const writes = await workspace(page, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Sales/ })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    expect((await page.getByRole("button", { name: /Sales/ }).boundingBox())!.y).toBeLessThan(450);
    const search = page.getByRole("textbox", { name: "Поиск моих задач и проектов…" });
    await search.fill("sales");
    await expect(page.getByRole("button", { name: /Sales/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Корпоративные задачи/ })).toHaveCount(0);
    await search.fill("  ");
    await expect(page.getByRole("button", { name: /Корпоративные задачи/ })).toBeVisible();
    await search.fill("");
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByText("Теперь при входе — список ваших проектов и задач.", { exact: false })).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: `shots/workspace-home-mobile-${theme}.png` });
    await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
    const chooser = page.getByRole("dialog");
    await expect(chooser).toBeVisible();
    await chooser.getByRole("button", { name: "Sales", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Новая задача SALES/ })).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`project toolbar reflows and board remains accessible (${theme})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await workspace(page, theme);
    await page.goto("/p/TEST/board");
    await expect(page.locator("article[data-issue-id]")).toHaveCount(3);
    for (const width of [1440, 1065, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("link", { name: "Доска", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const search = page.getByRole("textbox", { name: "Фильтр по доске" });
      const box = (await search.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (width === 390) await page.screenshot({ path: `shots/workspace-board-mobile-${theme}.png` });
      if (width < 768) {
        const globalSearch = page.getByRole("textbox", { name: "Поиск задач…" });
        await globalSearch.focus();
        await expect(page.locator(".topbar-search")).toHaveClass(/is-expanded/);
        const expanded = (await globalSearch.boundingBox())!;
        expect(expanded.x).toBeGreaterThanOrEqual(0);
        expect(expanded.y).toBeGreaterThanOrEqual(0);
        expect(expanded.x + expanded.width).toBeLessThanOrEqual(width);
        await globalSearch.fill("Подготовить");
        const results = page.locator(".topbar-search > .glass");
        await expect(results).toBeVisible();
        const resultsBox = (await results.boundingBox())!;
        expect(resultsBox.x).toBeGreaterThanOrEqual(0);
        expect(resultsBox.x + resultsBox.width).toBeLessThanOrEqual(width);
        await globalSearch.fill("");
        await page.getByRole("heading", { name: "Доска", exact: true }).click();
        await expect(page.locator(".topbar-search")).not.toHaveClass(/is-expanded/);
        const columns = page.locator(".board-col");
        const first = (await columns.nth(0).boundingBox())!;
        const second = (await columns.nth(1).boundingBox())!;
        expect(Math.abs(first.x - second.x)).toBeLessThan(1);
        expect(second.y).toBeGreaterThan(first.y + first.height - 1);
        const create = page.getByRole("button", { name: "Создать задачу", exact: true });
        expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({ width: 1065, height: 900 });
    const tabs = page.getByRole("navigation", { name: "Представления проекта" });
    for (const tab of await tabs.getByRole("link").all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(1065);
    }
    await page.getByRole("textbox", { name: "Поиск задач…" }).focus();
    await expect(page.locator(".topbar-search")).toHaveClass(/is-expanded/);
    await page.keyboard.press("Tab");
    await page.screenshot({ path: `shots/workspace-board-${theme}.png` });
    const axe = await new AxeBuilder({ page }).include("main").analyze();
    expect(axe.violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
