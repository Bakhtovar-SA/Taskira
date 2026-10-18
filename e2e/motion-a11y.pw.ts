import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

test.setTimeout(90_000);
type Mode = "normal" | "system" | "personal";
const ALLOW_LOOPS = new Set(["dsSpin", "dsIndet", "shimmer", "dsShimmer"]);
async function mode(page: Page, value: Mode) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: value === "system" ? "reduce" : "no-preference" });
  await page.addInitScript(personal => {
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
  const rows = await page.locator(selector).evaluateAll(nodes => nodes.map(node => ({
    hidden: node.getAttribute("aria-hidden"), inert: node.hasAttribute("inert"),
    ids: [node, ...node.querySelectorAll("[id]")].filter(el => el.hasAttribute("id")).map(el => el.id),
  })));
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
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const hook = await page.evaluateHandle(selector => {
    const held = new Set<Animation>();
    const original = Element.prototype.animate;
    const belongs = (element: Element) => element.matches(selector) || !!element.closest(selector);
    const hold = (animation: Animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      const end = Number(animation.effect?.getComputedTiming().endTime);
      if (!(target instanceof Element) || !belongs(target) || !Number.isFinite(end) || end <= 0) return;
      animation.pause(); animation.currentTime = end / 2; held.add(animation);
    };
    Element.prototype.animate = function (...args: Parameters<Element["animate"]>) {
      const animation = original.apply(this, args); hold(animation); return animation;
    };
    const observer = new MutationObserver(() => document.getAnimations().forEach(hold));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return {
      count: () => [...held].filter(a => a.playState === "paused").length,
      cleanup: () => { observer.disconnect(); Element.prototype.animate = original; for (const a of held) if (a.playState === "paused") a.play(); },
    };
  }, scope);
  try {
    await action();
    await page.clock.runFor(32);
    await expect.poll(() => hook.evaluate(h => h.count()), { message: "The scoped animation is held halfway" }).toBeGreaterThan(0);
    await inspect();
  } finally {
    await hook.evaluate(h => h.cleanup()); await hook.dispose(); await page.clock.resume();
  }
  await settle(page);
}
async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  expect((await builder.analyze()).violations).toEqual([]);
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
    await midpoint(page, ".flip-flight, .board-view", () => page.getByRole("menuitem", { name: "В работе", exact: true }).click({ force: true }), async () => {
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