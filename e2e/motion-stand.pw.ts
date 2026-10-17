import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { settle } from "./motion-helpers";

test.setTimeout(90_000);
let knownCssNames: Set<string> | undefined;
test.beforeAll(() => {
  // A-07 is independently reviewable; enable its runtime coverage once present
  // in the checkout, or via MOTION_MAP_SCRIPT while testing the two drafts.
  const script = process.env.MOTION_MAP_SCRIPT ?? resolve("scripts/motion-map.mjs");
  if (!existsSync(script)) return;
  const rows = JSON.parse(execFileSync(process.execPath, [script, "--json"], { encoding: "utf8" })) as { animationNames: string[] }[];
  knownCssNames = new Set(rows.flatMap(row => row.animationNames));
});

const finiteRunning = (page: Page) => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => ({
  type: animation.constructor.name,
  name: animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : "WAAPI",
  target: (animation.effect as KeyframeEffect | null)?.target instanceof Element ? ((animation.effect as KeyframeEffect).target as Element).outerHTML.slice(0, 220) : "pseudo",
  pseudo: (animation.effect as KeyframeEffect | null)?.pseudoElement,
})));
async function residue(page: Page) {
  await settle(page);
  await expect(page.locator(".flip-flight, .list-row-ghost, .count-up[data-counting]")).toHaveCount(0);
  const styles = await page.locator("[data-motion-stand] *").evaluateAll(nodes => nodes.flatMap(node => {
    if (!(node instanceof HTMLElement) || node.hasAttribute("data-glide-indicator")) return [];
    return ["transform", "opacity", "width"].filter(property => node.style.getPropertyValue(property)).map(property => `${node.tagName}.${node.className}: ${property}`);
  }));
  expect(styles).toEqual([]);
}
async function play(page: Page, action: string, reduced = false) {
  await page.locator(`[data-action="${action}"]`).click();
  if (reduced) {
    // Assert before settle: waiting for completion would hide an accidental spring.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await finiteRunning(page)).toEqual([]);
    await expect(page.locator(".count-up[data-counting]")).toHaveCount(0);
  }
  await residue(page);
}
async function openStand(page: Page, mode: "normal" | "system" | "personal" = "normal") {
  await page.emulateMedia({ reducedMotion: mode === "system" ? "reduce" : "no-preference" });
  await page.addInitScript(personal => {
    if (personal) localStorage.setItem("taskira.reduceMotion", "1"); else localStorage.removeItem("taskira.reduceMotion");
    const violations: string[] = [];
    const cssAnimations: string[] = [];
    Object.assign(window, { __motionStandCsp: violations, __motionStandCss: cssAnimations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
    document.addEventListener("animationstart", event => cssAnimations.push(event.animationName));
  }, mode === "personal");
  await page.goto("/dev/motion");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-reduced", String(mode !== "normal"));
  await page.evaluate(() => { (window as Window & { __motionStandCss: string[] }).__motionStandCss.length = 0; });
}

for (const mode of ["normal", "system", "personal"] as const) {
  test(`motion stand: all scenarios, ${mode}`, async ({ page }, testInfo) => {
    await openStand(page, mode);
    const reduced = mode !== "normal";
    await play(page, "board-move", reduced);
    await expect(page.locator('[data-column="1"] article')).toHaveCount(1);
    await play(page, "board-reorder", reduced);
    await play(page, "board-bulk-3", reduced);
    await expect(page.locator('[data-column="1"] article')).toHaveCount(3);
    await page.locator('[data-action="board-bulk-41"]').click();
    await expect(page.locator('[data-column="1"] article')).toHaveCount(41);
    await expect(page.locator(".flip-flight")).toHaveCount(0);
    expect(await page.locator("[data-board] article").evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === "running").length)).toBe(0);
    await residue(page);
    await play(page, "board-add", reduced);
    await expect(page.locator("[data-board-count]")).toHaveText("42 карточек");

    await play(page, "list-add", reduced);
    await expect(page.locator("[data-list-count]")).toHaveText("13 строк");
    await play(page, "list-remove", reduced);
    // All seven removal candidates must be visible before asserting the six-ghost cap.
    await page.locator("#list .ms-scroll").scrollIntoViewIfNeeded();
    await settle(page);
    await page.locator('[data-action="list-remove-7"]').click();
    expect(await page.locator(".list-row-ghost").count()).toBe(reduced ? 0 : 6);
    await residue(page);
    await expect(page.locator("[data-list-count]")).toHaveText("5 строк");
    await play(page, "list-201", reduced);
    await expect(page.locator("[data-row-id]")).toHaveCount(201);
    await play(page, "list-remove", reduced);
    await expect(page.locator("[data-row-id]")).toHaveCount(200);
    await play(page, "list-reset", reduced);

    for (const kind of ["rise", "dialog", "panel", "toast", "pop"]) await play(page, `enter-${kind}`, reduced);
    await play(page, "exit", reduced);
    await expect(page.locator("[data-exit-sample]")).toHaveCount(0);
    await play(page, "restore-exit", reduced);
    await play(page, "flash", reduced);
    await play(page, "width", reduced);
    await expect(page.locator("[data-width-sample]")).toHaveClass(/ms-wide/);
    await play(page, "width", reduced);
    await play(page, "tab-2", reduced);
    await expect(page.locator("[data-glide-indicator]")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 192, 0)");
    await play(page, "tab-0", reduced);
    await play(page, "count-up", reduced);
    await expect(page.locator(".count-up-text")).toHaveText(["125", "125", "125"]);
    await play(page, "count-down", reduced);
    await expect(page.locator(".count-up-text")).toHaveText(["100", "100", "100"]);
    for (const align of ["left", "center", "right"]) await expect(page.locator(`[data-count-align="${align}"] .count-up`)).toHaveCSS("text-align", align);

    for (const kind of ["dialog", "panel"] as const) {
      const trigger = page.locator(`[data-action="${kind}-open"]`);
      await trigger.click();
      if (reduced) {
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await finiteRunning(page)).toEqual([]);
      }
      await settle(page);
      const dialog = page.locator(`dialog[data-kind="${kind}"][open]`);
      await expect(dialog).toBeVisible();
      expect((await new AxeBuilder({ page }).include(`dialog[data-kind="${kind}"][open]`).analyze()).violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.locator(`[data-action="${kind}-repeat"]`).click();
      await expect(page.locator("[data-overlay-running]")).toHaveAttribute("data-overlay-running", "false");
      await residue(page);
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.locator(`[data-action="${kind}-repeat"]`)).toBeFocused();
    }
    await play(page, "toasts-queue", reduced);
    await expect(page.locator("[data-toast-id]")).toHaveCount(3);
    await expect(page.getByRole("status").filter({ hasText: "Сообщение 1" })).toBeAttached();
    await play(page, "toasts-clear", reduced);
    await expect(page.locator("[data-toast-id]")).toHaveCount(0);
    await play(page, "grid-move", reduced);
    const widget = page.locator('[data-action="widget-b"]');
    await widget.focus();
    await page.keyboard.press("ArrowRight");
    await residue(page);
    await expect(widget).toBeFocused();
    expect((await new AxeBuilder({ page }).include("[data-motion-stand]").analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => (window as Window & { __motionStandCsp: string[] }).__motionStandCsp)).toEqual([]);
    const observedCss = await page.evaluate(() => [...new Set((window as Window & { __motionStandCss: string[] }).__motionStandCss)].sort());
    await testInfo.attach("CSS runtime coverage", { body: JSON.stringify({ mode, animationNames: observedCss, inventoryChecked: !!knownCssNames }), contentType: "application/json" });
    if (knownCssNames) expect(observedCss.filter(name => !knownCssNames!.has(name)), "CSS runtime coverage: every observed animationName is inventoried").toEqual([]);
    // Pure WAAPI animations have no animationName; this does not claim JS attribution.
  });
}

