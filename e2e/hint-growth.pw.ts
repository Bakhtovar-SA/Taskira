import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";

for (const reduced of [false, true]) test("tall English hint has no final height jump" + (reduced ? " with reduced motion" : " at 150% text size"), async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await boardFixture(page, "light", 4, "en");
  await page.goto('/p/CORP/board');
  await expect(page.locator('.board-card').first()).toBeVisible();
  const observation = await page.evaluateHandle(() => ({ result: new Promise<{ nearEnd: number; final: number; animated: boolean }>(resolve => {
    const observer = new MutationObserver(() => {
      const hint = document.querySelector<HTMLElement>('.board-select-hint');
      if (!hint) return;
      observer.disconnect();
      // Stress the real component at an accessible text size with wrapping English copy.
      hint.style.fontSize = '20.25px'; hint.style.width = '320px'; hint.style.maxWidth = 'calc(100vw - 32px)';
      hint.querySelector('.hint-clip > p > span')!.textContent = 'Select multiple cards to move them together. Use the selection action again to return to the board without changing the selected tasks.';
      const animation = hint.getAnimations().find(a => (a as CSSAnimation).animationName === 'hintIn');
      if (animation) { animation.pause(); animation.currentTime = Number(animation.effect!.getComputedTiming().duration) - 0.001; }
      const nearEnd = hint.getBoundingClientRect().height;
      animation?.cancel();
      resolve({ nearEnd, final: hint.getBoundingClientRect().height, animated: !!animation });
    });
    observer.observe(document.querySelector('#root')!, { childList: true, subtree: true });
  }) }));
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const result = await observation.evaluate(o => o.result); await observation.dispose();
  expect(result.final).toBeGreaterThan(48);
  expect(Math.abs(result.nearEnd - result.final)).toBeLessThan(1);
  expect(result.animated).toBe(!reduced);
  const hint = page.locator('.board-select-hint');
  if (!reduced) await page.screenshot({ path: test.info().outputPath('hint-growth-mobile.png') });
  await hint.getByRole('button').click(); await expect(hint).toHaveCount(0);
});
