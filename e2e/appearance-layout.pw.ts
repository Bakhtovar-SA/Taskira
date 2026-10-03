import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const theme of ["light", "dark"]) for (const width of [1654, 390]) {
  test(`appearance controls preserve the work area (${theme}, ${width})`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => {
      localStorage.setItem("taskira.theme", theme);
      localStorage.setItem("taskira.density", "compact");
      localStorage.setItem("taskira.bg", "lines");
    }, theme);
    await page.goto("/settings/appearance");
    const main = page.locator("main");
    await expect(page.getByRole("heading", { name: "Прозрачность", exact: true })).toBeVisible();
    for (const label of ["Включена", "Выключена", "Как в системе"]) {
      const radio = page.getByRole("radio", { name: label, exact: true });
      await radio.locator("..").click();
      await expect(radio).toBeChecked();
      await page.getByRole("heading", { name: "Плотность", exact: true }).scrollIntoViewIfNeeded();
      // Focusing a visually hidden native input must scroll its own settings pane,
      // never shift the application sheet up and leave a blank strip underneath.
      await radio.focus();
      await expect.poll(async () => (await main.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      expect((await main.boundingBox())!.y + (await main.boundingBox())!.height).toBeGreaterThan(884);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
    }
    await page.getByRole("radio", { name: /^Плотная/ }).locator("..").click();
    await page.screenshot({ path: test.info().outputPath("appearance-bottom.png") });
    expect((await main.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  });
}
