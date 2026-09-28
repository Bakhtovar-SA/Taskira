import { afterEach, describe, expect, test, vi } from "vitest";
import { dismissSplash } from "./splash";

const mount = () => {
  const el = document.createElement("div");
  el.id = "splash";
  document.body.append(el);
  return el;
};
const reduce = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce") }));

afterEach(() => {
  document.getElementById("splash")?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("стартовая заставка", () => {
  test("reduced-motion — снимается сразу, без анимации", () => {
    reduce(true);
    const el = mount();
    dismissSplash();
    expect(el.isConnected).toBe(false);
  });

  test("обычно — растворяется (data-out) и уходит из DOM не позже чем через 400 мс", () => {
    reduce(false);
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(1000); // знак давно дорисован — ждать нечего
    const el = mount();
    dismissSplash();
    vi.advanceTimersByTime(0);
    expect(el.hasAttribute("data-out")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(el.isConnected).toBe(false);
  });

  test("нет заставки (тесты, /dev/ui после неё) — ничего не делает", () => {
    reduce(false);
    expect(() => dismissSplash()).not.toThrow();
  });
});
