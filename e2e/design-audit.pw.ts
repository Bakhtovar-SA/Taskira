import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures";

const users = [
  { id: "u1", username: "admin", name: "Анна Смирнова", initials: "АС", color: "", jobRole: "", globalRole: "admin", isActive: true, authSource: "local" },
  { id: "u2", username: "igor", name: "Игорь Петров", initials: "ИП", color: "", jobRole: "", globalRole: "member", isActive: true, authSource: "local" },
];
const project = { id: "p1", key: "TEST", name: "Рабочий проект", description: "", departmentId: null, isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
const statuses = [
  { id: "s1", sid: "todo", name: "К выполнению", category: "todo", position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress", position: 1 },
];
const issues = ["Согласовать требования отдела продаж к клиентскому порталу", "Проверить договор поставки", "Обновить инструкции для новых сотрудников"].map((title, n) => ({
  id: `i${n + 1}`, key: `TEST-${n + 1}`, title, description: "Описание задачи для проверки",
  typeId: "task", statusId: n === 0 ? "s1" : "s2", priorityId: "medium", assigneeIds: n < 2 ? ["u1"] : ["u2"],
  reporterId: "u1", epicId: null, parentId: null, labels: ["аналитика"], complexity: null, dueDate: "2026-10-01", rank: n,
  createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", doneAt: null, archivedAt: null, sprintId: null,
  attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [], comments: [], activity: [], watch: { watching: false, watchers: 0 }, subtasksSummary: { total: 0, done: 0 },
}));

async function fixture(page: Page, theme: string) {
  await page.addInitScript(theme => { localStorage.setItem("taskira.theme", theme); localStorage.setItem("taskira.lang", "ru"); }, theme);
  await page.routeWebSocket("**/api/ws", socket => socket.close());
  const writes = await mockApi(page, users[0]);
  await page.route("**/api/**", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url()), path = url.pathname, q = url.searchParams;
    if (path === "/api/projects/p1") return route.fulfill({ json: {
      project, users, members: users.map(u => ({ userId: u.id, role: "admin" })), workflow: { statuses, transitions: [{ from: "s1", to: "s2" }, { from: "s2", to: "s1" }] }, issueTemplates: [], customFields: [], sprints: [],
    } });
    if (path === "/api/projects") return route.fulfill({ json: [project] });
    if (path === "/api/projects/p1/issues/epics" || path === "/api/projects/p1/issues/assignees") return route.fulfill({ json: { items: [], truncated: false } });
    if (/\/issues\/i\d$/.test(path)) return route.fulfill({ json: issues.find(i => path.endsWith(i.id)) });
    if (/\/issues\/i\d\/(comments|activity|collaborators)$/.test(path)) return route.fulfill({ json: [] });
    if (path === "/api/projects/p1/issues" || path.endsWith("/issues/counts")) {
      const items = issues.filter(i => (!q.get("statusId") || i.statusId === q.get("statusId"))
        && (!q.get("assignee") || i.assigneeIds.includes(q.get("assignee")!))
        && (!q.get("parentId") || i.parentId === q.get("parentId"))
        && (!q.get("q") || i.title.toLowerCase().includes(q.get("q")!.toLowerCase())));
      if (path.endsWith("/counts")) return route.fulfill({ json: { total: items.length, byStatus: Object.fromEntries(statuses.map(s => [s.id, items.filter(i => i.statusId === s.id).length])) } });
      return route.fulfill({ json: { items, hasMore: false, nextCursor: null } });
    }
    return route.fallback();
  });
  return writes;
}

test("composed task screens work without CSP violations", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { taskCspViolations: violations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
  });
  await fixture(page, "dark");
  const response = await page.goto("/p/TEST/list");
  if (process.env.AUDIT_PRODUCTION === "1") expect(response?.headers()["content-security-policy"]).toContain("style-src-attr 'none'");
  await page.getByRole("link", { name: issues[0].title }).click();
  await page.getByText("Дополнительные свойства", { exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Метки", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await page.getByText("Дополнительные поля", { exact: true }).click();
  await expect(page.getByLabel("Чек-лист", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Не назначен/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { taskCspViolations: string[] }).taskCspViolations)).toEqual([]);
});

