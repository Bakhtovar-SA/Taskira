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

/** scrollLeft и scrollTop не меняются четыре кадра подряд, включая плавный возврат к проекту. */
export async function settleScroll(el: Locator, timeout = 5_000): Promise<void> {
  await el.evaluate((node, ms) => new Promise<void>((resolve, reject) => {
    let left = node.scrollLeft, top = node.scrollTop, still = 0, raf = 0;
    const timer = setTimeout(() => {
      cancelAnimationFrame(raf);
      reject(new Error("Прокрутка не остановилась за " + ms + " мс"));
    }, ms);
    const tick = () => {
      if (node.scrollLeft === left && node.scrollTop === top) still++;
      else still = 0;
      left = node.scrollLeft;
      top = node.scrollTop;
      if (still >= 4) {
        clearTimeout(timer);
        resolve();
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }), timeout);
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
