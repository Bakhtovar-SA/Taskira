import { describe, expect, test } from "vitest";
import { addDays, daysBetween, scaleTicks, startOfWeek, timeScale } from "./timeScale";

const f = {
  day: (d: Date) => String(d.getDate()),
  month: (d: Date) => String(d.getMonth() + 1).padStart(2, "0"),
  year: (d: Date) => String(d.getFullYear()),
  quarter: (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1}`,
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("timeScale", () => {
  test("дни и понедельник — календарные, переход на летнее время не сбивает счёт", () => {
    expect(daysBetween(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2);
    expect(ymd(startOfWeek(new Date(2026, 8, 27)))).toBe("2026-09-21"); // воскресенье → понедельник той же недели
    expect(ymd(startOfWeek(new Date(2026, 8, 21)))).toBe("2026-09-21");
  });

  test("x — дни от начала × px/день; ширина — вся шкала", () => {
    const s = timeScale(new Date(2026, 8, 21, 15), 364, "week");
    expect(s.x(new Date(2026, 8, 21))).toBe(0);
    expect(s.x(addDays(s.origin, 7))).toBe(56); // неделя = 56 px, как было
    expect(s.width).toBe(364 * 8);
  });

  test("неделя: мелкие деления — понедельники, крупные — месяцы с хвостом от левого края и годом у января", () => {
    const s = timeScale(new Date(2026, 8, 21), 364, "week");
    const { major, minor } = scaleTicks(s, "week", f);
    expect(minor).toHaveLength(52);
    expect(minor.slice(0, 2).map((t) => [t.x, t.w, t.label])).toEqual([[0, 56, "21"], [56, 56, "28"]]);
    expect(major[0]).toMatchObject({ x: 0, label: "09 2026" });
    expect(ymd(major[1].date)).toBe("2026-10-01");
    expect(major[0].w).toBe(major[1].x);
    expect(major.find((t) => t.date.getMonth() === 0)?.label).toBe("01 2027");
    // отрезки встык и до конца шкалы
    for (const list of [major, minor]) {
      list.slice(1).forEach((t, i) => expect(t.x).toBe(list[i].x + list[i].w));
      expect(list[list.length - 1].x + list[list.length - 1].w).toBe(s.width);
    }
  });

  test("месяцы и кварталы: крупные деления — годы", () => {
    const s = timeScale(new Date(2026, 8, 21), 500, "month");
    const m = scaleTicks(s, "month", f);
    expect(m.minor.slice(0, 3).map((t) => t.label)).toEqual(["09", "10", "11"]);
    expect(m.major.map((t) => t.label)).toEqual(["2026", "2027", "2028"]);
    const q = scaleTicks(timeScale(new Date(2026, 8, 21), 500, "quarter"), "quarter", f);
    expect(q.minor.map((t) => t.label)).toEqual(["Q3", "Q4", "Q1", "Q2", "Q3", "Q4", "Q1"]);
    expect(ymd(q.minor[1].date)).toBe("2026-10-01");
  });
});