for (const theme of ["light", "dark"]) {
  test(`task links, actions and table reflow (${theme})`, async ({ page }) => {
    await fixture(page, theme);
    await page.goto("/p/TEST/list");
    const row = page.locator('[role=row][data-issue-id="i1"]');
    await expect(row).toBeVisible();
    for (const width of [1440, 1065, 768, 720, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const link = row.getByRole("link", { name: issues[0].title });
      await expect(link).toHaveAttribute("href", "/p/TEST/issue/TEST-1");
      await link.focus();
      await expect(link).toBeFocused();
      const action = row.getByRole("button", { name: "Действия" });
      await action.scrollIntoViewIfNeeded();
      await action.click();
      await expect(page.getByRole("menuitem", { name: "Открыть задачу" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(action).toBeFocused();
      if (width < 640) {
        const actionBox = (await action.boundingBox())!;
        const rowBox = (await row.boundingBox())!;
        expect(actionBox.x).toBeGreaterThanOrEqual(rowBox.x);
        expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
        expect(await page.locator(".list-table").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        expect((await link.boundingBox())!.height).toBeGreaterThan(30);
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await row.boundingBox())!.y).toBeLessThan(420);
      }
    }
    const link = row.getByRole("link", { name: issues[0].title });
    await link.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(link).toBeFocused();
  });

  test(`draft survives Esc and failed creation, successful creation clears it (${theme})`, async ({ page }) => {
    const writes = await fixture(page, theme);
    await page.goto("/p/TEST/board");
    const create = page.getByRole("button", { name: "Создать задачу", exact: true });
    await create.click();
    const title = page.getByLabel("Название *", { exact: true });
    await title.fill("Черновик новой задачи");
    await page.getByLabel("Описание", { exact: true }).fill("Подробности черновика");
    await page.getByText("Дополнительные поля", { exact: true }).click();
    await page.getByLabel("Чек-лист", { exact: true }).fill("Проверить согласование");
    await page.getByLabel("Метки", { exact: true }).fill("важное");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await create.click();
    await expect(title).toHaveValue("Черновик новой задачи");
    await expect(page.getByLabel("Описание", { exact: true })).toHaveValue("Подробности черновика");
    await expect(page.getByLabel("Чек-лист", { exact: true })).toHaveValue("Проверить согласование");
    expect(writes).toHaveLength(0);
    let fail = true;
    await page.route("**/api/projects/p1/issues", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      if (fail) return route.fulfill({ status: 503, json: { code: "INTERNAL", error: "Temporarily unavailable" } });
      return route.fallback();
    });
    await page.getByRole("dialog").getByRole("button", { name: "Создать задачу", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Введённые данные сохранены");
    await expect(title).toHaveValue("Черновик новой задачи");
    fail = false;
    await page.getByRole("dialog").getByRole("button", { name: "Создать задачу", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ title: "Черновик новой задачи", description: "Подробности черновика", checklistItems: ["Проверить согласование"], labels: ["важное"] });
    await create.click();
    await expect(title).toHaveValue("");
  });

  test(`board and list retain filters and readable density (${theme})`, async ({ page }) => {
    await fixture(page, theme);
    await page.goto("/p/TEST/board");
    await page.locator(".workspace-filters > summary").click();
    await page.getByRole("main").getByRole("button", { name: "Мои задачи", exact: true }).click();
    await expect(page).toHaveURL(/assignee=u1/);
    await expect(page.locator("article[data-issue-id]")).toHaveCount(2);
    await page.getByRole("link", { name: "Список", exact: true }).click();
    await expect(page).toHaveURL(/\/list\?assignee=u1/);
    await expect(page.locator("[role=row][data-issue-id]")).toHaveCount(2);
    const row = page.locator("[role=row][data-issue-id]").first();
    const comfortable = (await row.boundingBox())!.height;
    await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
    expect((await row.boundingBox())!.height).toBeLessThan(comfortable);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await page.getByRole("link", { name: "Доска", exact: true }).click();
    await expect(page).toHaveURL(/\/board\?assignee=u1/);
    await expect(page.locator("article[data-issue-id]")).toHaveCount(2);
  });

  test(`mobile properties precede activity and actual forms pass axe (${theme})`, async ({ page, browserName }) => {
    await fixture(page, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/issues/resolve**", route => route.fulfill({ json: { projectId: "p1", issueId: "i1", projectKey: "TEST" } }));
    await page.goto("/p/TEST/list");
    await page.getByRole("link", { name: issues[0].title }).click();
    const dialog = page.locator("dialog[open]");
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    const properties = page.locator(".issue-properties");
    await expect(properties).toBeVisible();
    const activity = page.getByRole("group", { name: "Лента задачи" });
    expect((await properties.boundingBox())!.y).toBeLessThan((await activity.boundingBox())!.y);
    expect((await properties.boundingBox())!.y).toBeLessThan(300);
    expect(await properties.evaluate(el => !!(el.compareDocumentPosition(document.querySelector(".issue-content")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    if (browserName === "chromium") {
      const issueAxe = await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze();
      expect(issueAxe.violations).toEqual([]);
      await page.getByText("Дополнительные свойства", { exact: true }).click();
      expect((await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze()).violations).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
    if (browserName === "chromium") {
      const createAxe = await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze();
      expect(createAxe.violations).toEqual([]);
      await page.getByText("Дополнительные поля", { exact: true }).click();
      expect((await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze()).violations).toEqual([]);
    }
  });
}
