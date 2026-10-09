import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const theme of ["light", "dark"]) for (const width of [1440, 390, 320]) {
  test(`list panels stay below stable controls (${theme}, ${width})`, async ({ page }) => {
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
    await page.getByRole("button", { name: "Выделить", exact: true }).click();
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await expect(options).toBeFocused();
  });
}

for (const theme of ["light", "dark"]) for (const width of [1440, 390, 320]) {
  test(`board has direct actions and no hidden filter panel (${theme}, ${width})`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
    await page.goto("/p/TEST/board");
    await expect(page.getByRole("button", { name: "Фото доски" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выделить", exact: true })).toBeVisible();
    await expect(page.locator(".workspace-controls").getByRole("button", { name: /^Фильтры|Настройки вида$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Фото доски" }).click();
    await expect(page.getByRole("dialog", { name: "Вид доски" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Фото доски" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("button", { name: "Выделить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Выделить", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
}
