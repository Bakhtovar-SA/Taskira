import { expect, test, type Page } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { settle } from "./motion-helpers";

type Seen = { name: string; surface: string; column: string; transform: boolean; duration: number };
type Recorded = Window & { __skeletonReveal: Seen[]; __skeletonCancelled: { surface: string; column: string }[] };
async function observe(page: Page, pauseReveal = false) {
  await page.addInitScript(pause => {
    const records: { name: string; surface: string; column: string; transform: boolean; duration: number }[] = [];
    const cancelled: { surface: string; column: string }[] = [];
    Object.assign(window, { __skeletonReveal: records, __skeletonCancelled: cancelled });
    document.addEventListener("animationcancel", event => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.dataset.skeletonContent || event.animationName !== "viewIn") return;
      cancelled.push({ surface: target.dataset.skeletonContent, column: target.closest(".board-col")?.getAttribute("aria-label") ?? "list" });
    });
    document.addEventListener("animationstart", event => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !["skeletonLate", "viewIn"].includes(event.animationName)) return;
      const host = target.closest<HTMLElement>("[data-skeleton-content]");
      if (!host || event.animationName === "skeletonLate" && !target.classList.contains("skeleton-late") || event.animationName === "viewIn" && target !== host) return;
      const animation = target.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === event.animationName);
      // CSS pause preserves CSS ownership; Animation.pause() would keep an API-controlled
      // animation alive after animation:none and would not test a real CSS cancellation.
      if (pause && event.animationName === "viewIn") target.style.animationPlayState = "paused";
      records.push({ name: event.animationName, surface: host.dataset.skeletonContent!, column: host.closest(".board-col")?.getAttribute("aria-label") ?? "list", transform: !!(animation?.effect as KeyframeEffect | undefined)?.getKeyframes().some(frame => "transform" in frame), duration: Number(animation?.effect?.getTiming().duration ?? 0) });
    });
  }, pauseReveal);
}
const records = (page: Page, surface: string) => page.evaluate(kind => (window as Recorded).__skeletonReveal.filter(item => item.surface === kind), surface);
async function noResidue(page: Page, surface: string) {
  await settle(page);
  const hosts = page.locator(`[data-skeleton-content="${surface}"]`);
  expect(await hosts.evaluateAll(nodes => nodes.every(node => !node.classList.contains("anim-view") && node.getAnimations().length === 0))).toBe(true);
}

for (const surface of ["board", "backlog"] as const) {
  test(`${surface}: shown delayed skeleton introduces content once, then a new fast query has no stale reveal`, async ({ page }) => {
    await boardFixture(page);
    await observe(page);
    let delay = 800;
    await page.route(url => url.pathname === "/api/projects/p1/issues" && url.searchParams.has("sort"), async route => {
      if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
      await route.fallback();
    });
    await page.goto(`/p/CORP/${surface === "board" ? "board" : "list"}`);
    const rows = page.locator(surface === "board" ? ".board-card[data-issue-id]" : '.list-table [data-issue-id]');
    await expect(rows.first()).toBeVisible();
    await expect.poll(async () => (await records(page, surface)).filter(item => item.name === "viewIn").length).toBe(surface === "board" ? 4 : 1);
    const slow = await records(page, surface);
    const fades = slow.filter(item => item.name === "viewIn");
    expect(fades.every(item => !item.transform && item.duration > 0 && item.duration <= 300)).toBe(true);
    for (const fade of fades) expect(slow.some(item => item.name === "skeletonLate" && item.column === fade.column)).toBe(true);
    await noResidue(page, surface);
    // Neither a new render nor a different query may reuse the prior skeleton flag.
    delay = 0;
    await page.evaluate(() => { (window as Recorded).__skeletonReveal.length = 0; });
    const search = page.getByRole("textbox", { name: "Фильтр задач" });
    await search.fill("Единая");
    await expect(rows).toHaveCount(1);
    await noResidue(page, surface);
    const fast = await records(page, surface);
    for (const fade of fast.filter(item => item.name === "viewIn")) expect(fast.some(item => item.name === "skeletonLate" && item.column === fade.column)).toBe(true);
    // Fast network is not proof of a fast paint on a busy runner: actual skeleton
    // start is the contract. The deterministic no-start case is covered by unit tests.
    if (!fast.some(item => item.name === "skeletonLate")) expect(fast.filter(item => item.name === "viewIn")).toEqual([]);
  });
  test(`${surface}: real native animationcancel clears a paused reveal without deferred replay`, async ({ page }) => {
    await boardFixture(page);
    await observe(page, true);
    await page.route(url => url.pathname === "/api/projects/p1/issues" && url.searchParams.has("sort"), async route => {
      await new Promise<void>(resolve => setTimeout(resolve, 800));
      await route.fallback();
    });
    await page.goto(`/p/CORP/${surface === "board" ? "board" : "list"}`);
    const expected = surface === "board" ? 4 : 1;
    await expect.poll(() => page.locator(`[data-skeleton-content="${surface}"]`).evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation instanceof CSSAnimation && animation.animationName === "viewIn" && animation.playState === "paused").length)).toBe(expected);
    // Paused animations cannot naturally finish: CSS animation:none must deliver
    // real native animationcancel to the hook's useLayoutEffect listener.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(`[data-skeleton-content="${surface}"].anim-view`)).toHaveCount(0);
    await expect.poll(() => page.evaluate(kind => (window as Recorded).__skeletonCancelled.filter(item => item.surface === kind).length, surface)).toBe(expected);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await noResidue(page, surface);
    expect((await records(page, surface)).filter(item => item.name === "viewIn")).toHaveLength(expected);
  });
  for (const mode of ["system", "personal"] as const) test(`${surface}: delayed content under ${mode} reduce has no reveal`, async ({ page }) => {
    await boardFixture(page);
    await observe(page);
    await page.emulateMedia({ reducedMotion: mode === "system" ? "reduce" : "no-preference" });
    await page.addInitScript(personal => { if (personal) localStorage.setItem("taskira.reduceMotion", "1"); }, mode === "personal");
    await page.route(url => url.pathname === "/api/projects/p1/issues" && url.searchParams.has("sort"), async route => {
      await new Promise<void>(resolve => setTimeout(resolve, 800));
      await route.fallback();
    });
    await page.goto(`/p/CORP/${surface === "board" ? "board" : "list"}`);
    await expect(page.locator(surface === "board" ? ".board-card[data-issue-id]" : '.list-table [data-issue-id]').first()).toBeVisible();
    await noResidue(page, surface);
    expect((await records(page, surface)).filter(item => item.name === "viewIn")).toEqual([]);
  });
}
