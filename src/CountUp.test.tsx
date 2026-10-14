import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CountUp } from "./CountUp";
import { COUNT_MS, __resetMotionForTests, countTo, setReducedMotion } from "./motion";

/** Ручной rAF: кадры идут только когда тест вызывает `tick(мс)`; время — как у настоящего rAF, отметка кадра. */
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
let clock = 0;
const raf = vi.fn((cb: FrameRequestCallback) => {
  queue.set(nextId, cb);
  return nextId++;
});
const caf = vi.fn((id: number) => void queue.delete(id));
function tick(ms: number) {
  clock += ms;
  const batch = [...queue.values()];
  queue = new Map();
  for (const cb of batch) cb(clock);
}

beforeEach(() => {
  queue = new Map();
  nextId = 1;
  clock = 1000;
  raf.mockClear();
  caf.mockClear();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  __resetMotionForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.removeItem("taskira.reduceMotion");
  } catch {
    /* ignore */
  }
});

const root = (c: HTMLElement) => c.querySelector<HTMLElement>(".count-up")!;
const text = (c: HTMLElement) => c.querySelector(".count-up-text")!.textContent;

test("рост по обновлению: кадры идут к итогу и заканчиваются ровно на нём; текст всё время итоговый", () => {
  const { container, rerender } = render(<CountUp value={10} />);
  expect(raf).not.toHaveBeenCalled(); // первый показ — без движения
  rerender(<CountUp value={20} />);
  expect(raf).toHaveBeenCalledTimes(1);
  expect(text(container)).toBe("20"); // textContent и дерево доступности — итог с первой миллисекунды
  expect(root(container).textContent).toBe("20");
  expect(root(container).hasAttribute("data-counting")).toBe(true);
  expect(root(container).getAttribute("data-shown")).toBe("10");
  tick(0); // первый кадр: t0
  tick(COUNT_MS / 2);
  const mid = Number(root(container).getAttribute("data-shown"));
  expect(mid).toBeGreaterThan(10);
  expect(mid).toBeLessThan(20);
  expect(text(container)).toBe("20");
  tick(COUNT_MS); // дальше конца
  expect(root(container).hasAttribute("data-counting")).toBe(false);
  expect(root(container).hasAttribute("data-shown")).toBe(false);
  expect(queue.size).toBe(0);
  expect(text(container)).toBe("20");
});

test("значения монотонно растут и не превышают итог", () => {
  const el = document.createElement("span");
  const seen: number[] = [];
  countTo(el, 0, 1000, (n) => (seen.push(n), String(n)));
  for (let i = 0; i < 30; i++) tick(16);
  expect(seen.every((n, i) => i === 0 || n >= seen[i - 1])).toBe(true);
  expect(Math.max(...seen)).toBeLessThanOrEqual(1000);
  expect(el.hasAttribute("data-counting")).toBe(false);
});

test("первый показ, убывание и то же значение — мгновенно, без кадров", () => {
  const { container, rerender } = render(<CountUp value={5} />);
  rerender(<CountUp value={3} />);
  rerender(<CountUp value={3} />);
  expect(raf).not.toHaveBeenCalled();
  expect(root(container).hasAttribute("data-counting")).toBe(false);
  expect(text(container)).toBe("3");
});

test("смена resetKey (фильтр/период) — новая точка отсчёта без движения, даже при росте", () => {
  const { container, rerender } = render(<CountUp value={5} resetKey="a" />);
  rerender(<CountUp value={50} resetKey="b" />);
  expect(raf).not.toHaveBeenCalled();
  expect(text(container)).toBe("50");
  rerender(<CountUp value={60} resetKey="b" />); // тот же ключ — обновление данных, растёт
  expect(raf).toHaveBeenCalledTimes(1);
});

test("уменьшенное движение — сразу итог, кадры не запрашиваются", () => {
  setReducedMotion(true);
  const { container, rerender } = render(<CountUp value={1} />);
  rerender(<CountUp value={9} />);
  expect(raf).not.toHaveBeenCalled();
  expect(root(container).hasAttribute("data-counting")).toBe(false);
  expect(text(container)).toBe("9");
});

test("системный prefers-reduced-motion — тоже сразу", () => {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const { rerender } = render(<CountUp value={1} />);
  rerender(<CountUp value={9} />);
  expect(raf).not.toHaveBeenCalled();
});

test("размонтирование отменяет кадр и не оставляет атрибутов", () => {
  const { container, rerender, unmount } = render(<CountUp value={1} />);
  rerender(<CountUp value={9} />);
  const el = root(container);
  expect(queue.size).toBe(1);
  unmount();
  expect(caf).toHaveBeenCalledTimes(1);
  expect(queue.size).toBe(0);
  expect(el.hasAttribute("data-counting")).toBe(false);
});

test("новое обновление во время счёта отменяет прежний кадр, итог — последний", () => {
  const { container, rerender } = render(<CountUp value={1} />);
  rerender(<CountUp value={9} />);
  tick(0);
  rerender(<CountUp value={20} />);
  expect(caf).toHaveBeenCalledTimes(1);
  expect(queue.size).toBe(1);
  tick(0);
  tick(COUNT_MS * 2);
  expect(root(container).hasAttribute("data-counting")).toBe(false);
  expect(text(container)).toBe("20");
});

test("обновление во время счёта продолжает с видимого числа, а не с прежней цели", () => {
  const { container, rerender } = render(<CountUp value={10} />);
  rerender(<CountUp value={20} />);
  tick(0);
  tick(COUNT_MS / 3);
  const shown = Number(root(container).getAttribute("data-shown"));
  expect(shown).toBeGreaterThan(10);
  expect(shown).toBeLessThan(20);
  rerender(<CountUp value={25} />); // пока считали 10 → 20
  expect(root(container).getAttribute("data-shown")).toBe(String(shown)); // старт с видимого, не с 20
  tick(0);
  tick(COUNT_MS * 2);
  expect(root(container).hasAttribute("data-counting")).toBe(false);
  expect(text(container)).toBe("25");
  // после завершения новая отправная точка — прежняя цель, а не «застрявший» кадр
  rerender(<CountUp value={30} />);
  expect(root(container).getAttribute("data-shown")).toBe("25");
});

test("format применяется и к тексту, и к кадрам", () => {
  const f = (n: number) => `${n} шт.`;
  const { container, rerender } = render(<CountUp value={1} format={f} />);
  rerender(<CountUp value={4} format={f} />);
  expect(text(container)).toBe("4 шт.");
  expect(root(container).getAttribute("data-shown")).toBe("1 шт.");
});
