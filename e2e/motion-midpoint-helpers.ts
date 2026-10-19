/** B-03 test-only controls. Native WAAPI and production CountUp callbacks still do the drawing. */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { settle } from "./motion-helpers";

export const MIDPOINT_IMAGE = "mcr.microsoft.com/playwright:v1.56.1-noble";
const epoch = Date.parse("2026-10-18T08:00:00Z");
const captureInput = process.env.MOTION_MIDPOINT_CAPTURE_DIR;
/** Capture is deliberately a direct child of the operator's existing D-drive TEMP, never a baseline path. */
export function captureDirectory(): string | null {
  if (!captureInput) return null;
  if (process.env.CI) throw new Error("MOTION_MIDPOINT_CAPTURE_DIR is local-only; CI must compare Linux goldens");
  if (process.platform !== "win32" || !process.env.TEMP || !isAbsolute(captureInput)) throw new Error("Capture-only requires an absolute D-drive directory directly inside TEMP");
  const temp = realpathSync(process.env.TEMP), destination = resolve(captureInput);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!/^D:\\/i.test(temp) || !same(dirname(destination), resolve(process.env.TEMP)) || /__screenshots__/i.test(destination)) throw new Error("Capture destination must be a direct child of existing D-drive TEMP");
  if (existsSync(destination) && !same(dirname(realpathSync(destination)), temp)) throw new Error("Capture destination resolves outside D-drive TEMP");
  return destination;
}
export function goldenEnvironment(): { driverVersion: string; dockerImageName: string } {
  if (process.platform !== "linux") throw new Error("Midpoint goldens require the pinned Linux image; use explicit D-temp capture-only on Windows");
  if (process.env.CHROMIUM_PATH) throw new Error("Linux midpoint goldens must use the image's bundled Chromium");
  const metadata = JSON.parse(readFileSync("/ms-playwright/.docker-info", "utf8")) as { driverVersion: string; dockerImageName: string };
  expect(metadata.driverVersion).toBe("1.56.1");
  expect(metadata.dockerImageName).toBe(MIDPOINT_IMAGE);
  return metadata;
}

