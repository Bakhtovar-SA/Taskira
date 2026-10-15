import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

for (const reduced of [false, true]) test("Inbox read confirmation preserves live-row focus" + (reduced ? " with reduced motion" : " while the row exits"), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  const base = await boardFixture(page);
  const notes = base.issues.slice(0, 3).map((issue, i) => ({ id: 'n' + (i + 1), type: 'issue.comment', actor: base.users[1],
    projectId: 'p1', issueId: issue.id, payload: { key: issue.key, title: issue.title }, read: false, createdAt: '2026-10-04T06:00:00Z' }));
  let release!: () => void;
  const confirmed = new Promise<void>(resolve => { release = resolve; });
  try {
    const writes: string[][] = [];
    await page.route('**/api/notifications?*', route => route.fulfill({ json: { items: notes, nextCursor: null } }));
    await page.route('**/api/notifications/unread-count', route => route.fulfill({ json: { count: notes.filter(item => !item.read).length } }));
    await page.route('**/api/notifications/read', async route => {
      const ids = route.request().postDataJSON().ids as string[] | undefined;
      writes.push(ids ?? notes.map(item => item.id));
      await confirmed;
      for (const note of notes) if (!ids || ids.includes(note.id)) note.read = true;
      await route.fulfill({ status: 204 });
    });
    const loaded = reduced ? null : loadMotion(page);
    await page.goto('/inbox');
    await expect(page.locator('.inbox-row')).toHaveCount(3);
    if (loaded) {
      // Explicit preload action: fixed-clock tests cannot depend on requestIdleCallback.
      await page.keyboard.press('['); await loaded; await page.keyboard.press('[');
    }
    await settle(page);
    const tab = page.getByRole('tab', { name: /Непрочитанные/ }); await tab.click(); await settle(page);
    const first = page.locator('[data-enter-id="n1"] button').first(); await first.focus(); await page.keyboard.press('e');
    await expect.poll(() => writes).toEqual([['n1']]);
    await expect(page.locator('.inbox-row')).toHaveCount(3);
    await expect(first).toBeFocused(); await expect(page.locator('.list-row-ghost')).toHaveCount(0);
    const ghost = reduced ? null : await page.evaluateHandle(() => ({ result: new Promise<{ hidden: string | null; inert: boolean; liveSelector: boolean }>(resolve => {
      const root = document.querySelector('.inbox-list')!;
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('list-row-ghost')) {
          observer.disconnect(); resolve({ hidden: node.getAttribute('aria-hidden'), inert: node.hasAttribute('inert'),
            liveSelector: node.matches('.inbox-row, [data-enter-id], [data-row]') || !!node.querySelector('[data-enter-id], [data-row]') });
        }
      });
      observer.observe(root, { childList: true });
    }) }));
    release();
    await expect(page.locator('[data-enter-id="n1"]')).toHaveCount(0);
    if (ghost) {
      expect(await ghost.evaluate(observer => observer.result)).toEqual({ hidden: 'true', inert: true, liveSelector: false });
      await ghost.dispose();
    }
    await expect(page.locator('[data-enter-id="n2"] button').first()).toBeFocused();
    await settle(page);
    await expect(page.locator('.inbox-row')).toHaveCount(2); await expect(page.locator('.list-row-ghost')).toHaveCount(0);
    if (!reduced) {
      await page.screenshot({ path: test.info().outputPath('inbox-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      await page.screenshot({ path: test.info().outputPath('inbox-mobile.png') });
    }
    await page.getByRole('button', { name: /Прочитать всё/ }).click();
    await expect(page.locator('.inbox-row')).toHaveCount(0);
    await expect(tab).toBeFocused(); await settle(page);
  } finally { release(); }
});
