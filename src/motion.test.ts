// ADR-0035 (прототип): обёртка движения — reduced-motion мгновенно, сбой загрузки чанка не ломает интерфейс,
// пресеты пружин укладываются в 500 мс успокоения.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spring } from "motion";
import { EXIT, SPRING, SPRING_ENTER, SPRING_POP, __resetMotionForTests, enter, exit, flash, flipFrom, glideTo, glideWidth, motionReduced, preloadMotion, preloadMotionIdle, setReducedMotion, stopMotion, userReducedMotion } from "./motion";
import { createEnterTracker } from "./listEnter";

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

  test("после сбоя чанк не запрашивается заново на каждый вызов (пауза RETRY_MS)", async () => {
    const load = vi.fn(() => Promise.reject(new Error("chunk failed")));
    __resetMotionForTests(load);
    await preloadMotion();
    await preloadMotion();
    enter(card());
    expect(load).toHaveBeenCalledTimes(1);
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
    ["SPRING_POP", SPRING_POP],
  ])("%s: полное время успокоения в WAAPI ≤ 500 мс", (_name, preset) => {
    const o = spring.applyToOptions!({ ...preset }) as { duration: number };
    expect(o.duration).toBeGreaterThan(0);
    expect(o.duration).toBeLessThanOrEqual(500);
  });
});

describe("тосты, окна, вкладки, строки списка (ADR-0035, расширение прототипа)", () => {
  const box = { x: 10, y: 2, w: 80, h: 30 };

  test.each([
    ["системный prefers-reduced-motion", () => systemReduce(true)],
    ["личный выключатель", () => setReducedMotion(true)],
  ])("%s: enter любого вида и glideTo — мгновенно, exit(toast) резолвится сразу, preloadMotionIdle ничего не планирует", async (_n, reduce) => {
    const { engine, animate } = fakeEngine();
    const load = vi.fn(async () => engine);
    __resetMotionForTests(load);
    reduce();
    const el = card();
    for (const kind of ["rise", "dialog", "panel", "toast"] as const) enter(el, kind);
    await expect(exit(el, "toast")).resolves.toBeUndefined();
    glideTo(el, box);
    glideTo(el, { ...box, x: 200 });
    expect(el.style.transform).toBe("translate(200px, 2px)"); // место — сразу, без движения
    expect(el.style.width).toBe("80px");
    const cancelIdle = preloadMotionIdle();
    expect(() => cancelIdle()).not.toThrow();
    expect(animate).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("чанк не загрузился: enter/exit/glideTo/stopMotion не бросают, glideTo ставит индикатор на место", async () => {
    __resetMotionForTests(() => Promise.reject(new Error("chunk failed")));
    await preloadMotion();
    const el = card();
    expect(() => enter(el, "dialog")).not.toThrow();
    expect(() => enter(el, "panel")).not.toThrow();
    await expect(exit(el, "toast")).resolves.toBeUndefined();
    expect(() => glideTo(el, box)).not.toThrow();
    expect(() => glideTo(el, { ...box, x: 120, w: 40 })).not.toThrow();
    expect(el.style.transform).toBe("translate(120px, 2px)");
    expect(el.style.width).toBe("40px");
    expect(() => stopMotion(el)).not.toThrow();
    expect(el.animate).not.toHaveBeenCalled();
  });

  test("элемент без WAAPI (jsdom, старый браузер): enter и exit мгновенны", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = document.createElement("dialog");
    enter(el, "dialog");
    await expect(exit(el)).resolves.toBeUndefined();
    expect(animate).not.toHaveBeenCalled();
  });

  test("с чанком: окно и панель въезжают пружиной к transform: none, тост уходит вправо за EXIT", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    enter(el, "dialog");
    expect(animate.mock.calls[0][1]).toEqual({ opacity: [0, 1], transform: ["translateY(10px)", "none"] });
    expect(animate.mock.calls[0][2]).toEqual({ type: spring, ...SPRING_ENTER });
    enter(el, "panel");
    expect(animate.mock.calls[1][1]).toEqual({ opacity: [0.4, 1], transform: ["translateX(32px)", "none"] });
    await exit(el, "toast");
    expect(animate.mock.calls[2][1]).toEqual({ opacity: [1, 0], transform: ["none", "translateX(24px)"] });
    expect(animate.mock.calls[2][2]).toEqual(EXIT);
  });

  test("glideTo: первое размещение мгновенно, дальше пружина от прежнего места с поправкой ширины scaleX", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    glideTo(el, box);
    expect(animate).not.toHaveBeenCalled();
    glideTo(el, { x: 100, y: 2, w: 40, h: 30 });
    expect(animate).toHaveBeenCalledWith(el, { transform: ["translate(10px, 2px) scaleX(2)", "translate(100px, 2px) scaleX(1)"] }, { type: spring, ...SPRING });
    glideTo(el, { x: 0, y: 2, w: 40, h: 30 }, { animate: false });
    expect(animate).toHaveBeenCalledTimes(1);
  });

  test("строки списка: базовая линия без движения, новые — enter, больше порога — мгновенно", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const els = new Map<string, HTMLElement>();
    const find = (id: string) => {
      if (!els.has(id)) els.set(id, card());
      return els.get(id);
    };
    const track = createEnterTracker(3);
    expect(track(["a", "b"], find, false)).toBe(0); // первый вызов — всегда базовая линия
    expect(track(["a", "b", "c"], find, false)).toBe(1);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(track(["x", "y"], find, true)).toBe(0); // смена запроса
    expect(track(["x", "y", "1", "2", "3", "4"], find, false)).toBe(0); // догрузили много — без движения
    expect(track(["x", "y", "1", "2", "3", "4", "z"], find, false)).toBe(1);
    setReducedMotion(true);
    expect(track(["x", "q"], find, false)).toBe(0);
    expect(animate).toHaveBeenCalledTimes(2);
  });
});

