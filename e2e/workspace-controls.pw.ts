import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";
import { boardFixture } from "./board-fixture";

for (const theme of ["light", "dark"]) for (const width of [1440, 390, 320]) {
  test(`list popovers preserve toolbar and table positions (${theme}, ${width})`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
    await page.goto("/p/TEST/list");
    const filters = page.getByRole("button", { name: /^Фильтры/ });
    const options = page.getByRole("button", { name: "Настройки вида", exact: true });
    await expect(filters).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const before = await filters.boundingBox();
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Фильтры", exact: true });
    await expect(panel).toBeVisible();
    expect(await filters.boundingBox()).toEqual(before);
    expect(before!.width).toBeLessThan(220);
    expect((await panel.boundingBox())!.y).toBeGreaterThan(before!.y + before!.height);
    await options.click();
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(options).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: test.info().outputPath("expanded-options.png") });
    await page.keyboard.press("Escape");
    await expect(options).toBeFocused();
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const axe = await new AxeBuilder({ page }).include(".workspace-panel").analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("expanded-filters.png") });
    await panel.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(filters).toBeFocused();
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await options.click();
    await expect(page.getByRole("button", { name: "Выделить", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await expect(options).toBeFocused();
  });
}

for (const theme of ["light", "dark"]) for (const width of [1440, 390, 320]) {
  test(`board direct actions and selection toggle work (${theme}, ${width})`, async ({ page }) => {
    await boardFixture(page, theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/p/CORP/board");
    const photo = page.getByRole("button", { name: "Фото доски", exact: true });
    const select = page.getByRole("button", { name: "Выделить", exact: true });
    await expect(photo).toBeVisible();
    await expect(select).toBeVisible();
    await expect(page.locator(".workspace-controls").getByRole("button", { name: /^Фильтры|Настройки вида$/ })).toHaveCount(0);
    await photo.click();
    await expect(page.getByRole("dialog", { name: "Вид доски" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(photo).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await select.click();
    const card = page.getByRole("article").first();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveAttribute("draggable", "false");
    await card.click();
    await expect(card).toHaveAttribute("data-selected");
    await select.click();
    await expect(card).not.toHaveAttribute("data-selected");
    await expect(card).toHaveAttribute("draggable", "true");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(select).toBeFocused();
    await select.click();
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    const axe = await new AxeBuilder({ page }).include(".board-view").analyze();
    expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  });
}

for (const theme of ["dark", "light"]) for (const width of [1920, 3440, 390, 320]) {
  test(`filter value menus use Taskira styling and preserve filters (${theme}, ${width})`, async ({ page }) => {
    await boardFixture(page, theme);
    await page.setViewportSize({ width, height: width === 3440 ? 1440 : 1080 });
    await page.goto("/p/CORP/list");
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const panel = page.locator('.workspace-panel[data-panel="filters"]');
    await expect(panel.locator("select")).toHaveCount(0);
    const status = panel.getByRole("button", { name: "Статус", exact: true });
    await status.click();
    const menu = page.getByRole("menu", { name: "Статус", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Все статусы", exact: true }).locator('.ds-menu-hint')).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).include('.workspace-select-menu').analyze()).violations).toEqual([]);
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem").last()).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(/status=s1/);
    await status.click();
    await expect(menu.getByRole("menuitem", { name: "К выполнению", exact: true }).locator('.ds-menu-hint')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(status).toBeFocused();
    for (const label of ["Исполнитель", "Тип задачи", "Приоритет"]) {
      await panel.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("menu", { name: label, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    await expect(panel.getByRole("button", { name: "Статус", exact: true })).toHaveText("К выполнению");
  });
}
