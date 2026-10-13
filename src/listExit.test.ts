import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRowMotion } from "./listExit";

const exit = vi.fn(() => Promise.resolve());
const flipFrom = vi.fn(() => Promise.resolve());
vi.mock("./motion", () => ({ exit: (...a: unknown[]) => exit(...(a as [])), flipFrom: (...a: unknown[]) => flipFrom(...(a as [])), motionReduced: () => false }));

let host: HTMLDivElement;
const tops = new Map<string, number>();
function rect(top: number, left = 0, width = 400, height = 40): DOMRect {
  return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}
function row(id: string, top: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "row");
  el.setAttribute("data-issue-id", id);
  el.id = `row-${id}`;
  el.getBoundingClientRect = () => rect(tops.get(id) ?? top);
  tops.set(id, top);
  host.appendChild(el);
  return el;
}

beforeEach(() => {
  host = document.createElement("div");
  host.getBoundingClientRect = () => rect(0);
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  tops.clear();
  exit.mockClear();
  flipFrom.mockClear();
});

test("убранная строка оставляет призрак на старом месте, нижние доезжают", () => {
  const motion = createRowMotion();
  const els: Record<string, HTMLElement> = { a: row("a", 0), b: row("b", 40), c: row("c", 80) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b", "c"], find, true); // базовая линия
  expect(exit).not.toHaveBeenCalled();

  els.b.remove(); // b удалили, c поднялась на 40
  tops.set("c", 40);
  motion(host, ["a", "c"], find, false);

  const ghost = host.querySelector<HTMLElement>(".list-row-ghost")!;
  expect(ghost).toBeTruthy();
  expect(ghost.getAttribute("aria-hidden")).toBe("true");
  expect(ghost.getAttribute("role")).toBeNull();
  expect(ghost.getAttribute("data-issue-id")).toBeNull();
  expect(ghost.querySelector("[id]")).toBeNull();
  expect(ghost.style.top).toBe("40px");
  expect(exit).toHaveBeenCalledTimes(1);
  expect(flipFrom).toHaveBeenCalledTimes(1);
  expect(flipFrom.mock.calls[0]).toEqual([els.c, 0, 80, { lift: false }]); // c ехала с 80 на 40
});

test("базовая линия и список без перемен — без движения", () => {
  const motion = createRowMotion();
  const els: Record<string, HTMLElement> = { a: row("a", 0), b: row("b", 40) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b"], find, true);
  motion(host, ["a", "b"], find, false);
  expect(exit).not.toHaveBeenCalled();
  expect(flipFrom).not.toHaveBeenCalled();
  motion(host, ["a"], find, true); // смена запроса: уход без движения
  expect(host.querySelector(".list-row-ghost")).toBeNull();
});
