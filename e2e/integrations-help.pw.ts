import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { shellFixture } from "./shell-fixture";

for (const lang of ["ru", "en"] as const) for (const theme of ["light", "dark"] as const) {
  test(`integration help anchors and code · ${lang} · ${theme}`, async ({ page }) => {
    await shellFixture(page, theme, lang); await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const prefix = lang === "en" ? "doc-en-" : "doc-";
    await page.goto("/help#webhooks");
    const webhooks = page.locator(`#${prefix}webhooks`);
    await expect(webhooks.getByRole("heading")).toBeInViewport();
    await expect(webhooks.locator("code")).toContainText("timingSafeEqual");
    await expect(page.locator('nav [aria-current="location"]')).toHaveText(lang === "en" ? "Integrations and webhooks" : "Интеграции и вебхуки");
    expect(await webhooks.locator("code").evaluate(element => getComputedStyle(element).fontFamily)).toContain("monospace");
    await page.screenshot({ path: test.info().outputPath(`integrations-help-${lang}-${theme}.png`) });
    expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
    await page.getByRole("button", { name: lang === "en" ? "Backups" : "Резервные копии", exact: true }).click();
    await expect(page.locator(`#${prefix}backup`).getByRole("heading")).toBeInViewport();
    await page.evaluate(() => { window.location.hash = "#recurring"; });
    await expect(page.locator(`#${prefix}recurring`).getByRole("heading")).toBeInViewport();
    await expect(page.locator(`#${prefix}recurring`)).toContainText(lang === "en" ? "every quarter" : "ежеквартально");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: lang === "en" ? "API tokens" : "API-токены", exact: true }).click();
    await expect(page.locator(`#${prefix}tokens`).getByRole("heading")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(errors).toEqual([]);
  });
}
