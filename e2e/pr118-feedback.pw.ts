import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("create form orders the checklist, searches project assignees and dismisses direction", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/projects/p1", route => route.fulfill({ json: {
    project: { id: "p1", key: "TEST", name: "Test project", description: "", departmentId: null, isShared: false, sprintsEnabled: true, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false },
    users: [
      { id: "u1", username: "admin", name: "Test Admin", initials: "TA", color: "", jobRole: "", phone: "", globalRole: "admin", isActive: true, authSource: "local", avatarUpdatedAt: null },
      { id: "u2", username: "anna", name: "Анна Иванова", initials: "АИ", color: "", jobRole: "", phone: "", globalRole: "member", isActive: true, authSource: "ldap", avatarUpdatedAt: null },
      { id: "u3", username: "outside", name: "Анна из другого проекта", initials: "А", color: "", jobRole: "", phone: "", globalRole: "admin", isActive: true, authSource: "local", avatarUpdatedAt: null },
    ], members: [{ userId: "u1", role: "manager" }, { userId: "u2", role: "employee" }],
    workflow: { statuses: [{ id: "s1", sid: "todo", name: "Todo", category: "todo", position: 0 }], transitions: [] }, issueTemplates: [], customFields: [], sprints: [],
  } }));
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: /Новая задача/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/Экран восстановления пароля/) });
  const title = dialog.getByPlaceholder(/Экран восстановления пароля/);
  await title.fill("Проверить новый интерфейс");
  const description = await dialog.getByPlaceholder(/Что нужно сделать/).boundingBox();
  const checklist = await dialog.getByPlaceholder(/Добавить пункт/).boundingBox();
  expect(checklist!.y).toBeGreaterThan(description!.y + description!.height);
  await dialog.getByRole("button", { name: /Не назначен/, exact: true }).click();
  await page.getByRole("searchbox", { name: "Найти сотрудника проекта" }).fill("АННА");
  await expect(page.getByRole("button", { name: /Анна Иванова/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Анна из другого проекта/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Анна Иванова/ }).click();
  await title.click();
  const direction = dialog.getByRole("button", { name: "Без направления", exact: true }).and(page.locator("[aria-expanded]"));
  await direction.click(); await expect(direction).toHaveAttribute("aria-expanded", "true");
  await title.click(); await expect(direction).toHaveAttribute("aria-expanded", "false");
  await expect(title).toHaveValue("Проверить новый интерфейс");
  await expect(dialog).toBeVisible();
});

test("a board photo survives reload and belongs only to this browser account", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { boardCspViolations: violations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
  });
  await mockApi(page);
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: "Вид доски", exact: true }).click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: "Вид доски", exact: true }).getByRole("button", { name: "Загрузить фото", exact: true }).and(page.locator("button")).click();
  await (await fileChooser).setFiles("e2e/__screenshots__/tabs-light.png");
  await expect(page.locator('[data-personal-board-photo="true"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-personal-board-photo="true"]').evaluate(el => getComputedStyle(el).backgroundImage)).toContain("blob:");
  await expect(page.locator("html")).not.toHaveAttribute("data-photo");
  await expect.poll(() => page.locator('[data-personal-board-photo="true"]').evaluate(el => {
    const url = /url\("?([^"\)]+)"?\)/.exec(getComputedStyle(el).backgroundImage)?.[1];
    return new Promise<boolean>(resolve => {
      if (!url) return resolve(false);
      const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0); image.onerror = () => resolve(false); image.src = url;
    });
  })).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { boardCspViolations: string[] }).boardCspViolations)).toEqual([]);
  await page.screenshot({ path: "shots/personal-board-photo.png" });
  await page.reload();
  await expect(page.locator('[data-personal-board-photo="true"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-personal-board-photo="true"]').evaluate(el => getComputedStyle(el).backgroundImage)).toContain("blob:");
  const other = await page.context().newPage();
  try {
    await mockApi(other, { id: "u2", username: "another" });
    await other.goto(new URL("/p/TEST/board", page.url()).href);
    await expect(other.getByRole("button", { name: "Вид доски", exact: true })).toBeVisible();
    await expect(other.locator('[data-personal-board-photo="true"]')).toHaveCount(0);
  } finally { await other.close(); }
  await page.getByRole("button", { name: "Вид доски", exact: true }).click();
  await page.getByRole("button", { name: "Убрать фото", exact: true }).click();
  await expect(page.locator('[data-personal-board-photo="true"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("blob:");
});
