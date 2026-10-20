import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRowMotion as createMotion } from "./listExit";
import { MOTION_CAPS } from "./motion";
const motions: ReturnType<typeof createMotion>[] = [];
const createRowMotion = () => { const motion = createMotion(); motions.push(motion); return motion; };

const exit = vi.fn(() => Promise.resolve());
const flipFrom = vi.fn((..._args: unknown[]) => Promise.resolve());
let reduced = false;
vi.mock("./motion", async importOriginal => ({ ...(await importOriginal<typeof import("./motion")>()), cssZoom: () => 1, stopMotion: vi.fn(), exit: (...a: unknown[]) => exit(...(a as [])), flipFrom: (...a: unknown[]) => flipFrom(...(a as [])), motionReduced: () => reduced }));

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
  reduced = false;
  host = document.createElement("div");
  host.getBoundingClientRect = () => rect(0);
  document.body.appendChild(host);
});
afterEach(() => {
  for (const motion of motions.splice(0)) motion.dispose();
  host.remove();
  tops.clear();
  exit.mockReset().mockResolvedValue(undefined);
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

test("строка в полёте: повторный commit не сравнивает середину пути с итогом и не отменяет пружину", () => {
  const motion = createRowMotion();
  const els: Record<string, HTMLElement> = { a: row("a", 0), b: row("b", 40) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b"], find, true);
  tops.set("b", 0); // b переехала наверх: первый commit запускает сдвиг
  tops.set("a", 40);
  motion(host, ["b", "a"], find, false);
  expect(flipFrom).toHaveBeenCalledTimes(2);
  flipFrom.mockClear();

  // Второй commit (ревалидация): строки ещё анимируются, rect показывает середину пути.
  const spring = { effect: { getKeyframes: () => [{ transform: "translate(0px, 20px)" }, { transform: "none" }] } };
  for (const id of ["a", "b"]) els[id].getAnimations = () => [spring] as unknown as Animation[];
  tops.set("b", 25);
  tops.set("a", 15);
  motion(host, ["b", "a"], find, false);
  expect(flipFrom).not.toHaveBeenCalled();
});

test("призрак не несёт id/name/for/form живых элементов", () => {
  const motion = createRowMotion();
  const a = row("a", 0);
  a.innerHTML = '<label for="x">L</label><input id="x" name="n" form="f">';
  const els: Record<string, HTMLElement> = { a, b: row("b", 40) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b"], find, true);
  a.remove();
  motion(host, ["b"], find, false);
  const ghost = host.querySelector<HTMLElement>(".list-row-ghost")!;
  expect(ghost.querySelector("[id], [name], [for], [form]")).toBeNull();
  expect(ghost.hasAttribute("id")).toBe(false);
});

test("призрак сохраняет отметку чекбокса", () => {
  const motion = createRowMotion();
  const a = row("a", 0);
  a.innerHTML = '<input type="checkbox">';
  (a.querySelector("input") as HTMLInputElement).checked = true;
  const els: Record<string, HTMLElement> = { a, b: row("b", 40) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b"], find, true);
  a.remove();
  motion(host, ["b"], find, false);
  expect((host.querySelector(".list-row-ghost input") as HTMLInputElement).checked).toBe(true);
});

test("переход цвета (не transform) не считается движением строки: положение мерится заново", () => {
  const motion = createRowMotion();
  const els: Record<string, HTMLElement> = { a: row("a", 0), b: row("b", 40) };
  const find = (id: string) => els[id];
  motion(host, ["a", "b"], find, true);
  const hover = { effect: { getKeyframes: () => [{ backgroundColor: "red" }, { backgroundColor: "blue" }] } };
  for (const id of ["a", "b"]) els[id].getAnimations = () => [hover] as unknown as Animation[];
  tops.set("b", 0);
  tops.set("a", 40);
  motion(host, ["b", "a"], find, false);
  expect(flipFrom).toHaveBeenCalledTimes(2);
});

for (const count of [MOTION_CAPS.flip, MOTION_CAPS.flip + 1]) test("visible FLIP ceiling: " + count, () => {
  const motion = createRowMotion();
  const els = Array.from({ length: count }, (_, index) => row('r' + index, 0));
  const ids = els.map(el => el.dataset.issueId!);
  const find = (id: string) => els.find(el => el.dataset.issueId === id);
  motion(host, ids, find, true);
  for (const id of ids) tops.set(id, 1);
  motion(host, ids, find, false);
  expect(flipFrom).toHaveBeenCalledTimes(count <= MOTION_CAPS.flip ? count : 0);
});

test("offscreen rows and removed offscreen ghosts do not animate", () => {
  const motion = createRowMotion();
  const els = { a: row('a', 900), b: row('b', 950) };
  motion(host, ['a', 'b'], id => els[id as keyof typeof els], true);
  els.a.remove(); tops.set('b', 910);
  motion(host, ['b'], id => els[id as keyof typeof els], false);
  expect(exit).not.toHaveBeenCalled(); expect(flipFrom).not.toHaveBeenCalled();
});

test("a clipped scroll ancestor limits visible row movement", () => {
  const clip = document.createElement('div'); clip.style.overflowY = 'auto';
  clip.getBoundingClientRect = () => rect(0, 0, 400, 80);
  document.body.appendChild(clip); clip.appendChild(host);
  const motion = createRowMotion(), els = { a: row('a', 0), b: row('b', 120) };
  motion(host, ['a', 'b'], id => els[id as keyof typeof els], true);
  tops.set('a', 10); tops.set('b', 100);
  motion(host, ['a', 'b'], id => els[id as keyof typeof els], false);
  expect(flipFrom).toHaveBeenCalledTimes(1); expect(flipFrom.mock.calls[0][0]).toBe(els.a);
  clip.remove();
});

test("above tracking ceiling there are no DOM reads or animations", () => {
  const motion = createRowMotion(), find = vi.fn();
  motion(host, Array.from({ length: MOTION_CAPS.track + 1 }, (_, i) => String(i)), find, true);
  expect(find).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled(); expect(flipFrom).not.toHaveBeenCalled();
});

test("ghost budget is shared across overlapping commits and disposal removes them", () => {
  exit.mockImplementation(() => new Promise<void>(() => undefined));
  const motion = createRowMotion();
  const els = Array.from({ length: 8 }, (_, i) => row(String(i), i * 40));
  const find = (id: string) => els[Number(id)];
  motion(host, els.map((_, i) => String(i)), find, true);
  for (let i = 0; i < 7; i++) {
    els[i].remove();
    motion(host, els.slice(i + 1).map(el => el.dataset.issueId!), find, false);
  }
  expect(host.querySelectorAll('.list-row-ghost')).toHaveLength(MOTION_CAPS.ghosts);
  expect(exit).toHaveBeenCalledTimes(MOTION_CAPS.ghosts);
  motion.dispose(); expect(host.querySelectorAll('.list-row-ghost')).toHaveLength(0);
});

for (const reducedMotion of [false, true]) test("removed focused row focuses its next live neighbor, reduced=" + reducedMotion, () => {
  reduced = reducedMotion;
  const motion = createRowMotion();
  const els = { a: row('a', 0), b: row('b', 40), c: row('c', 80) };
  for (const el of Object.values(els)) el.innerHTML = '<button>Open</button>';
  const find = (id: string) => els[id as keyof typeof els];
  motion(host, ['a', 'b', 'c'], find, true);
  els.b.querySelector('button')!.focus(); els.b.remove();
  motion(host, ['a', 'c'], find, false);
  expect(document.activeElement).toBe(els.c.querySelector('button'));
  if (reducedMotion) { expect(exit).not.toHaveBeenCalled(); expect(flipFrom).not.toHaveBeenCalled(); }
});

test("focus moved elsewhere during a delayed action is not stolen", () => {
  const motion = createRowMotion(), a = row('a', 0), b = row('b', 40);
  a.innerHTML = '<button>Open</button>'; b.innerHTML = '<button>Open</button>';
  motion(host, ['a', 'b'], id => id === 'a' ? a : b, true);
  a.querySelector('button')!.focus();
  const outside = document.createElement('button'); document.body.appendChild(outside); outside.focus(); a.remove();
  motion(host, ['b'], () => b, false);
  expect(document.activeElement).toBe(outside); outside.remove();
});

test("Inbox ghosts lose every live-row selector but preserve their visual shell", () => {
  const motion = createRowMotion(), a = row('a', 0), b = row('b', 40);
  a.className = 'inbox-row'; a.setAttribute('data-enter-id', 'a'); a.setAttribute('data-row', '0');
  a.innerHTML = '<button data-enter-id="nested" data-row="0">Open</button>';
  motion(host, ['a', 'b'], id => id === 'a' ? a : b, true);
  a.remove(); motion(host, ['b'], () => b, false);
  const ghost = host.querySelector('.list-row-ghost')!;
  expect(ghost.classList.contains('inbox-row-ghost')).toBe(true);
  expect(ghost.matches('.inbox-row, [data-enter-id], [data-row], [role]')).toBe(false);
  expect(ghost.querySelector('[data-enter-id], [data-row], [role]')).toBeNull();
});

test("a list below the tracking ceiling rebases after an oversized update", () => {
  const motion = createRowMotion(), a = row('a', 0), find = () => a;
  motion(host, ['a'], find, true);
  tops.set('a', 100);
  motion(host, Array.from({ length: MOTION_CAPS.track + 1 }, (_, i) => String(i)), find, false);
  tops.set('a', 200); motion(host, ['a'], find, false);
  expect(flipFrom).not.toHaveBeenCalled();
  tops.set('a', 240); motion(host, ['a'], find, false);
  expect(flipFrom.mock.calls).toEqual([[a, 0, 200, { lift: false }]]);
});

test("removing the focused last row focuses the previous live row", () => {
  const motion = createRowMotion(), a = row('a', 0), b = row('b', 40);
  a.innerHTML = '<button>Open</button>'; b.innerHTML = '<button>Open</button>';
  motion(host, ['a', 'b'], id => id === 'a' ? a : b, true);
  b.querySelector('button')!.focus(); b.remove();
  motion(host, ['a'], () => a, false);
  expect(document.activeElement).toBe(a.querySelector('button'));
});