describe("glideWidth — ширина панели (сайдбар)", () => {
  test("reduced-motion и одинаковая ширина — без анимации; иначе WAAPI по width", () => {
    const { engine } = fakeEngine();
    __resetMotionForTests(async () => engine);
    systemReduce(false);
    const el = card();
    glideWidth(el, 248, 248);
    expect(el.animate).not.toHaveBeenCalled();
    glideWidth(el, 60, 248);
    expect(el.animate).toHaveBeenCalledTimes(1);
    expect((el.animate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ width: ["60px", "248px"] });
    systemReduce(true);
    const other = card();
    glideWidth(other, 60, 248);
    expect(other.animate).not.toHaveBeenCalled();
  });
});

describe("flash", () => {
  test("повторная подсветка отменяет предыдущую, а не накладывается", () => {
    const el = document.createElement("span");
    const cancels: ReturnType<typeof vi.fn>[] = [];
    el.animate = vi.fn(() => {
      const cancel = vi.fn();
      cancels.push(cancel);
      return { cancel, addEventListener: vi.fn() };
    }) as unknown as HTMLElement["animate"];
    flash(el);
    flash(el);
    expect(el.animate).toHaveBeenCalledTimes(2);
    expect(cancels[0]).toHaveBeenCalledTimes(1);
    expect(cancels[1]).not.toHaveBeenCalled();
  });
});

