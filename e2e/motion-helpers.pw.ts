import { expect, test } from "@playwright/test";
import { loadMotion, settle, settleScroll } from "./motion-helpers";

test("settle waits for finite WAAPI and RAF counters, ignoring infinite indicators", async ({ page }) => {
  await page.setContent('<div id="indicator"></div><div id="finite"></div><span class="count-up" data-counting></span>');
  await page.evaluate(() => {
    document.querySelector('#indicator')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });
    document.querySelector('#finite')!.animate([{ transform: 'translateY(10px)' }, { transform: 'none' }], { duration: 180 });
    const counter = document.querySelector('.count-up')!;
    const start = performance.now();
    const tick = () => {
      if (performance.now() - start >= 250) counter.removeAttribute('data-counting');
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await settle(page);
  expect(await page.locator('#finite').evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
  await expect(page.locator('.count-up')).not.toHaveAttribute('data-counting', '');
  expect(await page.locator('#indicator').evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(true);
});

test("settleScroll waits for both axes of a smooth scroll under fixed clock", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T07:00:00Z'));
  await page.setContent('<div id="pane"><div></div></div>');
  const pane = page.locator('#pane');
  await pane.evaluate(el => {
    Object.assign((el as HTMLElement).style, { width: '200px', height: '200px', overflow: 'auto' });
    Object.assign((el.firstElementChild as HTMLElement).style, { width: '1000px', height: '1000px' });
    el.scrollTo({ left: 600, top: 500, behavior: 'smooth' });
  });
  await settleScroll(pane, { expected: { left: 600, top: 500 } });
  expect(await pane.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }))).toEqual({ left: 600, top: 500 });
});

test("loadMotion waits for the actual module and its dependency under fixed clock", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T07:00:00Z'));
  await page.route('**/motion-helper-host', r => r.fulfill({ contentType: 'text/html', body: '<script type="module">import("/motionEngine-helper-test.js")</script>' }));
  await page.route('**/motionEngine-helper-test.js', r => r.fulfill({ contentType: 'text/javascript', body: 'import "/motion-helper-dependency.js"; document.documentElement.dataset.motionLoaded = "yes";' }));
  await page.route('**/motion-helper-dependency.js', async r => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await r.fulfill({ contentType: 'text/javascript', body: 'document.documentElement.dataset.motionDependency = "yes";' });
  });
  await loadMotion(page, () => page.goto('/motion-helper-host'));
  await expect(page.locator('html')).toHaveAttribute('data-motion-loaded', 'yes');
  await expect(page.locator('html')).toHaveAttribute('data-motion-dependency', 'yes');
});

// Fake RAF stability at the initial offset must not hide a delayed compositor scroll.
test("settleScroll waits for a delayed smooth start when its target is unknown", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-14T07:00:00Z"));
  await page.setContent('<div id="pane"><div></div></div>');
  const pane = page.locator('#pane');
  await pane.evaluate(el => {
    Object.assign((el as HTMLElement).style, { width: '200px', height: '200px', overflow: 'auto' });
    Object.assign((el.firstElementChild as HTMLElement).style, { width: '1000px', height: '1000px' });
    setTimeout(() => el.scrollTo({ left: 600, top: 500, behavior: 'smooth' }), 150);
  });
  await settleScroll(pane);
  expect(await pane.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }))).toEqual({ left: 600, top: 500 });
});

test("settleScroll returns for an already idle scroller", async ({ page }) => {
  await page.setContent('<div id="pane"></div>');
  await settleScroll(page.locator('#pane'));
  expect(await page.locator('#pane').evaluate(el => el.scrollLeft + el.scrollTop)).toBe(0);
});
