import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

for (const width of [1460, 390]) for (const reduced of [false, true]) test(`filter summary pops once per appearance (${width}, reduce=${reduced})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await boardFixture(page, 'dark');
  await page.addInitScript(() => {
    const state = window as Window & { filterPops: number }; state.filterPops = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.matches('.workspace-count button') && JSON.stringify(args[0]).includes('scale(0.55)')) state.filterPops++;
      return animate.apply(this, args);
    };
  });
  const loaded = reduced ? null : loadMotion(page);
  await page.goto('/p/CORP/board');
  await expect(page.getByRole('button', { name: 'Фильтр: Анна Смирнова' })).toBeVisible();
  // Board owns idle preloading; toggling the mobile drawer would change the tested focus scope.
  if (loaded) await loaded;
  await settle(page);
  const columns = page.locator('.board-columns'), top = (await columns.boundingBox())!.y;
  const mine = page.getByRole('button', { name: 'Мои задачи', exact: true });
  await mine.click();
  const chip = page.getByRole('button', { name: /^Фильтры:/ });
  await expect(chip).toBeVisible(); await expect(chip).not.toContainText('…'); await settle(page);
  const pops = () => page.evaluate(() => (window as Window & { filterPops: number }).filterPops);
  expect(await pops()).toBe(reduced ? 0 : 1);
  expect(Math.abs((await columns.boundingBox())!.y - top)).toBeLessThan(1);
  await page.getByRole('textbox', { name: 'Фильтр задач' }).fill('план');
  await expect(chip).toContainText('1'); await expect(chip).not.toContainText('…'); await settle(page);
  await chip.click(); await expect(page.getByRole('dialog', { name: 'Фильтры', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(chip).toBeFocused();
  await page.getByRole('button', { name: 'Выделить', exact: true }).click(); await settle(page);
  expect(await pops()).toBe(reduced ? 0 : 1);
  if (!reduced) await page.screenshot({ path: test.info().outputPath(`filter-pop-${width}.png`) });
  await chip.click(); await page.getByRole('dialog', { name: 'Фильтры', exact: true }).getByRole('button', { name: 'Сбросить' }).click();
  await expect(chip).toHaveCount(0);
  await mine.click(); await expect(chip).toBeVisible(); await expect(chip).not.toContainText('…'); await settle(page);
  expect(await pops()).toBe(reduced ? 0 : 2);
});
