import { fixture } from './fixture.mjs';

export const SCENARIOS = [
  ...[200, 500].map(n => ({ id: 'S1/move-' + n, kind: 'move', count: n })),
  ...[40, 41].map(n => ({ id: 'S2/bulk-' + n, kind: 'bulk', count: n, allOpen: true })),
  ...['collapse', 'expand'].map(direction => ({ id: 'S3/' + direction, kind: 'sidebar', count: 200, direction })),
  ...[50, 200, 201].map(n => ({ id: 'S4/delete-' + n, kind: 'delete', count: n, allOpen: true })),
  ...['open', 'close'].map(direction => ({ id: 'S5/' + direction, kind: 'panel', count: 40, direction })),
  { id: 'S6/move-12', kind: 'dashboard', widgets: 12 },
  { id: 'S6/move-40', kind: 'dashboard', widgets: 40 },
  { id: 'S6/move-max', kind: 'dashboard', supportedMaximum: true, supplemental: true },
  { id: 'S7/views-1-2-3-4-5', kind: 'views', count: 200, sprints: true },
  { id: 'S8/poll-6', kind: 'poll', widgets: 6 },
  { id: 'S8/manual-refresh-6', kind: 'refresh', widgets: 6, supplemental: true },
  { id: 'S9/card-spring-scroll', kind: 'flightScroll', count: 200 },
  { id: 'S9/pending-move-sidebar-scroll', kind: 'scroll', count: 200, supplemental: true },
];
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export function unavailable(spec, facts) {
  if (spec.kind === 'dashboard' && spec.widgets > facts.maxWidgets) return 'Requested ' + spec.widgets + ' widgets exceed the actual contract limit ' + facts.maxWidgets + '; supported maximum is a separate supplemental scenario';
  if (spec.kind === 'poll') return facts.hasPolling ? 'Source now contains an interval; automatic polling scenario needs a product-specific adapter before measurement' : 'No automatic 30s polling exists: useDashboardData refreshes manually or on focus/visibility after STALE_MS=60000; see source hash and excerpt in sourceFacts';
  return null;
}
async function loadAll(page, selector, expected) {
  await page.locator(selector).first().waitFor();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await page.locator(selector).count() === expected) return;
    const more = page.getByRole('button', { name: /Показать ещё/ });
    if (await more.count()) await more.first().click();
    else {
      // Sentinel pagination may still be in flight. Never inflate the API's page size.
      await page.locator(selector).last().scrollIntoViewIfNeeded();
      await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected || [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Показать ещё')), { selector, expected }, { timeout: 20_000 });
    }
  }
  requireThat(await page.locator(selector).count() === expected, 'Real pagination did not render the requested ' + expected + ' nodes');
}
async function top(page) {
  // Setup only. Real scenario scrolling uses mouse.wheel, never a synthetic scroll event.
  await page.locator('.board-col-body, .board-scroll, .list-view').evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 0; node.scrollLeft = 0; }));
  await page.locator('.board-card-open, .list-row').first().scrollIntoViewIfNeeded();
}
const moveMenu = async (page, id = 'i1') => {
  await page.locator('[data-issue-id="' + id + '"] .board-card-open').focus();
  await page.keyboard.press('m');
  await page.getByRole('menuitem', { name: 'В работе', exact: true }).waitFor();
};
async function boardHealth(page) {
  return page.evaluate(() => ({
    hidden: [...document.querySelectorAll('.board-card[data-issue-id]')].filter(el => getComputedStyle(el).visibility === 'hidden').map(el => el.getAttribute('data-issue-id')),
    flights: document.querySelectorAll('.flip-flight').length,
  }));
}
export async function prepare(page, spec, { boardFixture, loadMotion, settle, settleScroll, maxWidgets }) {
  const state = await fixture(page, boardFixture, { ...spec, widgets: spec.supportedMaximum ? maxWidgets : spec.widgets ?? 12, maxWidgets });
  page.__motionFixture = state; // Preserve failed-setup API diagnostics for the runner.
  const dashboard = ['dashboard', 'refresh'].includes(spec.kind);
  const list = spec.kind === 'delete';
  const path = dashboard ? '/p/CORP/overview' : list ? '/p/CORP/list?group=none' : '/p/CORP/board';
  // The installed production motion chunk is loaded before sampling; view chunks remain cold in S7.
  const loaded = loadMotion(page);
  loaded.catch(() => {}); // Goto/setup errors still release the pending response waiter when context closes.
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.locator(dashboard ? '[data-widget]' : list ? '.list-row' : '.board-card').first().waitFor();
  await page.keyboard.press('['); await loaded; await settle(page, 20_000);
  await page.keyboard.press('['); await settle(page, 20_000);
  if (!dashboard) {
    await loadAll(page, list ? '.list-row[data-issue-id]' : '.board-card[data-issue-id]', spec.count);
    await top(page); await settle(page, 20_000);
  } else {
    await page.waitForFunction(n => document.querySelectorAll('[data-widget]').length === n && document.querySelectorAll('.count-up').length === n, state.widgets.length);
    await settle(page, 20_000);
  }
  const info = { requestedIssues: spec.count ?? null, renderedIssues: await page.locator('.board-card[data-issue-id], .list-row[data-issue-id]').count(), requestedWidgets: state.widgets.length,
    supplemental: !!spec.supplemental, warmup: 'Motion engine loaded by real sidebar collapse/expand; initial finite animations settled; view chunks cold except current route' };
  let action, validate = async () => {}, dispose = async () => {};
  if (spec.kind === 'move') {
    await moveMenu(page);
    action = () => page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
    validate = async () => { requireThat(state.issues[0].statusId === 's2', 'Move was not applied'); await settle(page, 20_000); const health = await boardHealth(page); requireThat(!health.hidden.length && !health.flights, 'Move left hidden cards or flight clones'); return health; };
  } else if (spec.kind === 'bulk') {
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    for (let i = 1; i <= spec.count; i++) await page.locator('[data-issue-id="i' + i + '"] .board-card-open').click();
    await top(page);
    const dock = page.locator('.list-selection-dock .list-bulk-bar');
    requireThat(await dock.getAttribute('aria-label') === 'Выбрано: ' + spec.count, 'Selection count did not match the cap boundary');
    await dock.getByRole('button', { name: 'Действия', exact: true }).click();
    await page.locator('.bulk-action-menu').getByRole('button', { name: 'Статус', exact: true }).click();
    await settle(page, 20_000);
    action = () => page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
    validate = async () => { requireThat(state.issues.every(i => i.statusId === 's2'), 'Bulk status did not change the whole set'); await settle(page, 20_000); const health = await boardHealth(page); requireThat(!health.hidden.length && !health.flights, 'Bulk left hidden cards or clones'); return health; };
  } else if (spec.kind === 'sidebar') {
    if (spec.direction === 'expand') { await page.keyboard.press('['); await settle(page, 20_000); }
    const before = await page.locator('aside').first().boundingBox();
    action = () => page.keyboard.press('[');
    validate = async () => { await settle(page, 20_000); const after = await page.locator('aside').first().boundingBox(); requireThat(spec.direction === 'expand' ? after.width > before.width : after.width < before.width, 'Sidebar width did not change in requested direction'); return { before, after }; };
  } else if (spec.kind === 'delete') {
    const row = page.locator('.list-row[data-issue-id="i1"]'); await row.hover();
    await row.getByRole('button', { name: 'Действия', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click();
    const button = page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }); await button.waitFor(); await settle(page, 20_000);
    action = () => button.click();
    validate = async () => { await page.locator('.list-row[data-issue-id="i1"]').waitFor({ state: 'detached' }); requireThat(state.issues.length === spec.count - 1, 'DELETE was not applied'); return { remaining: await page.locator('.list-row').count() }; };
  } else if (spec.kind === 'panel') {
    const opener = page.locator('[data-issue-id="i1"] .board-card-open');
    if (spec.direction === 'close') { await opener.click(); await page.getByRole('dialog').waitFor(); await settle(page, 20_000); }
    action = spec.direction === 'open' ? () => opener.click() : () => page.keyboard.press('Escape');
    validate = async () => { await page.getByRole('dialog').waitFor({ state: spec.direction === 'open' ? 'visible' : 'detached' }); return { open: spec.direction === 'open' }; };
  } else if (spec.kind === 'dashboard') {
    await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    const first = page.locator('[data-widget]').first(); await first.focus(); await settle(page, 20_000);
    const boxes = () => page.locator('[data-widget]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { id: node.getAttribute('data-widget'), x: r.x, y: r.y }; }));
    const before = await boxes();
    action = () => page.keyboard.press('ArrowDown'); // Move, not Shift+Arrow resize.
    validate = async () => { await settle(page, 20_000); const after = await boxes(); requireThat(JSON.stringify(after) !== JSON.stringify(before), 'Keyboard move did not change widget geometry'); return { widgets: after.length, before, after }; };
  } else if (spec.kind === 'views') {
    action = async () => { for (const key of ['1', '2', '3', '4', '5']) await page.keyboard.press(key); };
    validate = async () => { await page.waitForURL('**/p/CORP/calendar*'); requireThat(state.project.sprintsEnabled, 'Key 4 is unavailable without sprints'); return { finalPath: new URL(page.url()).pathname, sequence: ['board', 'list', 'timeline', 'sprints', 'calendar'] }; };
  } else if (spec.kind === 'refresh') {
    requireThat(await page.locator('.count-up').count() === 6, 'Six existing CountBody nodes did not render');
    info.countNodes = await page.locator('.count-up').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, visible: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 && getComputedStyle(node).visibility === 'visible' }; }));
    requireThat(info.countNodes.every(n => n.visible), 'Six counter nodes do not fit visibly in the actual profile');
    const button = page.getByRole('button', { name: 'Обновить', exact: true });
    state.value = 120;
    action = () => button.click();
    validate = async () => { await page.waitForFunction(() => [...document.querySelectorAll('.count-up')].every(node => node.textContent?.replace(/\s/g, '') === '120')); return { finalValues: await page.locator('.count-up').allTextContents(), trigger: 'Manual refresh; not automatic polling' }; };
  } else if (spec.kind === 'flightScroll') {
    await moveMenu(page);
    const lane = page.locator('[data-issue-id="i2"]').locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " board-col-body ")][1]');
    const rect = await lane.boundingBox();
    const startScroll = await lane.evaluate(el => el.scrollTop);
    info.variant = 'M move, trusted native wheel during an actual .flip-flight child animation, then next M commit';
    await page.evaluate(() => {
      window.__motionScenario = { wheel: null };
      document.addEventListener('wheel', event => {
        const flights = [...document.querySelectorAll('.flip-flight')];
        window.__motionScenario.wheel = { trusted: event.isTrusted, at: performance.now(),
          running: flights.flatMap(node => node.getAnimations({ subtree: true })).filter(a => a.playState === 'running').length,
          flights: flights.map(node => ({ text: node.textContent, box: node.getBoundingClientRect().toJSON() })),
        };
      }, { once: true, capture: true, passive: true });
    });
    action = async () => {
      await page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.flip-flight')].some(node => node.getAnimations({ subtree: true }).some(a => a.playState === 'running')), null, { timeout: 3000 });
      await page.mouse.move(rect.x + rect.width / 2, rect.y + Math.min(140, rect.height / 2));
      await settleScroll(lane, { trigger: () => page.mouse.wheel(0, 260), timeout: 20_000 });
      const overlap = await page.evaluate(() => window.__motionScenario.wheel);
      requireThat(overlap?.trusted && overlap.running > 0, 'No real card spring overlapped the trusted wheel event');
      requireThat(await lane.evaluate(el => el.scrollTop) > startScroll, 'Target column did not scroll');
    };
    validate = async () => {
      await settle(page, 20_000);
      const first = await boardHealth(page);
      requireThat(!first.hidden.length && !first.flights, 'Scroll left hidden cards or flight clones');
      const oldCard = page.locator('[data-issue-id="i1"]');
      const landed = await oldCard.evaluate(el => ({ visibility: getComputedStyle(el).visibility, transform: el.style.transform, box: el.getBoundingClientRect().toJSON() }));
      requireThat(landed.visibility === 'visible' && !landed.transform, 'Moved card retained a hidden/transformed landing state');
      await moveMenu(page, 'i3');
      // Watch only the following commit, outside the sampled 900ms window. No stale first-card flight may replay.
      await page.evaluate(() => {
        window.__motionScenario.replayed = [];
        window.__motionScenario.observer = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
            const flights = node.matches('.flip-flight') ? [node] : [...node.querySelectorAll('.flip-flight')];
            for (const flight of flights) if (flight.querySelector('[aria-label^="CORP-1:"]')) window.__motionScenario.replayed.push(performance.now());
          }
        });
        window.__motionScenario.observer.observe(document.body, { childList: true, subtree: true });
      });
      await page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
      await settle(page, 20_000);
      const replayed = await page.evaluate(() => { window.__motionScenario.observer.disconnect(); return window.__motionScenario.replayed; });
      requireThat(!replayed.length, 'The previous card flight replayed on the next commit');
      const final = await boardHealth(page); requireThat(!final.hidden.length && !final.flights, 'Next commit left hidden cards or clones');
      return { first, final, landed, overlap: await page.evaluate(() => window.__motionScenario.wheel), replayed,
        jumpReview: 'Wheel-time clone and settled real-card rects retained. Transient pixel continuity still needs the B02 manual review; final neutral transform/visibility and no stale replay are asserted.' };
    };
    dispose = async () => { await page.evaluate(() => window.__motionScenario?.observer?.disconnect()); };
  } else if (spec.kind === 'scroll') {
    // A live server-pending M snapshot exists while a real sidebar spring runs. Scroll invalidates that snapshot.
    await moveMenu(page); state.delayTransition = true;
    const lane = page.locator('[data-issue-id="i5"]').locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " board-col-body ")][1]');
    const neighbor = page.locator('[data-issue-id="i5"]');
    let before, afterScroll, afterReply;
    info.variant = 'M pending response + sidebar spring + native board wheel; validates snapshot invalidation, not cancellation of an already committed flight';
    action = async () => {
      await page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
      const deadline = Date.now() + 20_000;
      while (!state.releaseTransition && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      requireThat(!!state.releaseTransition, 'Transition request was not captured');
      await page.keyboard.press('[');
      const running = await page.locator('aside').evaluate(el => el.getAnimations().some(a => a.playState === 'running'));
      requireThat(running, 'No sidebar spring overlapped scroll; this run cannot measure S9');
      before = await neighbor.boundingBox();
      await lane.hover();
      await settleScroll(lane, { trigger: () => page.mouse.wheel(0, 260), timeout: 20_000 });
      requireThat(await lane.evaluate(el => el.scrollTop) > 0, 'Native board wheel did not scroll');
      afterScroll = await neighbor.boundingBox();
      state.releaseTransition(); state.releaseTransition = null;
    };
    dispose = async () => { state.releaseTransition?.(); state.releaseTransition = null; };
    validate = async () => {
      await page.waitForFunction(() => !document.querySelector('.flip-flight'));
      await settle(page, 20_000); afterReply = await neighbor.boundingBox();
      const health = await boardHealth(page);
      requireThat(!health.hidden.length && !health.flights, 'Scroll/response left hidden cards or clones');
      // i1 removal shifts i5 in normal flow; compare the moved card against its target neighbor after commit,
      // and keep raw positions instead of claiming that normal flow movement is a jump.
      requireThat(state.issues[0].statusId === 's2', 'Delayed move did not complete');
      return { ...health, before, afterScroll, afterReply, scrollTop: await lane.evaluate(el => el.scrollTop), note: 'Positions retained for manual jump review; no pixel-based no-jump claim is made by this tool' };
    };
  }
  requireThat(typeof action === 'function', 'No adapter for ' + spec.id);
  await settle(page, 20_000);
  return { state, info, action, validate, dispose };
}
