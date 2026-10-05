import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Locator } from "@playwright/test";

const project = { id: "p1", key: "TEST", name: "Test project", description: "", departmentId: null, isShared: false, sprintsEnabled: true, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
const user = { id: "u1", username: "admin", name: "Test Admin", initials: "TA", color: "", jobRole: "", globalRole: "admin", isActive: true, authSource: "local", favoriteProjectIds: [], notifyPrefs: {}, onboarding: { hidden: true } };
const boot = { project, users: [user], members: [{ userId: "u1", role: "admin" }], workflow: { statuses: [{ id: "s1", sid: "todo", name: "Todo", category: "todo", position: 0 }], transitions: [] }, issueTemplates: [], customFields: [], sprints: [] };
async function mockApi(page: Page) {
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.error("browser:", msg.text()); });
  let brand = { name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const path = pathname.replace(/^\/api/, "");
    const method = route.request().method();
    let body: unknown = [];
    if (path === "/admin/setup") body = { completed: true };
    else if (path === "/me/onboarding") body = { done: [], hints: [], hidden: true };
    else if (path === "/auth/me") body = user;
    else if (path === "/auth/config") body = { authMode: "local" };
    else if (path === "/issues/assigned-to-me") body = { items: [], truncated: false, limit: 100 };
    else if (path === "/roadmap") body = { projects: [], dependencies: [] };
    else if (path === "/projects") body = [project];
    else if (path === "/projects/p1") body = boot;
    else if (path === "/instance/brand") body = brand;
    else if (path === "/admin/brand" && method === "PATCH") {
      const patch = route.request().postDataJSON();
      writes.push({ path, body: patch });
      brand = { ...brand, ...patch }; body = brand;
    } else if (path === "/projects/p1/issues" && method === "POST") {
      const draft = route.request().postDataJSON(); writes.push({ path, body: draft });
      body = { ...draft, id: "i1", key: "TEST-1", reporterId: "u1", assigneeIds: [], labels: [], parentId: null, epicId: null, complexity: null, sprintId: null, rank: 0, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", doneAt: null, archivedAt: null };
    } else if (path.endsWith("/issues/counts")) body = { total: 0, byStatus: {}, byPriority: {}, overdue: 0 };
    else if (path.endsWith("/issues/epics") || path.endsWith("/issues/assignees")) body = { items: [], truncated: false, limit: 200 };
    else if (path.endsWith("/issues")) body = { items: [], hasMore: false, nextCursor: null };
    else if (path === "/notifications") body = { items: [], nextCursor: null };
    else if (path === "/notifications/unread-count") body = { count: 0 };
    else if (path === "/maintenance") body = { settings: { auditRetentionDays: 90 } };
    else if (path.startsWith("/reports/")) body = { from: "2026-09-01", to: "2026-10-01", groupBy: "project", projectCount: 1, totals: { closed: 0, created: 0, open: 0, overdue: 0, avgLeadDays: null, medianLeadDays: null }, rows: [], trend: [] };
    await route.fulfill({ json: body });
  });
  return writes;
}
async function exerciseDate(page: Page, label: string, clear: string, scope: Page | Locator = page, clearable = true) {
  const trigger = scope.getByRole("button", { name: new RegExp(`^${label}:`) });
  await trigger.click();
  const input = page.getByRole("textbox", { name: label, exact: true });
  await expect(input).toBeFocused();
  await input.fill("15 окт 2026");
  await input.press("Enter");
  await expect(trigger).toHaveAccessibleName(new RegExp("15"));
  if (clearable) {
    await trigger.click();
    await page.getByRole("button", { name: clear, exact: true }).click();
    await expect(trigger).toHaveAccessibleName(new RegExp("Без даты|Без срока"));
  }
  await trigger.click();
  // Move through the calendar with a keyboard and choose the focused day.
  await page.locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
}
for (const theme of ["light", "dark"] as const) {
  test(`track I dates and nested calendar · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((v) => localStorage.setItem("taskira.theme", v), theme);
    const writes = await mockApi(page);
    await page.goto("/p/TEST/list");
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    await page.getByRole("button", { name: /^Срок/, exact: false }).click();
    await exerciseDate(page, "С", "Убрать срок");
    await exerciseDate(page, "По", "Убрать срок");
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog", { name: "Новая задача" })).toBeVisible();
    const createDialog = page.getByRole("dialog", { name: /Новая задача/ });
    await exerciseDate(page, "Срок", "Убрать срок", createDialog);
    await createDialog.getByRole("button", { name: /^Срок:/ }).click();
    await page.getByRole("textbox", { name: "Срок", exact: true }).fill("15 окт 2026");
    await page.getByRole("textbox", { name: "Срок", exact: true }).press("Enter");
    await createDialog.getByPlaceholder("Например: Экран восстановления пароля").fill("Date payload check");
    await createDialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body.dueDate).toBe("2026-10-15");
    await page.goto("/p/TEST/sprints");
    await page.getByRole("button", { name: "Новый спринт", exact: true }).click();
    await exerciseDate(page, "Начало", "Убрать срок");
    await exerciseDate(page, "Конец", "Убрать срок");
    await page.keyboard.press("Escape");
    await page.goto("/reports");
    // Reports require both dates; extend the end before moving the start into October.
    await exerciseDate(page, "по", "Убрать срок", page, false);
    await exerciseDate(page, "с", "Убрать срок", page, false);
    await page.goto("/admin/audit");
    await exerciseDate(page, "С", "Убрать срок");
    await exerciseDate(page, "По", "Убрать срок");
    await page.screenshot({ path: test.info().outputPath("screen.png"), fullPage: true });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
  test(`track I organization and personal transparency · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const writes = await mockApi(page);
    await page.goto("/admin/brand");
    await page.getByRole("radiogroup", { name: "Прозрачность по умолчанию" }).getByLabel("Всегда включена").check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body.transparencyDefault).toBe("on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "on");
    await page.goto("/settings/appearance");
    await expect(page.getByText("Организация включила прозрачность для всех")).toBeVisible();
    const options = page.getByRole("radiogroup", { name: "Прозрачность", exact: true });
    await options.getByLabel("Выключена", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "off");
    await options.getByLabel("Включена", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "on");
    await page.reload();
    await expect(options.getByLabel("Включена", { exact: true })).toBeChecked();
    await page.emulateMedia({ contrast: "more" });
    await options.getByLabel("Как в системе", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "off");
    await options.getByLabel("Включена", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "on");
    await expect(page.getByText("Включён повышенный контраст — стекло может снижать читаемость")).toBeVisible();
    await options.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("screen.png"), fullPage: true });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
}
