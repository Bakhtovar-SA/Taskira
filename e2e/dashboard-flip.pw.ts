/** NEW-05 в настоящем Chromium: в режиме правки виджет изменён клавиатурой (Shift+стрелка) — соседи доезжают пружиной (transform), сам
 *  сдвигаемый виджет и итоговая раскладка не страдают; с «уменьшить движение» — мгновенно. */
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

async function open(page: Page) {
  await mockApi(page);
  await page.route("**/api/roadmap", r => r.fulfill({ json: { projects: [{ id: "p1", milestones: [], canEdit: true }], dependencies: [] } }));
  await page.route("**/api/projects/p1/overview", r => r.fulfill({ json: { dashboard: null, canEdit: true } }));
  await page.route("**/api/dashboards/data", r => {
    const { widgets } = r.request().postDataJSON();
    const results = Object.fromEntries(widgets.map((w: { id: string; type: string }) => {
      const data = w.type === "count" ? { type: w.type, value: 2 } : w.type === "breakdown" ? { type: w.type, items: [], total: 0 } : w.type === "trend" ? { type: w.type, weeks: [] } : { type: w.type, items: [], truncated: false };
      return [w.id, data];
    }));
    return r.fulfill({ json: { results } });
  });
  await page.goto("/p/TEST/overview");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(page.locator("[data-widget]").first()).toBeVisible();
}

const boxes = (page: Page) => page.locator("[data-widget]").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset.widget!, x: Math.round(r.x), y: Math.round(r.y) }; }));
/** Виджеты, у которых прямо сейчас идёт анимация transform. */
const moving = (page: Page) => page.locator("[data-widget]").evaluateAll(els => els
  .filter(e => e.getAnimations().some(a => a.playState === "running" && (a.effect as KeyframeEffect).getKeyframes().some(k => "transform" in k)))
  .map(e => (e as HTMLElement).dataset.widget!));

test("соседи плавно доезжают, когда виджет вырос с клавиатуры; сам он не анимируется; раскладка итоговая", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const first = page.locator("[data-widget]").first();
  const id = (await first.getAttribute("data-widget"))!;
  const before = await boxes(page);
  await first.focus();
  await page.keyboard.press("Shift+ArrowDown"); // виджет стал выше — всё, что ниже, съезжает
  // Сразу после коммита: соседи ниже едут, сам изменяемый виджет — нет.
  await expect.poll(async () => (await moving(page)).length, { timeout: 2000 }).toBeGreaterThan(0);
  expect(await moving(page)).not.toContain(id);
  // Анимации заканчиваются, раскладка — итоговая и отличается от исходной.
  await expect.poll(async () => (await moving(page)).length, { timeout: 3000 }).toBe(0);
  // Остаточный inline-transform (последний кадр motion/mini) нейтральный; снятие целиком — FIX-01 в PR #187.
  const left = await page.locator("[data-widget]").evaluateAll(els => els.map(e => (e as HTMLElement).style.transform).filter(Boolean));
  expect(left.every(t => /^(none|translate\(0px, 0px\))$/.test(t))).toBe(true);
  const after = await boxes(page);
  expect(after).not.toEqual(before);
  await page.screenshot({ path: test.info().outputPath("dashboard-flip-after.png") });
});

test("движение уменьшено: соседи встают на место сразу, анимаций transform нет", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const first = page.locator("[data-widget]").first();
  await first.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(150);
  expect(new Set((await boxes(page)).map(b => b.y)).size).toBeGreaterThan(0);
  expect(await moving(page)).toEqual([]);
});