describe("FIX-01: inline-стиль последнего кадра снимается", () => {
  /** Движок, который, как motion/mini, пишет последний кадр в inline-стиль и по завершении резолвит `finished`. */
  function engineWritingFinalFrame() {
    const animate = vi.fn((el: HTMLElement, keyframes: Record<string, unknown[]>) => {
      let resolve!: () => void;
      const finished = new Promise<void>((r) => (resolve = r));
      return {
        cancel: vi.fn(),
        finished,
        finish() {
          for (const [k, v] of Object.entries(keyframes)) el.style.setProperty(k, String(v[v.length - 1]));
          resolve();
        },
      };
    });
    return { engine: { animate, spring } as unknown as Engine, animate };
  }

  test("enter, flipFrom и glideWidth оставляют классам последнее слово; exit — нет (элемент ещё должен быть скрыт)", async () => {
    const { engine, animate } = engineWritingFinalFrame();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const finishAll = () => animate.mock.results.forEach((r) => (r.value as { finish: () => void }).finish());

    const a = card();
    enter(a);
    const b = card();
    flipFrom(b, 0, 0, { lift: false });
    const c = card();
    glideWidth(c, 100, 200);
    const d = card();
    void exit(d);
    finishAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(a.style.opacity).toBe("");
    expect(a.style.transform).toBe("");
    expect(b.style.transform).toBe("");
    expect(c.style.width).toBe("");
    expect(d.style.opacity).toBe("0");
  });

  test("перехваченная новой анимацией: старая не стирает чужие стили", async () => {
    const { engine, animate } = engineWritingFinalFrame();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    enter(el);
    const first = animate.mock.results[0].value as { finish: () => void };
    enter(el); // новая анимация отменяет первую
    first.finish();
    await Promise.resolve();
    await Promise.resolve();
    // вторая ещё идёт: inline-стиль первой не снимался «за неё» и не мешает второй дойти до конца
    expect(animate).toHaveBeenCalledTimes(2);
    (animate.mock.results[1].value as { finish: () => void }).finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(el.style.opacity).toBe("");
  });

  test("отмена (stopMotion / flipFrom поверх glideWidth) не оставляет inline-кадр, даже если анимация успела дойти до конца", async () => {
    const { engine, animate } = engineWritingFinalFrame();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    glideWidth(el, 100, 200);
    const w = animate.mock.results[0].value as { finish: () => void; cancel: ReturnType<typeof vi.fn> };
    w.finish(); // onfinish успел записать width, а finished.then ещё не выполнился…
    expect(el.style.width).toBe("200px");
    stopMotion(el); // …и анимацию перехватили
    expect(w.cancel).toHaveBeenCalled();
    expect(el.style.width).toBe("");
    await Promise.resolve();
    await Promise.resolve();
    expect(el.style.width).toBe("");

    // Прерванная до конца: движок inline не писал — снимать нечего, чужие свойства не трогаем.
    const other = card();
    other.style.opacity = "0.5";
    glideWidth(other, 100, 200);
    stopMotion(other);
    expect(other.style.width).toBe("");
    expect(other.style.opacity).toBe("0.5");
  });
});

describe("FIX-02: личный выключатель — одна точка истины для JS и CSS", () => {
  test("setReducedMotion ставит и снимает data-motion на <html>; userReducedMotion не учитывает систему", () => {
    systemReduce(false);
    __resetMotionForTests();
    expect(document.documentElement.getAttribute("data-motion")).toBeNull();
    setReducedMotion(true);
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduce");
    expect(userReducedMotion()).toBe(true);
    expect(motionReduced()).toBe(true);
    setReducedMotion(false);
    expect(document.documentElement.getAttribute("data-motion")).toBeNull();
    expect(userReducedMotion()).toBe(false);
    expect(motionReduced()).toBe(false);
    // Системная настройка включает motionReduced, но не «личный» выключатель (переключатель в настройках не врёт).
    systemReduce(true);
    expect(motionReduced()).toBe(true);
    expect(userReducedMotion()).toBe(false);
  });
});


describe("delayed FLIP budget (Track O A-04)", () => {
  test.each([220, 1000, Number.POSITIVE_INFINITY, Number.NaN, -20])("fallback delay %s stays finite within 450 ms total", async (delay) => {
    __resetMotionForTests(() => Promise.reject(new Error("offline")));
    await preloadMotion();
    const el = card();
    await flipFrom(el, 0, 0, { delay });
    const options = vi.mocked(el.animate).mock.calls[0][1] as KeyframeAnimationOptions;
    expect(Number.isFinite(options.delay)).toBe(true);
    expect(options.delay).toBeGreaterThanOrEqual(0);
    expect(Number(options.duration) + Number(options.delay)).toBeLessThanOrEqual(450);
  });

  test("delayed spring uses a shorter preset and includes its delay in the 450 ms ceiling", async () => {
    const { engine, animate } = fakeEngine();
    __resetMotionForTests(async () => engine);
    await preloadMotion();
    const el = card();
    await flipFrom(el, 0, 0, { delay: 220 });
    const options = animate.mock.calls[0][2] as typeof SPRING_ENTER & { delay: number };
    expect(options).toMatchObject({ ...SPRING_ENTER, delay: 0.1 });
    const settled = spring.applyToOptions!({ ...SPRING_ENTER }) as { duration: number };
    expect(settled.duration + options.delay * 1000).toBeLessThanOrEqual(450);
  });
});
