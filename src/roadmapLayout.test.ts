import { describe, expect, test } from "vitest";
import { GROUP_H, ROW_H, BAR_TOP, BAR_H, TENTATIVE_DAYS, barSpan, dayKey, isLate, roadmapRange, rowPositions } from "./roadmapLayout";
import { parsePath, pathForView } from "./router";
import type { RoadmapProjectDto } from "../server/src/contract";

const today = new Date(2026, 8, 28); // 28 сентября 2026
const k = (d: Date | null | undefined) => (d ? dayKey(d) : null);
const proj = (over: Partial<RoadmapProjectDto>): RoadmapProjectDto => ({
  id: "p",
  key: "P",
  name: "P",
  departmentId: "d",
  icon: null,
  color: null,
  createdAt: "2026-01-01",
  startDate: null,
  targetDate: null,
  done: 0,
  total: 0,
  milestones: [],
  canEdit: false,
  ...over,
});

describe("полоса проекта (ТЗ 5.15)", () => {
  test("обе даты — вся полоса подтверждена", () => {
    const b = barSpan({ startDate: "2026-10-01", targetDate: "2026-12-15" }, today)!;
    expect([k(b.from), k(b.to), k(b.solidFrom), k(b.solidTo)]).toEqual(["2026-10-01", "2026-12-15", "2026-10-01", "2026-12-15"]);
  });

  test("только начало в прошлом — подтверждено до сегодня, дальше месяц штриховкой", () => {
    const b = barSpan({ startDate: "2026-09-01", targetDate: null }, today)!;
    expect([k(b.solidFrom), k(b.solidTo)]).toEqual(["2026-09-01", "2026-09-28"]);
    expect(k(b.to)).toBe("2026-10-26");
  });

  test("только начало в будущем — подтверждён один день, дальше штриховка", () => {
    const b = barSpan({ startDate: "2026-11-02", targetDate: null }, today)!;
    expect([k(b.solidFrom), k(b.solidTo), k(b.to)]).toEqual(["2026-11-02", "2026-11-02", "2026-11-30"]);
  });

  test("только цель — вся полоса предварительная, месяц до цели; без дат — полосы нет", () => {
    const b = barSpan({ startDate: null, targetDate: "2026-12-01" }, today)!;
    expect([k(b.from), k(b.to), b.solidFrom]).toEqual(["2026-11-03", "2026-12-01", null]);
    expect(TENTATIVE_DAYS).toBe(28);
    expect(barSpan({ startDate: null, targetDate: null }, today)).toBeNull();
  });
});

test("шкала: начинается с понедельника за две недели до самой ранней даты, не короче года", () => {
  const r = roadmapRange([proj({ startDate: "2026-06-10", targetDate: "2026-07-01", milestones: [{ id: "m", name: "m", date: "2027-12-01" }] })], today);
  expect(r.origin.getDay()).toBe(1);
  expect(k(r.origin)).toBe("2026-05-25");
  expect(r.days).toBeGreaterThan(365);
  expect(roadmapRange([], today).days).toBe(365);
});

test("вертикаль строк: заголовок отдела, затем строки; центр полосы", () => {
  const { y, height } = rowPositions([
    { id: "d1", name: "A", projects: [{ id: "a" }, { id: "b" }] },
    { id: "d2", name: "B", projects: [{ id: "c" }] },
  ]);
  expect(y.get("a")).toBe(GROUP_H + BAR_TOP + BAR_H / 2);
  expect(y.get("b")).toBe(GROUP_H + ROW_H + BAR_TOP + BAR_H / 2);
  expect(y.get("c")).toBe(2 * GROUP_H + 2 * ROW_H + BAR_TOP + BAR_H / 2);
  expect(height).toBe(2 * GROUP_H + 3 * ROW_H);
});

test("зависимость опаздывает, если источник заканчивается в день начала зависимого или позже", () => {
  const spans = new Map([
    ["src", barSpan({ startDate: "2026-10-01", targetDate: "2026-11-01" }, today)],
    ["ok", barSpan({ startDate: "2026-11-02", targetDate: "2026-12-01" }, today)],
    ["late", barSpan({ startDate: "2026-11-01", targetDate: "2026-12-01" }, today)],
    ["none", null],
  ]);
  expect(isLate({ sourceId: "src", dependentId: "ok" }, spans)).toBe(false);
  expect(isLate({ sourceId: "src", dependentId: "late" }, spans)).toBe(true);
  expect(isLate({ sourceId: "src", dependentId: "none" }, spans)).toBe(false);
});

test("адрес /roadmap — раздел без проекта", () => {
  expect(pathForView("CORP", "roadmap")).toBe("/roadmap");
  expect(parsePath("/roadmap")).toMatchObject({ kind: "global", view: "roadmap" });
});

test("в DOM — только строки в окне прокрутки с запасом", async () => {
  const { visibleItems } = await import("./roadmapLayout");
  const groups = [
    { id: "d1", name: "A", projects: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })) },
    { id: "d2", name: "B", projects: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` })) },
  ];
  const top = visibleItems(groups, 0, 800, 0);
  expect(top[0]).toMatchObject({ kind: "group", y: 0 });
  expect(top.filter((x) => x.kind === "row").length).toBe(10); // (800 − 36) / 84 → 10 строк
  // Середина второго отдела: его заголовок далеко вверху — не рисуется, строки — с правильным y.
  const mid = visibleItems(groups, 2 * GROUP_H + 70 * ROW_H, 400, 0);
  expect(mid.some((x) => x.kind === "group")).toBe(false);
  expect(mid[0]).toMatchObject({ kind: "row", item: { id: "b20" }, y: 2 * GROUP_H + 70 * ROW_H });
});
