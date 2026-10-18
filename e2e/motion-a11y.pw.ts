import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

test.setTimeout(90_000);
type Mode = "normal" | "system" | "personal";
declare global { interface Window { __b04NativeTimers?: { setTimeout: typeof window.setTimeout; clearTimeout: typeof window.clearTimeout }; } }
const installedClocks = new WeakSet<Page>();
const ALLOW_LOOPS = new Set(["dsSpin", "dsIndet", "shimmer", "dsShimmer"]);
async function mode(page: Page, value: Mode) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: value === "system" ? "reduce" : "no-preference" });
  await page.addInitScript(personal => {
    // Capture before page.clock patches timers. Only axe borrows these while product guards stay frozen.
    window.__b04NativeTimers = { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) };
    if (personal) localStorage.setItem("taskira.reduceMotion", "1");
    else localStorage.removeItem("taskira.reduceMotion");
  }, value === "personal");
}
async function noMotion(page: Page) {
  // Check immediately after the action commit, rather than hiding a spring with settle().
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").map(a => ({
    name: a instanceof CSSAnimation ? a.animationName : "WAAPI/transition",
    infinite: a.effect?.getComputedTiming().iterations === Infinity,
  })));
  expect(running.filter(a => !a.infinite || !ALLOW_LOOPS.has(a.name))).toEqual([]);
  await expect(page.locator(".flip-flight, .list-row-ghost, .count-up[data-counting]")).toHaveCount(0);
}
async function copies(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeAttached();
  const rows = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    // boardFlip hides its wrapper from AX, and makes the actual cloned article inert.
    // listExit places both attributes directly on its cloned row. Check effective semantics.
    const clone = node.matches(".flip-flight") ? node.firstElementChild : node;
    return { hidden: clone?.closest("[aria-hidden='true']")?.getAttribute("aria-hidden") ?? null,
      inert: !!clone?.closest("[inert]"),
      ids: [node, ...node.querySelectorAll("[id]")].filter(el => el.hasAttribute("id")).map(el => el.id) };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row).toEqual({ hidden: "true", inert: true, ids: [] });
  expect(await page.locator("[id]").evaluateAll(nodes => {
    const ids = nodes.map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index);
  })).toEqual([]);
}
/** Pause only animations belonging to this scenario. Frozen test timers prevent the independent
 *  1.2s safety guard from deleting a held clone while axe takes longer on a slow machine.
 *  The actual click remains trusted; force bypasses RAF stability only because its clock is paused. */
