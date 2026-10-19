import { expect, test, type Page } from "@playwright/test";
import { settle } from "./motion-helpers";

async function assertNoFinite(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const running = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => ({
    type: animation.constructor.name,
    name: animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : "WAAPI",
    pseudo: (animation.effect as KeyframeEffect | null)?.pseudoElement,
  })));
  expect(running).toEqual([]);
}
for (const mode of ["system", "personal"] as const) {
  test.describe(`CSS reduce regression: ${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: mode === "system" ? "reduce" : "no-preference" });
      await page.addInitScript(personal => {
        if (personal) localStorage.setItem("taskira.reduceMotion", "1"); else localStorage.removeItem("taskira.reduceMotion");
      }, mode === "personal");
    });
    test("button paint is immediate while a process spinner stays running", async ({ page }) => {
      await page.goto("/dev/ui?section=button");
      const button = page.locator('[data-section="button"] .ds-btn[data-variant="secondary"]').first();
      await button.hover();
      await expect(button).toHaveCSS("transition-duration", "0s");
      await assertNoFinite(page);
      const spinner = page.locator(".ds-spinner").first();
      await expect(spinner).toHaveCSS("animation-name", "dsSpin");
      await expect(spinner).toHaveCSS("animation-iteration-count", "infinite");
      expect(await spinner.evaluate(node => node.getAnimations().some(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations === Infinity))).toBe(true);
    });
    test("Dialog and SidePanel backdrop are immediate and focus returns", async ({ page }) => {
      await page.goto("/dev/ui?section=dialogs");
      for (const [kind, label] of [["dialog", "Открыть диалог"], ["panel", "Открыть панель"]] as const) {
        const trigger = page.getByRole("button", { name: label, exact: true });
        await trigger.click();
        const dialog = page.locator(`dialog[data-kind="${kind}"][open]`);
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(node => getComputedStyle(node, "::backdrop").animationDuration)).toBe("0s");
        await assertNoFinite(page);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await assertNoFinite(page);
      }
    });
    test("determinate width is immediate while the indeterminate loop survives", async ({ page }) => {
      await page.goto("/dev/ui?section=display");
      const bar = page.locator(".ds-progress:not([data-indeterminate]) > span");
      await expect(bar).toHaveCSS("transition-duration", "0s");
      await bar.evaluate(node => { (node as HTMLElement).style.setProperty("--p", "90%"); });
      await assertNoFinite(page);
      const loop = page.locator(".ds-progress[data-indeterminate] > span");
      await expect(loop).toHaveCSS("animation-name", "dsIndet");
      await expect(loop).toHaveCSS("animation-iteration-count", "infinite");
      expect(await loop.evaluate(node => node.getAnimations().some(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations === Infinity))).toBe(true);
      await settle(page);
    });
  });
}