type PausedRecord = { animation: Animation; target: Element; midpoint: number; delay: number; activeDuration: number; finished: "pending" | "resolved" | "rejected"; finishEvents: number; cancelEvents: number };
type PauseSession = { records: PausedRecord[]; errors: string[]; restore: () => void };
type CounterSession = { flush: (at: number) => number; pending: () => number; restore: (discard?: boolean) => void; frames: number[] };
declare global {
  interface Window { __motionMidpoint?: PauseSession; __motionMidpointCounter?: CounterSession; }
}
export type Clip = { x: number; y: number; width: number; height: number };
export async function openMidpointStand(page: Page, theme: "light" | "dark", crop: string): Promise<Clip> {
  await page.clock.install({ time: new Date(epoch) });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
  await page.addInitScript(theme => {
    localStorage.setItem("taskira.theme", theme);
    localStorage.setItem("taskira.lang", "ru");
    localStorage.removeItem("taskira.reduceMotion");
  }, theme);
  await page.goto("/dev/motion");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-motion-stand]")).toHaveAttribute("data-reduced", "false");
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.locator(crop).evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(page);
  const box = await page.locator(crop).boundingBox();
  if (!box) throw new Error("Missing midpoint crop: " + crop);
  const viewport = page.viewportSize()!;
  const clip = { x: Math.max(0, Math.floor(box.x) - 8), y: Math.max(0, Math.floor(box.y) - 8),
    width: Math.ceil(box.width) + 16, height: Math.ceil(box.height) + 16 };
  if (clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height) throw new Error("Midpoint crop must fit entirely inside the fixed viewport");
  // Pause only after fonts, lazy engine and normal setup have settled. Advancing the clock later is explicit.
  // This freezes fly's existing 1000ms safety timer without modifying the runtime timeout.
  await page.clock.pauseAt(new Date(epoch + 60 * 60 * 1000));
  return clip;
}
/** Hook before the stand action: no real frame can race past a short exit before the test finds it. */
export async function pauseScope(page: Page, selector: string): Promise<void> {
  await page.evaluate(selector => {
    window.__motionMidpoint?.restore();
    const original = Element.prototype.animate;
    const records: PausedRecord[] = [], errors: string[] = [];
    const patched: typeof Element.prototype.animate = function(this: Element, frames, options) {
      const animation = original.call(this, frames, options);
      if (!this.matches(selector) && !this.closest(selector)) return animation;
      const timing = animation.effect?.getComputedTiming();
      if (!timing || timing.iterations === Infinity || !Number.isFinite(Number(timing.activeDuration)) || Number(timing.activeDuration) <= 0) {
        errors.push("Expected a finite scoped effect"); return animation;
      }
      const activeDuration = Number(timing.activeDuration);
      const delay = timing.delay ?? 0; const midpoint = delay + activeDuration / 2;
      const record: PausedRecord = { animation, target: this, midpoint, delay, activeDuration, finished: "pending", finishEvents: 0, cancelEvents: 0 };
      records.push(record);
      // Keep the native Animation, finished promise and Motion's onfinish handler intact.
      animation.finished.then(() => { record.finished = "resolved"; }, () => { record.finished = "rejected"; });
      animation.addEventListener("finish", () => { record.finishEvents++; });
      animation.addEventListener("cancel", () => { record.cancelEvents++; });
      animation.pause(); animation.currentTime = midpoint;
      animation.ready.then(() => { if (animation.playState === "paused") animation.currentTime = midpoint; }, () => { errors.push("Native pause did not become ready"); });
      return animation;
    };
    Element.prototype.animate = patched;
    window.__motionMidpoint = { records, errors, restore: () => {
      if (Element.prototype.animate === patched) Element.prototype.animate = original;
    } };
  }, selector);
}
export async function standAction(page: Page, action: string): Promise<void> {
  // Native input's actionability waits use RAF. With the JS clock stopped, invoke the real stand button's handler.
  await page.locator('[data-action="' + action + '"]').evaluate(element => (element as HTMLButtonElement).click());
}
export async function pausedProof(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__motionMidpoint?.records.length ?? 0), { intervals: [10, 25, 50] }).toBeGreaterThan(0);
  await page.evaluate(async () => { await Promise.all(window.__motionMidpoint!.records.map(record => record.animation.ready)); });
  const proof = await page.evaluate(() => ({
    virtualNow: performance.now(), errors: window.__motionMidpoint!.errors,
    records: window.__motionMidpoint!.records.map(record => ({
      target: record.target.outerHTML.slice(0, 200), connected: record.target.isConnected,
      midpoint: record.midpoint, currentTime: Number(record.animation.currentTime), delay: record.delay, activeDuration: record.activeDuration,
      state: record.animation.playState, finished: record.finished, finishEvents: record.finishEvents, cancelEvents: record.cancelEvents,
      inline: record.target.getAttribute("style"), transform: getComputedStyle(record.target).transform, opacity: getComputedStyle(record.target).opacity,
    })),
  }));
  expect(proof.errors).toEqual([]);
  for (const record of proof.records) {
    expect(record.connected).toBe(true); expect(record.state).toBe("paused");
    expect(record.finished).toBe("pending"); expect(record.finishEvents).toBe(0); expect(record.cancelEvents).toBe(0);
    expect(record.currentTime).toBeCloseTo(record.delay + record.activeDuration / 2, 5);
  }
  return proof;
}
/** Exact timestamps reach the REAL countTo callbacks. No DOM text/data-shown is fabricated. */
export async function holdCounterRaf(page: Page): Promise<void> {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
    let next = -1;
    const pending = new Map<number, FrameRequestCallback>(), frames: number[] = [];
    const heldRequest: typeof requestAnimationFrame = callback => { const id = next--; pending.set(id, callback); return id; };
    const heldCancel: typeof cancelAnimationFrame = id => { if (id < 0) pending.delete(id); else cancel.call(window, id); };
    window.requestAnimationFrame = heldRequest; window.cancelAnimationFrame = heldCancel;
    window.__motionMidpointCounter = {
      pending: () => pending.size, frames,
      flush: at => {
        const callbacks = [...pending.values()]; pending.clear(); frames.push(at);
        for (const callback of callbacks) callback(at);
        return callbacks.length;
      },
      restore: (discard = false) => {
        if (pending.size && !discard) throw new Error("Counter still owns queued callbacks; complete or cancel it before restoring RAF");
        if (discard) pending.clear();
        if (window.requestAnimationFrame === heldRequest) window.requestAnimationFrame = request;
        if (window.cancelAnimationFrame === heldCancel) window.cancelAnimationFrame = cancel;
      },
    };
  });
}
// Шаг кнопки «Увеличить число» в src/dev/DevMotion.tsx (setValue(x => x + 25)).
const COUNT_STEP = 25;
export async function counterMidpoint(page: Page) {
  // Начальное значение берём из самого стенда, а не зашиваем в тест.
  const startValue = Number(await page.locator(".count-up").first().textContent());
  expect(Number.isFinite(startValue)).toBe(true);
  await holdCounterRaf(page);
  await standAction(page, "count-up");
  await expect(page.locator(".count-up[data-counting]")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.__motionMidpointCounter!.pending()), { intervals: [10, 25, 50] }).toBe(3);
  // Prime at elapsed zero (also supports the older countTo that starts at its first RAF).
  await page.evaluate(() => window.__motionMidpointCounter!.flush(performance.now()));
  const startedAt = await page.evaluate(() => performance.now());
  const duration = await page.evaluate(async () => { const url = "/src/motion.ts"; return (await import(url)).COUNT_MS as number; });
  expect(duration).toBeGreaterThan(0);
  await page.clock.runFor(duration / 2);
  await page.evaluate(() => window.__motionMidpointCounter!.flush(performance.now()));
  const proof = await counterProof(page);
  expect(proof.now - startedAt).toBe(duration / 2);
  expect(proof.frames.slice(-2)).toEqual([startedAt, startedAt + duration / 2]);
  expect(proof.pending).toBe(3);
  const endText = String(startValue + COUNT_STEP);
  // ease-out cubic на середине: start + step * (1 - (1 - .5)^3), а не арифметическая середина (100 -> 125 даёт 122, не 112/113).
  // Кривая и COUNT_MS заданы в src/motion.ts; смена кривой должна менять и это ожидание.
  const midText = String(Math.round(startValue + COUNT_STEP * (1 - 0.5 ** 3)));
  expect(proof.values.map(value => value.text)).toEqual([endText, endText, endText]);
  expect(proof.values.map(value => value.shown)).toEqual([midText, midText, midText]);
  expect(proof.values.every(value => value.counting && value.content.includes(midText))).toBe(true);
  return { ...proof, startedAt, duration };
}
export async function counterProof(page: Page) {
  return page.evaluate(() => ({ now: performance.now(), frames: [...window.__motionMidpointCounter!.frames], pending: window.__motionMidpointCounter!.pending(),
    values: [...document.querySelectorAll<HTMLElement>(".count-up")].map(element => ({ text: element.textContent, shown: element.dataset.shown,
      counting: element.hasAttribute("data-counting"), content: getComputedStyle(element, "::after").content })),
  }));
}
export async function finishMidpoint(page: Page, counter: boolean): Promise<void> {
  try {
    if (counter && await page.evaluate(() => !!window.__motionMidpointCounter)) {
      try {
        await page.evaluate(() => window.__motionMidpointCounter!.flush(performance.now()));
        await page.clock.runFor(1000);
        await page.evaluate(() => { window.__motionMidpointCounter!.flush(performance.now()); window.__motionMidpointCounter!.restore(); });
      } finally {
        // A failed assertion must still release test hooks before the context is discarded.
        await page.evaluate(() => window.__motionMidpointCounter!.restore(true));
      }
    }
    await page.evaluate(() => {
      const session = window.__motionMidpoint;
      session?.restore();
      for (const record of session?.records ?? []) if (record.animation.playState === "paused") record.animation.play();
    });
  } finally { await page.clock.resume(); }
  await settle(page);
  await expect(page.locator(".flip-flight, .list-row-ghost, .count-up[data-counting]")).toHaveCount(0);
}
export async function saveMidpoint(page: Page, testInfo: TestInfo, name: string, clip: Clip, capture: string | null): Promise<void> {
  if (capture) {
    await mkdir(capture, { recursive: true });
    const path = join(capture, name);
    await page.screenshot({ path, clip, animations: "allow", caret: "hide", scale: "css" });
    // Attaching a PNG would copy it into test-results outside TEMP. Capture mode writes only this D-temp PNG.
    console.log("Local midpoint capture (not golden): " + path);
  } else {
    await expect(page).toHaveScreenshot(name, { clip, animations: "allow", caret: "hide", scale: "css", maxDiffPixelRatio: 0.002 });
  }
}
export async function saveProof(testInfo: TestInfo, capture: string | null, name: string, proof: unknown): Promise<void> {
  const body = JSON.stringify(proof, null, 2);
  const proofPath = testInfo.outputPath(name.replace(/\.png$/, ".proof.json"));
  await mkdir(dirname(proofPath), { recursive: true });
  await writeFile(proofPath, body + "\n");
  await testInfo.attach("midpoint proof", { path: proofPath, contentType: "application/json" });
  if (capture) {
    await mkdir(capture, { recursive: true });
    await writeFile(join(capture, name.replace(/\.png$/, ".proof.json")), body + "\n");
  }
}
