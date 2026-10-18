import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { viewTransition } from "./motion";

let main: HTMLElement;
const heading = () => { const el = document.createElement("h1"); el.textContent = "New view"; el.getClientRects = () => ({ length: 1 }) as DOMRectList; return el; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  vi.advanceTimersByTime(1); // Drain jsdom selectionchange (nested zero-delay timers advance by 1ms); never expire the 2000ms observer.
};
function nativeTransitions() {
  const finishes: (() => void)[] = [];
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: (update: () => void) => {
    update(); return { finished: new Promise<void>(resolve => finishes.push(resolve)) };
  } });
  return finishes;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.body.innerHTML = "<main><button>old view</button></main>";
  main = document.querySelector("main")!;
  main.querySelector("button")!.focus();
});
afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
  document.body.replaceChildren();
  // A new navigation disposes a pending lazy-heading observer.
  viewTransition(() => {});
  vi.runOnlyPendingTimers();
  document.documentElement.classList.remove("vt-nav");
  vi.useRealTimers(); vi.unstubAllGlobals();
});
test("without VT, lost focus reaches the new heading with preventScroll", () => {
  const next = heading(), focus = vi.spyOn(next, "focus");
  viewTransition(() => main.replaceChildren(next));
  expect(document.activeElement).toBe(document.body);
  vi.runOnlyPendingTimers();
  expect(next.tabIndex).toBe(-1); expect(document.activeElement).toBe(next);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
test("native VT waits until finished before restoring focus", async () => {
  const finishes = nativeTransitions(), next = heading();
  viewTransition(() => main.replaceChildren(next));
  expect(document.activeElement).toBe(document.body);
  finishes[0](); await tick();
  expect(document.activeElement).toBe(next);
  expect(document.documentElement.classList.contains("vt-nav")).toBe(false);
});
test("focus deliberately placed inside the new view is preserved", () => {
  const input = document.createElement("input");
  viewTransition(() => { main.replaceChildren(heading(), input); input.focus(); });
  vi.runOnlyPendingTimers(); expect(document.activeElement).toBe(input);
});
test("a lazy heading arriving after the first frame still receives focus", async () => {
  viewTransition(() => main.replaceChildren()); vi.runOnlyPendingTimers();
  const next = heading(); main.append(next); await tick();
  expect(document.activeElement).toBe(next);
  expect(vi.getTimerCount()).toBe(0);
});
test("intentional focus outside the route wins while a lazy view loads", async () => {
  const button = document.createElement("button"); document.body.append(button);
  viewTransition(() => main.replaceChildren()); vi.runOnlyPendingTimers();
  button.focus(); main.append(heading()); await tick();
  expect(document.activeElement).toBe(button); expect(vi.getTimerCount()).toBe(0);
});
test("overlapping transitions retain vt-nav until both finish; only latest can focus", async () => {
  const finishes = nativeTransitions();
  viewTransition(() => main.replaceChildren(heading()));
  const latest = heading(); viewTransition(() => main.replaceChildren(latest));
  finishes[0](); await tick();
  expect(document.documentElement.classList.contains("vt-nav")).toBe(true);
  expect(document.activeElement).toBe(document.body);
  finishes[1](); await tick();
  expect(document.activeElement).toBe(latest);
  expect(document.documentElement.classList.contains("vt-nav")).toBe(false);
});
test("a new navigation disposes the old lazy observer", async () => {
  viewTransition(() => main.replaceChildren()); vi.runOnlyPendingTimers();
  const next = heading(); viewTransition(() => main.replaceChildren(next)); vi.runOnlyPendingTimers(); await tick();
  expect(document.activeElement).toBe(next); expect(vi.getTimerCount()).toBe(0);
});
test("reduce skips VT and still restores focus", () => {
  const start = vi.fn(); Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const next = heading(); viewTransition(() => main.replaceChildren(next)); vi.runOnlyPendingTimers();
  expect(start).not.toHaveBeenCalled(); expect(document.activeElement).toBe(next);
});

test("a rejected native transition still restores focus and clears its class", async () => {
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: (update: () => void) => {
    update(); return { finished: Promise.reject(new Error("skipped transition")) };
  } });
  const next = heading(); viewTransition(() => main.replaceChildren(next)); await tick();
  expect(document.activeElement).toBe(next); expect(document.documentElement.classList.contains("vt-nav")).toBe(false);
});
test("lazy observation expires without retaining a detached route", async () => {
  viewTransition(() => main.replaceChildren()); vi.advanceTimersByTime(2001);
  main.append(heading()); await tick();
  expect(document.activeElement).toBe(document.body); expect(vi.getTimerCount()).toBe(0);
});

test("hidden stale headings during Suspense do not receive focus", () => {
  const stale = heading(); stale.getClientRects = () => ({length:0}) as DOMRectList;
  const next = heading(); viewTransition(() => main.replaceChildren(stale, next));vi.runOnlyPendingTimers();
  expect(document.activeElement).toBe(next);
});

// Without native VT, a concurrent commit can happen after the first animation frame.
test("waits for an outgoing focused route to detach after the first frame", async () => {
  viewTransition(() => {}); vi.runOnlyPendingTimers();
  expect(document.activeElement).toBe(main.querySelector("button"));
  const next = heading(); main.replaceChildren(next); await tick();
  expect(document.activeElement).toBe(next); expect(vi.getTimerCount()).toBe(0);
});
