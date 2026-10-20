import { expect, test, type Page } from "@playwright/test";
import { calendarApi } from "./calendar-fixture";

async function setup(page: Page, reduced = false) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => { localStorage.setItem('taskira.calendar.mode', 'month'); localStorage.setItem('taskira.lang', 'ru'); });
  const api = await calendarApi(page);
  await page.goto('/p/TEST/calendar'); await expect(page.getByRole('grid')).toBeVisible();
  return api;
}

for (const reduced of [false, true]) test(`calendar slide spike focus remains correct across periods (reduce=${reduced})`, async ({ page }) => {
  await setup(page, reduced);
  const grid = await page.locator('.calendar-grid').evaluateHandle(node => node);
  const day = (date: string) => page.locator(`[data-day="${date}"]`);
  await day('2026-10-01').focus(); await page.keyboard.press('PageDown'); await expect(day('2026-11-01')).toBeFocused();
  await page.keyboard.press('PageUp'); await expect(day('2026-10-01')).toBeFocused();
  await day('2026-11-08').focus(); await page.keyboard.press('ArrowRight'); await expect(day('2026-11-09')).toBeFocused();
  await page.keyboard.press('t'); await expect(day('2026-10-01')).toBeFocused();
  await page.getByRole('button', { name: 'Неделя', exact: true }).click();
  await day('2026-10-01').focus(); await page.keyboard.press('PageDown'); await expect(day('2026-10-08')).toBeFocused();
  await page.keyboard.press('PageUp'); await expect(day('2026-10-01')).toBeFocused();
  expect(await grid.evaluate(node => node === document.querySelector('.calendar-grid'))).toBe(true);
  await grid.dispose();
});

test('calendar slide spike focus ring shares its stable moving ancestor', async ({ page }) => {
  await setup(page);
  await page.locator('[data-day="2026-10-01"]').focus(); await page.keyboard.press('PageDown');
  const cell = page.locator('[data-day="2026-11-01"]'); await expect(cell).toBeFocused();
  const metrics = await cell.evaluate(node => {
    const grid = node.closest('.calendar-grid')!;
    const animation = grid.getAnimations().find(item => (item.effect as KeyframeEffect | null)?.getKeyframes().some(frame => 'transform' in frame));
    if (!animation) return null;
    // Pausing is only for this visual inspection. The separate DnD test never pauses or extends 300ms.
    animation.pause(); animation.currentTime = 75;
    const a = node.getBoundingClientRect(), parent = grid.getBoundingClientRect();
    const shift = new DOMMatrix(getComputedStyle(grid).transform).m41;
    return { shift, cellX: a.x, gridX: parent.x, active: document.activeElement === node };
  });
  expect(metrics).not.toBeNull(); expect(metrics!.active).toBe(true); expect(Math.abs(metrics!.shift)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('calendar-focus-ring-slide.png') });
  const final = await cell.evaluate(node => { const grid = node.closest('.calendar-grid')!; for (const animation of grid.getAnimations()) animation.cancel(); return { cellX: node.getBoundingClientRect().x, gridX: grid.getBoundingClientRect().x, active: document.activeElement === node }; });
  expect(final.active).toBe(true);
  expect(metrics!.cellX - final.cellX).toBeCloseTo(metrics!.gridX - final.gridX, 2);
});

for (const reduced of [false, true]) test(`calendar slide spike uses trusted pointer DnD in the real 300ms window (reduce=${reduced})`, async ({ page }) => {
  const api = await setup(page, reduced);
  await page.getByRole('button', { name: 'Без срока', exact: true }).click();
  const source = page.locator('aside [data-issue-id="i9"]'); await expect(source).toBeVisible();
  const origin = (await source.boundingBox())!;
  await page.evaluate(() => {
    const metrics = window as Window & { nativeCalendarDrag?: { startTrusted: boolean }; nativeCalendarDrop?: unknown };
    document.addEventListener('dragstart', event => { metrics.nativeCalendarDrag = { startTrusted: event.isTrusted }; }, true);
    document.addEventListener('drop', event => {
      const grid = document.querySelector('.calendar-grid')!;
      const animation = grid.getAnimations().find(item => (item.effect as KeyframeEffect | null)?.getKeyframes().some(frame => 'transform' in frame));
      metrics.nativeCalendarDrop = {
        trusted: event.isTrusted, mime: event.dataTransfer?.types.includes('application/x-taskira-issue'),
        issue: event.dataTransfer?.getData('application/x-taskira-issue'),
        day: (event.target as Element).closest<HTMLElement>('[data-day]')?.dataset.day,
        hitDay: document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-day]')?.dataset.day,
        active: animation?.playState === 'running', time: animation?.currentTime ?? null,
        duration: animation?.effect?.getComputedTiming().duration ?? null,
      };
    }, true);
  });
  await page.getByRole('button', { name: 'Следующий период', exact: true }).click();
  const target = (await page.locator('[data-day="2026-11-03"]').boundingBox())!;
  // Browser pointer input initiates the page's native draggable handler. No DOM drag event or fabricated DataTransfer.
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + origin.width / 2 - 8, origin.y + origin.height / 2, { steps: 2 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2 + 1, target.y + target.height / 2);
  await page.mouse.up();
  const metrics = await page.evaluate(() => {
    const state = window as Window & { nativeCalendarDrag?: { startTrusted: boolean }; nativeCalendarDrop?: { trusted: boolean; mime: boolean; issue: string; day: string; hitDay: string; active: boolean; time: number | null; duration: number | null } };
    return { start: state.nativeCalendarDrag, drop: state.nativeCalendarDrop };
  });
  expect(metrics.start?.startTrusted).toBe(true);
  expect(metrics.drop).toMatchObject({ trusted: true, mime: true, issue: 'i9', day: '2026-11-03', hitDay: '2026-11-03', active: !reduced });
  if (!reduced) { expect(metrics.drop!.duration).toBe(300); expect(metrics.drop!.time).toBeGreaterThanOrEqual(0); expect(metrics.drop!.time).toBeLessThan(300); }
  await expect.poll(() => api.writes).toEqual([{ dueDate: '2026-11-03' }]);
  await expect(page.locator('[data-day="2026-11-03"] [data-issue-id="i9"]')).toBeVisible();
});
