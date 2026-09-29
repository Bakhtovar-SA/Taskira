import { describe, expect, test } from "vitest";
import { cellAt, collides, compact, firstFit, moveTo, nudge, resizeTo, spanFor, type Box } from "./grid";

const b = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });
const at = (items: Box[], id: string) => items.find((i) => i.id === id)!;
const noOverlap = (items: Box[]) => items.every((a) => items.every((c) => !collides(a, c)));

describe("сетка дашборда", () => {
  test("compact поднимает виджеты вверх до первого препятствия и сохраняет порядок массива", () => {
    const out = compact([b("a", 0, 5, 6, 2), b("b", 0, 9, 6, 3), b("c", 6, 4, 6, 2)]);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(at(out, "a").y).toBe(0);
    expect(at(out, "b").y).toBe(2);
    expect(at(out, "c").y).toBe(0);
  });

  test("перенос на занятое место сдвигает мешающий вниз, перекрытий нет", () => {
    const items = [b("a", 0, 0, 6, 2), b("b", 6, 0, 6, 2), b("c", 0, 2, 12, 3)];
    const out = moveTo(items, "c", 0, 0);
    expect(at(out, "c").y).toBe(0);
    expect(at(out, "a").y).toBe(3);
    expect(at(out, "b").y).toBe(3);
    expect(noOverlap(out)).toBe(true);
  });

  test("перенос не выпускает виджет за 12 колонок", () => {
    const out = moveTo([b("a", 0, 0, 4, 2)], "a", 11, 0);
    expect(at(out, "a").x).toBe(8);
  });

  test("изменение размера ограничено сеткой и высотой 1–8", () => {
    let out = resizeTo([b("a", 8, 0, 4, 2)], "a", 20, 20);
    expect(at(out, "a")).toMatchObject({ x: 0, w: 12, h: 8 });
    out = resizeTo([b("a", 0, 0, 4, 2)], "a", 0, 0);
    expect(at(out, "a")).toMatchObject({ w: 1, h: 1 });
  });

  test("растянутый виджет отодвигает соседа вниз", () => {
    const out = resizeTo([b("a", 0, 0, 6, 2), b("b", 6, 0, 6, 2)], "a", 8, 2);
    expect(at(out, "a").w).toBe(8);
    expect(at(out, "b").y).toBe(2);
    expect(noOverlap(out)).toBe(true);
  });

  test("клавиатура: стрелка вниз меняет местами с соседом снизу, вверх — обратно; Shift меняет размер", () => {
    const items = [b("a", 0, 0, 12, 2), b("b", 0, 2, 12, 3)];
    const down = nudge(items, "a", "ArrowDown", false)!;
    expect(at(down, "b").y).toBe(0);
    expect(at(down, "a").y).toBe(3);
    const up = nudge(down, "a", "ArrowUp", false)!;
    expect(at(up, "a").y).toBe(0);
    expect(at(up, "b").y).toBe(2);
    const wider = nudge([b("a", 0, 0, 4, 2)], "a", "ArrowRight", true)!;
    expect(at(wider, "a").w).toBe(5);
    expect(nudge(items, "a", "Enter", false)).toBeNull();
  });

  test("новый виджет встаёт в первое свободное место", () => {
    expect(firstFit([b("a", 0, 0, 6, 2)], 6, 2)).toEqual({ x: 6, y: 0 });
    expect(firstFit([b("a", 0, 0, 12, 2)], 4, 2)).toEqual({ x: 0, y: 2 });
  });

  test("клетка под указателем и размер в клетках считаются с учётом зазора", () => {
    // 12 колонок по 88 px + 11 зазоров по 12 px = 1188 px
    expect(cellAt(0, 0, 1188, 56, 12)).toEqual({ col: 0, row: 0 });
    expect(cellAt(100, 70, 1188, 56, 12)).toEqual({ col: 1, row: 1 });
    expect(cellAt(5000, 0, 1188, 56, 12).col).toBe(11);
    expect(spanFor(88 * 3 + 24, 56 * 2 + 12, 1188, 56, 12)).toEqual({ w: 3, h: 2 });
  });
});
