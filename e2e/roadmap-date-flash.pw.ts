import { expect, test, type Page } from "@playwright/test";
import { roadmapFixture } from "./roadmap-fixture";
import { settle } from "./motion-helpers";

async function fixture(page: Page, reduced = false, count = 5) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const rm = await roadmapFixture(page, 'dark', 'ru', count);
  await page.addInitScript(() => {
    const state = window as Window & { roadmapFlashes: string[] }; state.roadmapFlashes = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.matches('.roadmap-bar') && JSON.stringify(args[0]).includes('backgroundColor')) state.roadmapFlashes.push(this.closest('[data-project-id]')!.getAttribute('data-project-id')!);
      return animate.apply(this, args);
    };
  });
  const writes: unknown[] = []; let release: (() => void) | undefined, fail = false;
  await page.route('**/api/projects/*/roadmap', async route => {
    expect(route.request().method()).toBe('PATCH');
    const patch = route.request().postDataJSON(); writes.push(patch);
    if (!fail) await new Promise<void>(resolve => { release = resolve; });
    if (fail) return route.fulfill({ status: 409, json: { error: { code: 'TEST_FAILURE', message: 'Date save rejected' } } });
    const id = new URL(route.request().url()).pathname.split('/')[3];
    Object.assign(rm.projects.find(project => project.id === id)!, patch);
    await route.fulfill({ status: 204 });
  });
  await page.goto('/roadmap'); await expect(page.locator('.roadmap-timeline')).toBeVisible(); await settle(page);
  return { rm, writes, release: () => release?.(), fail: () => { fail = true; } };
}
async function edit(page: Page) {
  const row = page.locator('.roadmap-project-row[data-project-id="p1"]'); await row.hover();
  await row.getByRole('button', { name: 'Меню проекта «Корпоративная платформа»', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Сроки и вехи проекта «Корпоративная платформа»', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть роадмап', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Цель:/ })).toBeVisible();
}
async function date(page: Page, field: 'Начало' | 'Цель', value: string) {
  await page.getByRole('button', { name: new RegExp('^' + field + ':') }).click();
  const calendar = page.getByRole('dialog', { name: field, exact: true });
  await calendar.getByRole('textbox', { name: field, exact: true }).fill(value);
  await calendar.getByRole('textbox', { name: field, exact: true }).press('Enter');
  await expect(calendar).not.toBeVisible();
}
const flashes = (page: Page) => page.evaluate(() => (window as Window & { roadmapFlashes: string[] }).roadmapFlashes);
async function open(page: Page) {
  await page.getByRole('button', { name: 'Открыть роадмап', exact: true }).click();
  await expect(page.locator('.roadmap-timeline')).toBeVisible(); await settle(page);
}

for (const reduced of [false, true]) test('roadmap flashes only its acknowledged edited dates' + (reduced ? ' under reduce' : ''), async ({ page }) => {
  const f = await fixture(page, reduced);
  try {
    expect(await flashes(page)).toEqual([]);
    await edit(page); await date(page, 'Цель', '20.11.2026');
    await expect.poll(() => f.writes).toEqual([{ targetDate: '2026-11-20' }]);
    await expect(page.getByRole('button', { name: /^Цель:/ })).toHaveAccessibleName(/15 ноября/);
    expect(await flashes(page)).toEqual([]); f.release();
    await expect(page.getByRole('button', { name: /^Цель:/ })).toHaveAccessibleName(/20 ноября/);
    await open(page); expect(await flashes(page)).toEqual(reduced ? [] : ['p1']);
    if(!reduced)await page.screenshot({path:test.info().outputPath("roadmap-dates-confirmed.png")});
    await page.locator('.roadmap-tools .ds-tabs [data-tab]').first().click(); await settle(page);
    await page.locator('.roadmap-timeline').evaluate(node => { node.scrollTop = node.scrollHeight; }); await settle(page);
    await page.locator('.roadmap-timeline').evaluate(node => { node.scrollTop = 0; }); await settle(page);
    expect(await flashes(page)).toEqual(reduced ? [] : ['p1']);
    await edit(page); await date(page, 'Цель', '20.11.2026'); await settle(page);
    expect(f.writes).toHaveLength(1); await open(page); expect(await flashes(page)).toEqual(reduced ? [] : ['p1']);
    await edit(page); f.fail(); await date(page, 'Цель', '21.11.2026');
    await expect.poll(() => f.writes.length).toBe(2); await settle(page);
    await expect(page.getByRole('button', { name: /^Цель:/ })).toHaveAccessibleName(/20 ноября/);
    await open(page); expect(await flashes(page)).toEqual(reduced ? [] : ['p1']);
  } finally { f.release(); }
});

test('offscreen confirmed row is discarded rather than flashing on later virtualized entry', async ({ page }) => {
  const f = await fixture(page, false, 70);
  try {
    await edit(page); await date(page, 'Начало', '02.09.2026');
    await expect.poll(() => f.writes.length).toBe(1); f.release();
    await expect(page.getByRole('button', { name: /^Начало:/ })).toHaveAccessibleName(/2 сентября/);
    await open(page); await expect(page.locator('.roadmap-timeline-row[data-project-id="p1"]')).toHaveCount(0);
    expect(await flashes(page)).toEqual([]);
    await page.locator('.roadmap-timeline').evaluate(node => { node.scrollTop = node.scrollHeight; }); await settle(page);
    await expect(page.locator('.roadmap-timeline-row[data-project-id="p1"] .roadmap-bar')).toBeVisible();
    expect(await flashes(page)).toEqual([]);
  } finally { f.release(); }
});