async function midpoint(page: Page, scope: string, action: () => Promise<unknown>, inspect: () => Promise<void>) {
  await settle(page);
  if (!installedClocks.has(page)) { await page.clock.install(); installedClocks.add(page); }
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const hook = await page.evaluateHandle(selector => {
    type Held = { animation: Animation; target: Element; delay: number; activeDuration: number; midpoint: number;
      finished: "pending" | "resolved" | "rejected"; finishEvents: number; cancelEvents: number;
      onFinish: () => void; onCancel: () => void };
    const held = new Map<Animation, Held>();
    const errors: string[] = [];
    const original = Element.prototype.animate;
    const belongs = (element: Element) => element.matches(selector) || !!element.closest(selector);
    const hold = (animation: Animation) => {
      if (held.has(animation)) return;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (!(target instanceof Element) || !belongs(target)) return;
      const timing = animation.effect?.getComputedTiming();
      if (!timing || timing.iterations === Infinity) return;
      const delay = Number(timing.delay), activeDuration = Number(timing.activeDuration);
      const midpoint = delay + activeDuration / 2;
      if (!Number.isFinite(delay) || !Number.isFinite(activeDuration) || activeDuration <= 0 ||
        !Number.isFinite(Number(timing.endTime)) || !Number.isFinite(midpoint) || midpoint < 0) {
        errors.push("Scoped effect has no finite reachable active midpoint"); return;
      }
      const record: Held = { animation, target, delay, activeDuration, midpoint, finished: "pending", finishEvents: 0, cancelEvents: 0,
        onFinish: () => { record.finishEvents++; }, onCancel: () => { record.cancelEvents++; } };
      held.set(animation, record);
      // Observe the ORIGINAL native promise/events: no fabricated Animation or replacement onfinish.
      animation.finished.then(() => { record.finished = "resolved"; }, () => { record.finished = "rejected"; });
      animation.addEventListener("finish", record.onFinish); animation.addEventListener("cancel", record.onCancel);
      animation.pause(); animation.currentTime = midpoint;
      animation.ready.then(() => { if (animation.playState === "paused") animation.currentTime = midpoint; },
        () => { errors.push("Native midpoint pause did not become ready"); });
    };
    const patched: typeof Element.prototype.animate = function (this: Element, frames, options) {
      const animation = original.call(this, frames, options); hold(animation); return animation;
    };
    Element.prototype.animate = patched;
    const observer = new MutationObserver(() => document.getAnimations().forEach(hold));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return {
      count: () => held.size,
      proof: async () => {
        await Promise.all([...held.keys()].map(animation => animation.ready));
        return { errors, records: [...held.values()].map(record => ({
          nativeAnimation: record.animation instanceof Animation, nativeEffect: record.animation.effect instanceof KeyframeEffect,
          connected: record.target.isConnected, delay: record.delay, activeDuration: record.activeDuration, midpoint: record.midpoint,
          currentTime: record.animation.currentTime, state: record.animation.playState, finished: record.finished,
          finishEvents: record.finishEvents, cancelEvents: record.cancelEvents,
        })) };
      },
      cleanup: () => {
        observer.disconnect(); if (Element.prototype.animate === patched) Element.prototype.animate = original;
        for (const record of held.values()) {
          record.animation.removeEventListener("finish", record.onFinish); record.animation.removeEventListener("cancel", record.onCancel);
          if (record.animation.playState === "paused") record.animation.play();
        }
      },
    };
  }, scope);
  let failed = false;
  try {
    await action();
    await page.clock.runFor(32);
    await expect.poll(() => hook.evaluate(h => h.count()), { message: "The scoped animation is held halfway" }).toBeGreaterThan(0);
    const proof = await hook.evaluate(h => h.proof());
    expect(proof.errors).toEqual([]);
    for (const record of proof.records) {
      expect(record.nativeAnimation).toBe(true); expect(record.nativeEffect).toBe(true);
      expect(record.connected).toBe(true); expect(record.state).toBe("paused");
      expect(record.finished).toBe("pending"); expect(record.finishEvents).toBe(0); expect(record.cancelEvents).toBe(0);
      expect(typeof record.currentTime).toBe("number");
      expect(Number(record.currentTime)).toBeCloseTo(record.delay + record.activeDuration / 2, 5);
    }
    await test.info().attach("Native midpoint proof", { body: JSON.stringify({ scope, ...proof }), contentType: "application/json" });
    await inspect();
  } catch (error) { failed = true; throw error; } finally {
    // Preserve the original diagnostic if the runner closes a timed-out page.
    try {
      if (!page.isClosed()) await hook.evaluate(h => h.cleanup());
      await hook.dispose();
      if (!page.isClosed()) await page.clock.resume();
    } catch (error) { if (!failed) throw error; }
  }
  await settle(page);
}
async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const scheduler = await page.evaluateHandle(() => {
    const native = window.__b04NativeTimers;
    if (!native) throw new Error("B04 native axe scheduler was not captured before clock installation");
    const mocked = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
    // axe yields through setTimeout; its own work must run while existing product timer IDs stay frozen.
    window.setTimeout = native.setTimeout; window.clearTimeout = native.clearTimeout;
    return { restore: () => { window.setTimeout = mocked.setTimeout; window.clearTimeout = mocked.clearTimeout; } };
  });
  let failed = false;
  try { expect((await builder.analyze()).violations).toEqual([]); }
  catch (error) { failed = true; throw error; }
  finally {
    try { if (!page.isClosed()) await scheduler.evaluate(s => s.restore()); await scheduler.dispose(); }
    catch (error) { if (!failed) throw error; }
  }
}
async function inbox(page: Page, reduced = false) {
  const base = await boardFixture(page);
  const notes = base.issues.slice(0, 3).map((issue, i) => ({ id: `n${i + 1}`, type: "issue.comment", actor: base.users[1],
    projectId: "p1", issueId: issue.id, payload: { key: issue.key, title: issue.title }, read: false, createdAt: "2026-10-04T06:00:00Z" }));
  let release: (() => void) | undefined;
  let requested: string[] = [];
  await page.route("**/api/notifications?*", route => route.fulfill({ json: { items: notes, nextCursor: null } }));
  await page.route("**/api/notifications/unread-count", route => route.fulfill({ json: { count: notes.filter(n => !n.read).length } }));
  await page.route("**/api/notifications/read", async route => {
    const ids = route.request().postDataJSON().ids as string[] | undefined;
    requested = ids ?? notes.map(n => n.id);
    await new Promise<void>(resolve => { release = resolve; });
    for (const note of notes) if (requested.includes(note.id)) note.read = true;
    await route.fulfill({ status: 204 });
  });
  const loaded = reduced ? null : loadMotion(page);
  await page.goto("/inbox");
  await expect(page.locator(".inbox-row")).toHaveCount(3);
  if (loaded) { await page.keyboard.press("["); await loaded; await page.keyboard.press("["); }
  await page.getByRole("tab", { name: /Непрочитанные/ }).click(); await settle(page);
  return { requested: () => requested, release: () => { release?.(); release = undefined; } };
}