test("motion stand: pause, slow playback and reduce changed during motion", async ({ page }) => {
  await openStand(page);
  await page.locator('[data-action="pause"]').click();
  await page.locator('[data-action="enter-rise"]').click();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "paused").length)).toBeGreaterThan(0);
  const halfway = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "paused").every(animation => Math.abs(Number(animation.currentTime) - Number(animation.effect?.getComputedTiming().endTime) / 2) < 1));
  expect(halfway).toBe(true);
  await page.locator('[data-action="pause"]').click();
  await residue(page);
  await page.locator('[data-action="slow"]').click();
  await page.locator('[data-action="enter-rise"]').click();
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.playState === "running" && animation.playbackRate === 0.2))).toBe(true);
  await page.locator('[data-action="slow"]').click();
  await residue(page);
  await page.locator('[data-action="enter-panel"]').click();
  await page.locator('[data-action="personal-reduce"]').check();
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-reduced", "true");
  await residue(page);
  await play(page, "board-move", true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-action="personal-reduce"]').uncheck();
  await play(page, "count-up", true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-reduced", "false");
});

test("motion stand: frozen background resumes without residue", async ({ page, context }) => {
  await openStand(page);
  const session = await context.newCDPSession(page);
  // C08 intentionally skips offscreen counters. Freeze a real visible CountUp.
  await page.locator(".ms-counts").scrollIntoViewIfNeeded();
  for (const counter of await page.locator(".ms-counts .count-up").all()) await expect(counter).toBeInViewport();
  await settle(page);
  // Freeze the actual Chromium page, rather than replacing document.visibilityState.
  await page.evaluate(() => {
    for (const action of ["board-move", "list-remove", "count-up"]) document.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click();
  });
  await expect(page.locator(".count-up[data-counting]")).toHaveCount(3);
  await session.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise<void>(resolve => setTimeout(resolve, 400));
  await session.send("Page.setWebLifecycleState", { state: "active" });
  await residue(page);
  await expect(page.locator(".count-up-text")).toHaveText(["125", "125", "125"]);
  expect(await page.locator("[data-issue-id]").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).visibility === "visible"))).toBe(true);
  await session.detach();
});

test("motion stand: desktop/mobile layout and unmount cleanup", async ({ page }, testInfo) => {
  await openStand(page);
  for (const [name, width] of [["desktop", 1280], ["mobile", 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await residue(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`motion-stand-${name}.png`), fullPage: true });
  }
  await page.evaluate(() => {
    for (const action of ["toasts-queue", "board-move", "list-remove"]) document.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click();
  });
  // Reset changes the React subtree key: real unmount, without a document reload.
  await page.locator('[data-action="reset"]').click();
  await residue(page);
  await expect(page.locator("[data-board-count]")).toHaveText("6 карточек");
  await expect(page.locator("[data-list-count]")).toHaveText("12 строк");
  await expect(page.locator("[data-toast-id]")).toHaveCount(0);
});
