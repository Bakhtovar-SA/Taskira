import { expect, test } from "@playwright/test";
import { homeFixture } from "./home-fixture";
import { settle } from "./motion-helpers";

for (const reduced of [false, true]) test("Home CountUp refresh keeps final accessible text" + (reduced ? " with reduced motion" : " while visible numbers grow"), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  const fixture = await homeFixture(page);
  await page.goto('/');
  const counter = page.locator('.home-task-group[data-urgency=overdue] .count-up');
  await expect(counter).toHaveText('1');
  await settle(page);
  for (let i = 0; i < 3; i++) fixture.items.push({ ...fixture.items[0], issueId: 'extra' + i, key: 'CORP-' + (100 + i) });
  const watching = counter.evaluate(el => new Promise<{ texts: string[]; shown: number[]; counting: boolean }>(resolve => {
    const texts = new Set<string>(), shown = new Set<number>();
    let counting = false;
    const start = performance.now();
    const tick = () => {
      if (el.hasAttribute('data-counting')) {
        counting = true;
        texts.add(el.textContent ?? '');
        shown.add(Number(el.getAttribute('data-shown')));
      }
      if (performance.now() - start >= 700) resolve({ texts: [...texts], shown: [...shown], counting });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  // Re-selecting Home refreshes the real assigned-issues endpoint without remounting the counter.
  await page.locator('aside').getByRole('button', { name: 'Главная', exact: true }).click();
  const frames = await watching;
  if (reduced) expect(frames.counting).toBe(false);
  else {
    expect(frames.counting).toBe(true);
    expect(frames.texts).toEqual(['4']);
    expect(frames.shown.length).toBeGreaterThan(1);
    expect(frames.shown).toEqual([...frames.shown].sort((a, b) => a - b));
    expect(Math.max(...frames.shown)).toBeLessThanOrEqual(4);
  }
  await settle(page);
  await expect(counter).toHaveText('4');
  await expect(counter).not.toHaveAttribute('data-counting', '');
});