test("B04 live inbox: axe and inert ghosts at midpoint, middle/last focus", async ({ page }) => {
  await mode(page, "normal"); const api = await inbox(page);
  try {
    const second = page.locator('[data-enter-id="n2"] button').first();
    await second.focus(); await page.keyboard.press("e");
    await expect.poll(api.requested).toEqual(["n2"]);
    await midpoint(page, ".list-row-ghost, .inbox-list", async () => { api.release(); }, async () => {
      await copies(page, ".list-row-ghost"); await axe(page);
      await expect(page.locator('[data-enter-id="n3"] button').first()).toBeFocused();
    });
    await page.keyboard.press("e"); await expect.poll(api.requested).toEqual(["n3"]); api.release();
    await expect(page.locator('[data-enter-id="n1"] button').first()).toBeFocused(); await settle(page);
    await page.keyboard.press("e"); await expect.poll(api.requested).toEqual(["n1"]); api.release();
    await expect(page.getByRole("tab", { name: /Непрочитанные/ })).toBeFocused(); await settle(page);
  } finally { api.release(); }
});

async function board(page: Page, reduced = false) {
  const fixture = await boardFixture(page);
  const writes = { single: 0, bulk: 0 };
  // Board list responses do not populate the store's single-issue cache: M resolves GET first.
  await page.route("**/api/projects/p1/issues/*", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const issue = fixture.issues.find(item => item.id === id);
    return route.request().method() === "GET" && issue ? route.fulfill({ json: issue }) : route.fallback();
  });
  await page.route("**/api/projects/p1/issues/*/transition", async route => {
    writes.single++;
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    const issue = fixture.issues.find(item => item.id === id)!;
    issue.statusId = route.request().postDataJSON().to; issue.updatedAt = "2026-10-04T07:00:01Z";
    await route.fulfill({ json: issue });
  });
  await page.route("**/api/projects/p1/issues/bulk", async route => {
    writes.bulk++;
    const body = route.request().postDataJSON() as { issueIds: string[]; statusId: string };
    for (const issue of fixture.issues) if (body.issueIds.includes(issue.id)) { issue.statusId = body.statusId; issue.updatedAt = "2026-10-04T07:00:02Z"; }
    await route.fulfill({ json: { succeeded: body.issueIds, failed: [] } });
  });
  const loaded = reduced ? null : loadMotion(page); await page.goto("/p/CORP/board");
  await expect(page.locator('article[data-issue-id="i1"]')).toBeVisible();
  if (loaded) { await page.keyboard.press("["); await loaded; await page.keyboard.press("["); }
  await settle(page); return writes;
}
for (const value of ["normal", "system", "personal"] as const) test(`B04 live board: M, bulk and focus (${value})`, async ({ page }) => {
  await mode(page, value); const writes = await board(page, value !== "normal");
  const card = page.locator('article[data-issue-id="i1"] .board-card-open');
  await card.focus(); await page.keyboard.press("m");
  if (value === "normal") {
    await midpoint(page, ".flip-flight", () => page.getByRole("menuitem", { name: "В работе", exact: true }).click({ force: true }), async () => {
      await copies(page, ".flip-flight"); await axe(page);
    });
  } else {
    await page.getByRole("menuitem", { name: "В работе", exact: true }).click();
    await expect.poll(() => writes.single).toBe(1); await noMotion(page);
  }
  await expect(card).toBeFocused(); await settle(page);
  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  for (const id of ["i1", "i2", "i3"]) await page.locator(`article[data-issue-id="${id}"]`).click();
  await page.locator(".list-bulk-bar").getByRole("button", { name: "Действия", exact: true }).click();
  await page.getByRole("button", { name: "Статус", exact: true }).click();
  await page.getByRole("menuitem", { name: "На ревью", exact: true }).click();
  await expect.poll(() => writes.bulk).toBe(1);
  if (value !== "normal") await noMotion(page); else await settle(page);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("article")?.getAttribute("data-issue-id"))).toMatch(/^i[123]$/);
  await expect(page.locator(".flip-flight")).toHaveCount(0);
});

