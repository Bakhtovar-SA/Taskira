import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

for (const reduced of [false, true]) test("sprint/backlog moves wait for API and retain local focus" + (reduced ? " under reduce" : " with local row motion"), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const base = await boardFixture(page);
  const issues = base.issues.slice(0, 3).map((issue, index) => ({ ...issue, sprintId: index < 2 ? 'sp1' : null }));
  const sprint = { id: 'sp1', name: 'Sprint 1', goal: '', status: 'future', startDate: null, endDate: null };
  await page.route('**/api/projects/p1', route => route.fulfill({ json: { project: { ...base.project, sprintsEnabled: true }, users: base.users,
    members: base.users.map(user => ({ userId: user.id, role: 'admin' })), workflow: { statuses: base.statuses, transitions: [] },
    issueTemplates: [], customFields: [], sprints: [sprint] } }));
  await page.route('**/api/projects/p1/issues?*', route => route.fulfill({ json: { items: issues, hasMore: false, nextCursor: null } }));
  await page.route('**/api/projects/p1/issues', route => route.fulfill({ json: { items: issues, hasMore: false, nextCursor: null } }));
  const requests: { id: string; sprintId: string | null }[] = [];
  let release: (() => void) | undefined, hold = true;
  await page.route('**/api/projects/p1/issues/*/sprint', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const { sprintId } = route.request().postDataJSON() as { sprintId: string | null };
    requests.push({ id, sprintId });
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    const issue = issues.find(item => item.id === id)!; issue.sprintId = sprintId;
    await route.fulfill({ json: issue });
  });
  try {
    const loaded = reduced ? null : loadMotion(page);
    await page.goto('/p/CORP/sprints');
    const backlog = page.getByRole('group', { name: 'Список задач', exact: true });
    const active = page.getByRole('group', { name: 'Sprint 1', exact: true });
    await expect(active.locator('[data-issue-id]')).toHaveCount(2); await expect(backlog.locator('[data-issue-id]')).toHaveCount(1);
    if (loaded) { await page.keyboard.press('['); await loaded; await page.keyboard.press('['); }
    await settle(page);
    expect(await page.locator('.sprint-issue-list').evaluateAll(lists => {
      const scroller = (node: Element) => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent; };
      return scroller(lists[0]) !== scroller(lists[1]);
    })).toBe(true);
    const remove = active.locator('[data-issue-id="i1"]').getByRole('button', { name: 'Убрать из спринта' });
    await remove.focus(); await remove.press('Enter');
    await expect.poll(() => requests).toEqual([{ id: 'i1', sprintId: null }]);
    await expect(remove).toBeFocused(); await expect(active.locator('[data-issue-id]')).toHaveCount(2);
    release?.();
    await expect(backlog.locator('[data-issue-id="i1"]')).toHaveCount(1);
    await expect(active.locator('[data-issue-id="i2"] button').first()).toBeFocused(); await settle(page);
    await expect(page.locator('.flip-flight')).toHaveCount(0);
    if (!reduced) {
      await page.screenshot({ path: test.info().outputPath('sprints-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      await page.screenshot({ path: test.info().outputPath('sprints-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
    }
    await backlog.locator('[data-issue-id="i1"] button').first().focus();
    const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('text/plain', 'i1'); return data; });
    await active.locator('..').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
    await expect.poll(() => requests.length).toBe(2);
    await expect(backlog.locator('[data-issue-id="i1"]')).toHaveCount(1);
    release?.();
    await expect(active.locator('[data-issue-id]')).toHaveCount(2);
    await expect(backlog.locator('[data-issue-id="i3"] button').first()).toBeFocused(); await settle(page);
    hold = false;
    await active.locator('[data-issue-id="i1"]').getByRole('button', { name: 'Убрать из спринта' }).click();
    await expect(active.locator('[data-issue-id]')).toHaveCount(1);
    await active.locator('[data-issue-id="i2"]').getByRole('button', { name: 'Убрать из спринта' }).click();
    await expect(active.locator('[data-issue-id]')).toHaveCount(0); await expect(active).toBeFocused(); await settle(page);
    await expect(page.locator('.list-row-ghost')).toHaveCount(0);
    await page.goto('/home'); await expect(page.locator('.sprint-issue-list, .list-row-ghost')).toHaveCount(0);
  } finally { release?.(); }
});
