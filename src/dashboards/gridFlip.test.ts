// NEW-05: FLIP виджетов дашборда в режиме правки — доезжают только соседи, ведомый указателем идёт без анимации.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flipFrom, motionReduced, stopMotion } from "../motion";
import { createGridFlip, MAX_TRACKED } from "./gridFlip";

vi.mock("../motion", () => ({ cssZoom: () => 1, flipFrom: vi.fn(() => Promise.resolve()), motionReduced: vi.fn(() => false), stopMotion: vi.fn() }));
// Настоящий stopMotion снимает идущую анимацию — у виджета пропадает сдвиг.
vi.mocked(stopMotion).mockImplementation((e) => void moving.delete((e as HTMLElement).dataset.widget!));

const GRID = { left: 100, top: 50, width: 1200 };
/** Положение «в раскладке» (относительно сетки) и сдвиг идущей анимации — то, что вернёт getBoundingClientRect. */
const pos = new Map<string, { left: number; top: number }>();
const shift = new Map<string, { dx: number; dy: number }>();
const moving = new Set<string>();

function grid(ids: string[]) {
  const root = document.createElement("div");
  root.getBoundingClientRect = () => ({ left: GRID.left, top: GRID.top, width: GRID.width }) as DOMRect;
  for (const id of ids) {
    const el = document.createElement("section");
    el.dataset.widget = id;
    el.getBoundingClientRect = () => {
      const p = pos.get(id) ?? { left: 0, top: 0 };
      const s = moving.has(id) ? shift.get(id) : undefined;
      return { left: GRID.left + p.left + (s?.dx ?? 0), top: GRID.top + p.top + (s?.dy ?? 0) } as DOMRect;
    };
    el.getAnimations = (() => (moving.has(id) ? [{ effect: { getKeyframes: () => [{ transform: "none" }] } }] : [])) as never;
    root.appendChild(el);
  }
  document.body.appendChild(root);
  return root;
}
const el = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-widget="${id}"]`)!;
const box = (id: string, x: number, y: number, w = 4, h = 2) => ({ id, x, y, w, h });

beforeEach(() => {
  pos.clear();
  shift.clear();
  moving.clear();
  GRID.width = 1200;
  vi.mocked(flipFrom).mockClear();
  vi.mocked(stopMotion).mockClear();
  vi.mocked(motionReduced).mockReturnValue(false);
});
afterEach(() => {
  document.body.innerHTML = "";
});

test("первый вызов — базовая линия; сдвинутый сосед едет со старого места без «подъёма»", () => {
  pos.set("a", { left: 0, top: 0 }).set("b", { left: 0, top: 200 });
  const root = grid(["a", "b"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0), box("b", 0, 2)], null);
  expect(flipFrom).not.toHaveBeenCalled();
  // «a» растянули/подвинули — «b» съехал вниз на 100 px.
  pos.set("b", { left: 0, top: 300 });
  flip(root, [box("a", 0, 0), box("b", 0, 3)], null);
  expect(vi.mocked(flipFrom).mock.calls).toEqual([[el(root, "b"), GRID.left, GRID.top + 200, { lift: false }]]);
});

test("виджет, которого ведёт указатель, не анимируется, но запоминает новое место", () => {
  pos.set("a", { left: 0, top: 0 }).set("b", { left: 400, top: 0 });
  const root = grid(["a", "b"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0), box("b", 4, 0)], null);
  pos.set("a", { left: 400, top: 0 }).set("b", { left: 0, top: 0 });
  flip(root, [box("a", 4, 0), box("b", 0, 0)], "a");
  expect(vi.mocked(flipFrom).mock.calls.map((c) => c[0])).toEqual([el(root, "b")]);
  // Отпустили: коммит без сдвига ничего не проигрывает.
  flip(root, [box("a", 4, 0), box("b", 0, 0)], null);
  expect(flipFrom).toHaveBeenCalledTimes(1);
});

test("растягиваемый виджет (изменился размер) не анимируется, сосед — да", () => {
  pos.set("a", { left: 0, top: 0 }).set("b", { left: 0, top: 120 });
  const root = grid(["a", "b"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0, 4, 2), box("b", 0, 2)], null);
  pos.set("b", { left: 0, top: 240 });
  flip(root, [box("a", 0, 0, 4, 4), box("b", 0, 4)], null);
  expect(vi.mocked(flipFrom).mock.calls.map((c) => c[0])).toEqual([el(root, "b")]);
});

test("клавиатурный сдвиг (active = null): сам виджет тоже доезжает", () => {
  pos.set("a", { left: 0, top: 0 });
  const root = grid(["a"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0)], null);
  pos.set("a", { left: 400, top: 0 });
  flip(root, [box("a", 4, 0)], null);
  expect(flipFrom).toHaveBeenCalledWith(el(root, "a"), GRID.left, GRID.top, { lift: false });
});

test("виджет в полёте: берётся видимое место, идущая пружина снимается перед замером", () => {
  pos.set("b", { left: 0, top: 100 });
  const root = grid(["b"]);
  const flip = createGridFlip();
  flip(root, [box("b", 0, 1)], null);
  // Новая клетка (top 300), но виджет ещё едет и виден на 40 px выше своей раскладки.
  pos.set("b", { left: 0, top: 300 });
  moving.add("b");
  shift.set("b", { dx: 0, dy: -40 });
  flip(root, [box("b", 0, 3)], null);
  expect(stopMotion).toHaveBeenCalledWith(el(root, "b"));
  // Старая раскладка (100) + текущий сдвиг (-40) = видимое место 60 от угла сетки.
  expect(flipFrom).toHaveBeenCalledWith(el(root, "b"), GRID.left, GRID.top + 60, { lift: false });
});

test("новый виджет не анимируется (его появление — не сдвиг), сосед поджимается", () => {
  pos.set("a", { left: 0, top: 0 }).set("b", { left: 0, top: 120 });
  const root = grid(["a", "b"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0), box("b", 0, 2)], null);
  root.removeChild(el(root, "a"));
  pos.set("b", { left: 0, top: 0 });
  flip(root, [box("b", 0, 0)], null);
  expect(vi.mocked(flipFrom).mock.calls).toEqual([[el(root, "b"), GRID.left, GRID.top + 120, { lift: false }]]);
  const added = grid(["c"]);
  pos.set("c", { left: 0, top: 500 });
  createGridFlip()(added, [box("c", 0, 5)], null);
  expect(flipFrom).toHaveBeenCalledTimes(1);
});

test("ширина сетки изменилась — только запоминаем, ничего не анимируем", () => {
  pos.set("a", { left: 0, top: 0 });
  const root = grid(["a"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0)], null);
  GRID.width = 900;
  pos.set("a", { left: 300, top: 0 });
  flip(root, [box("a", 4, 0)], null);
  expect(flipFrom).not.toHaveBeenCalled();
});

test("не режим правки (grid = null) сбрасывает базовую линию", () => {
  pos.set("a", { left: 0, top: 0 });
  const root = grid(["a"]);
  const flip = createGridFlip();
  flip(root, [box("a", 0, 0)], null);
  flip(null, [box("a", 0, 0)], null);
  pos.set("a", { left: 400, top: 0 });
  flip(root, [box("a", 4, 0)], null); // базовая линия заново
  expect(flipFrom).not.toHaveBeenCalled();
});

test("reduced-motion и слишком много виджетов — без анимации и без измерений", () => {
  const ids = Array.from({ length: MAX_TRACKED + 1 }, (_, i) => `w${i}`);
  ids.forEach((id, i) => pos.set(id, { left: 0, top: i * 10 }));
  const root = grid(ids);
  const spy = vi.spyOn(root, "getBoundingClientRect");
  const flip = createGridFlip();
  flip(root, ids.map((id, i) => box(id, 0, i)), null);
  ids.forEach((id, i) => pos.set(id, { left: 0, top: i * 10 + 5 }));
  flip(root, ids.map((id, i) => box(id, 0, i + 1)), null);
  expect(flipFrom).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();

  vi.mocked(motionReduced).mockReturnValue(true);
  pos.set("a", { left: 0, top: 0 });
  const small = grid(["a"]);
  const f2 = createGridFlip();
  f2(small, [box("a", 0, 0)], null);
  pos.set("a", { left: 400, top: 0 });
  f2(small, [box("a", 4, 0)], null);
  expect(flipFrom).not.toHaveBeenCalled();
});