for (const value of ["system", "personal"] as const) test(`B04 live inbox: reduced removal and empty focus (${value})`, async ({ page }) => {
  await mode(page, value); const api = await inbox(page, true);
  try {
    for (const [id, next] of [["n2", "n3"], ["n3", "n1"], ["n1", null]] as const) {
      await page.locator(`[data-enter-id="${id}"] button`).first().focus(); await page.keyboard.press("e");
      await expect.poll(api.requested).toEqual([id]); api.release();
      if (next) await expect(page.locator(`[data-enter-id="${next}"] button`).first()).toBeFocused();
      else await expect(page.getByRole("tab", { name: /Непрочитанные/ })).toBeFocused();
      await noMotion(page);
    }
  } finally { api.release(); }
});

test("B04 A08: axe with paused board/list copies", async ({ page }) => {
  await mode(page, "normal"); await page.goto("/dev/motion");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-ready", "true"); await settle(page);
  for (const [action, scope, clone] of [["board-move", ".flip-flight, #board", ".flip-flight"], ["list-remove", ".list-row-ghost, #list", ".list-row-ghost"]]) {
    await page.locator(`[data-action="${action}"]`).scrollIntoViewIfNeeded(); await settle(page);
    await midpoint(page, scope, () => page.locator(`[data-action="${action}"]`).click({ force: true }), async () => {
      await copies(page, clone); await axe(page, "[data-motion-stand]");
    });
  }
});

for (const value of ["normal", "system", "personal"] as const) test(`B04 Chromium AX-tree: CountUp exposes final text only (${value})`, async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP is Chromium-only; real screen readers remain manual QA");
  await mode(page, value); await page.goto("/dev/ui?section=countup");
  const valueNode = page.getByTestId("countup-value"); await expect(valueNode).toHaveText("7");
  await settle(page); await page.clock.install(); await page.clock.pauseAt(new Date());
  const session = await page.context().newCDPSession(page);
  try {
    await page.getByRole("button", { name: "+120", exact: true }).click({ force: true }); await page.clock.runFor(32);
    await expect(valueNode).toHaveText("127");
    const count = valueNode.locator(".count-up");
    if (value === "normal") { await expect(count).toHaveAttribute("data-counting", ""); expect(await count.getAttribute("data-shown")).not.toBe("127"); }
    else await expect(count).not.toHaveAttribute("data-counting", "");
    await session.send("Accessibility.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="countup-value"]' });
    const { node } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const owner = nodes.find(n => n.backendDOMNodeId === node.backendNodeId);
    expect(owner, "CountUp container appears in Chromium accessibility tree").toBeDefined();
    const indexed = new Map(nodes.map(n => [n.nodeId, n]));
    const descendants: typeof nodes = [];
    const visit = (id: string) => { const n = indexed.get(id); if (!n) return; descendants.push(n); n.childIds?.forEach(visit); };
    visit(owner!.nodeId);
    const text = descendants.filter(n => !n.ignored && n.role?.value === "StaticText").map(n => String(n.name?.value ?? "")).filter(Boolean);
    expect(text).toEqual(["127"]);
    await test.info().attach(`countup-AX-${value}`, { body: JSON.stringify(descendants), contentType: "application/json" });
  } finally { await session.detach(); await page.clock.resume(); }
  await settle(page);
});
for (const value of ["system", "personal"] as const) test(`B04 A08: reduced motion after each supported scenario (${value})`, async ({ page }) => {
  await mode(page, value); await page.goto("/dev/motion");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-reduced", "true"); await settle(page);
  for (const action of ["board-move", "board-reorder", "board-bulk-3", "board-add", "list-add", "list-remove", "enter-rise", "enter-dialog", "enter-panel", "enter-pop", "flash", "width", "tab-2", "count-up", "grid-move", "toasts-queue", "toasts-clear"]) {
    await page.locator(`[data-action="${action}"]`).click(); await noMotion(page);
  }
  for (const kind of ["dialog", "panel"]) {
    const trigger = page.locator(`[data-action="${kind}-open"]`);
    await trigger.click(); await expect(page.locator("dialog[open]")).toBeVisible(); await noMotion(page);
    await page.keyboard.press("Escape"); await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(trigger).toBeFocused(); await noMotion(page);
  }
  await axe(page, "[data-motion-stand]");
});

test("B04 A08: closing an entering dialog restores trigger focus", async ({ page }) => {
  await mode(page, "normal"); await page.goto("/dev/motion");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-ready", "true");
  for (const kind of ["dialog", "panel"]) {
    const trigger = page.locator(`[data-action="${kind}-open"]`);
    await trigger.scrollIntoViewIfNeeded(); await settle(page);
    await midpoint(page, "dialog[open]", () => trigger.click({ force: true }), async () => {
      await axe(page, "dialog[open]");
      await page.keyboard.press("Escape"); await page.clock.runFor(32);
    });
    await expect(page.locator("dialog[open]")).toHaveCount(0); await expect(trigger).toBeFocused();
  }
});