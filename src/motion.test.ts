// ADR-0035 (прототип): обёртка движения — reduced-motion мгновенно, сбой загрузки чанка не ломает интерфейс,
// пресеты пружин укладываются в 500 мс успокоения.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spring } from "motion";
import { EXIT, SPRING, SPRING_ENTER, __resetMotionForTests, enter, exit, flipFrom, motionReduced, preloadMotion, setReducedMotion } from "./motion";

const systemReduce = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce") }));

type Engine = typeof import("./motionEngine");
function fakeEngine() {
  const controls = { cancel: vi.fn(), finished: Promise.resolve() };
  const animate = vi.fn((..._args: unknown[]) => controls);
  return { engine: { animate, spring } as unknown as Engine, animate, controls };
}
function card() {
  const el = document.createElement("article");
  el.animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() })) as unknown as HTMLElement["animate"];
  el.getBoundingClientRect = () => ({ left: 300, top: 100, right: 580, bottom: 180, width: 280, height: 80, x: 300, y: 100, toJSON: () => ({}) }) as DOMRect;
  return el;
}

beforeEach(() => {
  localStorage.clear();
  systemReduce(false);
});
afterEach(() => {
  __resetMotionForTests();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("reduced motion — всё мгновенно", () => {
  test.each([
    ["системный prefers-reduced-motion", () => systemReduce(true)],
    ["личный выключатель", () => setReducedMotion(true)],
  ])("%s: exit резолвится сразу, enter/flipFrom не анимируют, чанк не грузится", async (_name, reduce) => {
    const { engine, animate } = fakeEngine();
    const load = vi.fn(async () => engine);
    __resetMotionForTests(load);
    reduce();
    expect(motionReduced()).toBe(true);
    await preloadMotion();
    expect(load).not.toHaveBeenCalled();
    const el = card();
    enter(el);
    flipFrom(el, 0, 0);
    let done = false;
    void exit(el).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(el.animate).not.toHaveBeenCalled();
  });

  test("личный выключатель переживает перезагрузку модуля (localStorage) и снимается", () => {
    setReducedMotion(true);
    __resetMotionForTests();
    expect(motionReduced()).toBe(true);
    setReducedMotion(false);
    expect(motionReduced()).toBe(false);
  });
});

describe("сбой загрузки чанка — фолбэк, не блокировка", () => {
  test("preloadMotion резолвится null, enter/exit мгновенны, flipFrom — прежней кривой WAAPI, ничего не бросает", async () => {
    __resetMotionForTests(() => Promise.reject(new Error("chunk failed")));
    await expect(preloadMotion()).resolves.toBeNull();
    const el = card();
    expect(() => enter(el)).not.toThrow();
    await expect(exit(el)).resolves.toBeUndefined();
    flipFrom(el, 0, 0);
    expect(el.animate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(el.animate).mock.calls[0][1]).toMatchObject({ duration: 300 });
  });

  test("исключение внутри движка глотается", async () => {
    const { engine, animate } = fakeEngine();
    animate.mockImplementation(() => {
      throw new Error("boom");
    });
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    expect(() => enter(el)).not.toThrow();
    expect(() => flipFrom(el, 0, 0)).not.toThrow();
    await expect(exit(el)).resolves.toBeUndefined();
  });
});

describe("с загруженным чанком — пружина через WAAPI motion/mini", () => {
  test("flipFrom: transform из старой точки в ноль с пресетом SPRING; соседям — без scale", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    flipFrom(el, 0, 40, { lift: false });
    expect(animate).toHaveBeenCalledWith(el, { transform: ["translate(-300px, -60px)", "translate(0px, 0px)"] }, { type: spring, ...SPRING });
    flipFrom(el, 300, 100);
    expect(animate).toHaveBeenCalledTimes(1); // на месте — не анимируем
  });

  test("под CSS zoom (корневой 1.1 на ≥ 2560 px, здесь 1.25) сдвиг переводится в CSS px элемента", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    Object.defineProperty(el, "currentCSSZoom", { value: 1.25 });
    flipFrom(el, 175, 100, { lift: false });
    expect(animate.mock.calls[0][1]).toEqual({ transform: ["translate(-100px, 0px)", "translate(0px, 0px)"] });
  });

  test("новая анимация элемента отменяет прежнюю (прерывание без наложения)", async () => {
    const { engine, controls } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    enter(el);
    flipFrom(el, 0, 0);
    expect(controls.cancel).toHaveBeenCalled();
  });

  test("exit ждёт конца анимации ухода", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    await exit(card());
    expect(animate.mock.calls[0][2]).toEqual(EXIT);
  });
});

describe("пресеты", () => {
  test.each([
    ["SPRING", SPRING],
    ["SPRING_ENTER", SPRING_ENTER],
  ])("%s: полное время успокоения в WAAPI ≤ 500 мс", (_name, preset) => {
    const o = spring.applyToOptions!({ ...preset }) as { duration: number };
    expect(o.duration).toBeGreaterThan(0);
    expect(o.duration).toBeLessThanOrEqual(500);
  });
});
