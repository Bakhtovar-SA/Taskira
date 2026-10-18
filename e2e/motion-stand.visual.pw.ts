/** B-03: exactly five midpoint scenes x two themes. Linux goldens are reviewed CI artifacts. */
import { expect, test } from "@playwright/test";
import { captureDirectory, counterMidpoint, counterProof, finishMidpoint, goldenEnvironment, MIDPOINT_IMAGE,
  openMidpointStand, pausedProof, pauseScope, saveMidpoint, saveProof, standAction } from "./motion-midpoint-helpers";

test.setTimeout(60_000);
// Unlike serial mode, default continues after a missing baseline so all ten actual PNGs reach the artifact.
test.describe.configure({ mode: "default" });
test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const capture = captureDirectory();
let image: ReturnType<typeof goldenEnvironment> | null = null;
test.beforeAll(() => {
  if (capture) return;
  test.skip(process.platform !== "linux", "Generate goldens only in " + MIDPOINT_IMAGE + "; use explicit D-temp capture-only locally");
  image = goldenEnvironment();
});
const scenes = [
  { name: "board-flight", action: "board-move", crop: ".ms-board", scope: "[data-board] article, .flip-flight .ms-card" },
  { name: "list-ghost", action: "list-remove", crop: "#list .ms-scroll", scope: "[data-list] .ms-row, .list-row-ghost" },
  { name: "dialog-enter", action: "enter-dialog", crop: ".ms-samples", scope: '[data-scenario="enter-dialog"] .ms-sample' },
  { name: "count-up", action: "count-up", crop: ".ms-counts", scope: null },
  { name: "tab-indicator", action: "tab-2", crop: ".ms-tabs", scope: "[data-glide-indicator]" },
] as const;

for (const theme of ["light", "dark"] as const) for (const scene of scenes) {
  test("midpoint " + scene.name + " " + theme, async ({ page, browser }, testInfo) => {
    const clip = await openMidpointStand(page, theme, scene.crop);
    const name = "motion-" + scene.name + "-mid-" + theme + ".png";
    const counter = scene.scope === null;
    let before: unknown, after: unknown;
    try {
      if (counter) {
        const midpoint = await counterMidpoint(page);
        before = await counterProof(page);
        await saveProof(testInfo, capture, name, { mode: capture ? "capture-only (not golden)" : "Linux golden comparison", image,
          browser: browser.version(), theme, scene: scene.name, clip, phase: "before screenshot", midpoint });
      } else {
        await pauseScope(page, scene.scope);
        await standAction(page, scene.action);
        before = await pausedProof(page);
        if (scene.name === "board-flight") {
          await expect(page.locator(".flip-flight")).toHaveCount(1);
          await expect(page.locator('[data-column="1"] article')).toHaveCSS("visibility", "hidden");
          // Node's timer is real; the page clock is frozen. Prove fly's existing JS guard cannot erase the sample.
          await new Promise<void>(resolve => setTimeout(resolve, 1100));
          await expect(page.locator(".flip-flight")).toHaveCount(1);
        } else if (scene.name === "list-ghost") {
          await expect(page.locator(".list-row-ghost")).toHaveCount(1);
          await expect(page.locator(".list-row-ghost")).toHaveAttribute("aria-hidden", "true");
          await expect(page.locator(".list-row-ghost")).toHaveAttribute("inert", "");
        }
      }
      try {
        await saveMidpoint(page, testInfo, name, clip, capture);
      } finally {
        after = counter ? await counterProof(page) : await pausedProof(page);
        // Native finished/onfinish stay pending, track has not cleared the effect, and a paused RAF count stays put.
        expect(after).toEqual(before);
        await saveProof(testInfo, capture, name, { mode: capture ? "capture-only (not golden)" : "Linux golden comparison", image,
          browser: browser.version(), node: process.version, theme, scene: scene.name, clip, before, after,
          note: "No runtime timeouts/durations were changed. Native animations are paused at delay + activeDuration/2; CountUp executes its real RAF callbacks at elapsed 0 and COUNT_MS/2." });
      }
    } finally {
      await finishMidpoint(page, counter);
    }
  });
}
