import { expect, type Locator, type Page } from "@playwright/test";

/** Конечное движение закончилось; два кадра дают layout-эффектам и очистке WAAPI завершиться.
 * Бесконечные индикаторы не ждём. CountUp работает через RAF, поэтому считаем и его атрибут. */
export async function settle(page: Page, timeout = 5_000): Promise<void> {
  const frames = () => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const pending = () => page.evaluate(() => document.getAnimations()
    .filter(a => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).length
    + document.querySelectorAll(".count-up[data-counting]").length);
  await frames();
  await expect.poll(pending, { timeout }).toBe(0);
  await frames();
  await expect.poll(pending, { timeout }).toBe(0);
}

type ScrollPosition = { left?: number; top?: number };
type ScrollSettleOptions = { timeout?: number; expected?: ScrollPosition };

/** Native scrollend marks compositor completion. Under page.clock, fake RAF callbacks can run in one
 * JS turn before the compositor starts, so stability samples use Playwright's real Node timer instead.
 * A known destination also prevents accepting an unchanged starting position. An already idle/no-op
 * scroller falls back after 500ms without movement; after movement Chromium must emit scrollend. */
export async function settleScroll(el: Locator, options: number | ScrollSettleOptions = {}): Promise<void> {
  const normalized: ScrollSettleOptions = typeof options === "number" ? { timeout: options } : options;
  const { timeout = 5_000, expected } = normalized;
  const watch = await el.evaluateHandle(node => {
    let moved = false, ended = false;
    const onScroll = () => { moved = true; ended = false; };
    const onEnd = () => { moved = true; ended = true; };
    node.addEventListener("scroll", onScroll);
    node.addEventListener("scrollend", onEnd);
    return {
      sample: () => ({ left: node.scrollLeft, top: node.scrollTop, moved, ended, nativeEnd: "onscrollend" in node }),
      dispose: () => { node.removeEventListener("scroll", onScroll); node.removeEventListener("scrollend", onEnd); },
    };
  });
  const start = Date.now();
  let last: ScrollPosition | undefined, still = 0;
  try {
    await expect.poll(async () => {
      const state = await watch.evaluate(observer => observer.sample());
      still = last?.left === state.left && last?.top === state.top ? still + 1 : 0;
      last = state;
      const atTarget = !expected || (expected.left === undefined || expected.left === state.left) &&
        (expected.top === undefined || expected.top === state.top);
      const complete = state.ended || !!expected || !state.nativeEnd || (!state.moved && Date.now() - start >= 500);
      return still >= 4 && atTarget && complete;
    }, { timeout, intervals: [50], message: "Прокрутка завершилась и обе координаты стабильны" }).toBe(true);
  } finally {
    await watch.evaluate(observer => observer.dispose()).catch(() => undefined);
    await watch.dispose();
  }
}

/** Вызвать до первого действия, загружающего motionEngine (или до goto).
 * const loaded = loadMotion(page); await openDialog(); await loaded;
 * Либо передать действие вторым аргументом. Ответ сети работает и под fixed clock, и в production.
 * import уже полученного URL завершает вычисление модуля и его зависимостей из module cache. */
export async function loadMotion(page: Page, trigger?: () => Promise<unknown>): Promise<void> {
  const response = page.waitForResponse(r => /motionEngine/.test(r.url()) && r.request().resourceType() === "script", { timeout: 10_000 });
  const [loaded] = await Promise.all([response, trigger?.()]);
  expect(loaded.ok(), "motionEngine загружен успешно").toBe(true);
  await loaded.finished();
  await page.evaluate(async url => { await import(url); }, loaded.url());
  await settle(page);
}
