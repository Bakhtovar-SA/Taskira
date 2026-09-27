import { describe, expect, test } from "vitest";
import { parseDateInput } from "./dateParse";

// 2026-09-26 — суббота
const T = "2026-09-26";

describe("parseDateInput", () => {
  test("слова", () => {
    expect(parseDateInput("сегодня", T)).toBe("2026-09-26");
    expect(parseDateInput("Завтра", T)).toBe("2026-09-27");
    expect(parseDateInput("послезавтра", T)).toBe("2026-09-28");
    expect(parseDateInput("tomorrow", T)).toBe("2026-09-27");
  });
  test("относительные", () => {
    expect(parseDateInput("+3", T)).toBe("2026-09-29");
    expect(parseDateInput("через 3 дня", T)).toBe("2026-09-29");
    expect(parseDateInput("через неделю", T)).toBe("2026-10-03");
    expect(parseDateInput("+2н", T)).toBe("2026-10-10");
    expect(parseDateInput("in 2 weeks", T)).toBe("2026-10-10");
    expect(parseDateInput("через месяц", T)).toBe("2026-10-26");
  });
  test("день недели — ближайший следующий, сегодняшний — через неделю", () => {
    expect(parseDateInput("пт", T)).toBe("2026-10-02");
    expect(parseDateInput("понедельник", T)).toBe("2026-09-28");
    expect(parseDateInput("сб", T)).toBe("2026-10-03");
    expect(parseDateInput("fri", T)).toBe("2026-10-02");
  });
  test("числа и месяцы; без года — ближайшая будущая", () => {
    expect(parseDateInput("15.10", T)).toBe("2026-10-15");
    expect(parseDateInput("15.01", T)).toBe("2027-01-15");
    expect(parseDateInput("15.10.27", T)).toBe("2027-10-15");
    expect(parseDateInput("2026-12-31", T)).toBe("2026-12-31");
    expect(parseDateInput("15 окт", T)).toBe("2026-10-15");
    expect(parseDateInput("3 марта 2027", T)).toBe("2027-03-03");
    expect(parseDateInput("oct 15", T)).toBe("2026-10-15");
  });
  test("мусор и несуществующие даты — null", () => {
    expect(parseDateInput("", T)).toBeNull();
    expect(parseDateInput("когда-нибудь", T)).toBeNull();
    expect(parseDateInput("31.02", T)).toBeNull();
    expect(parseDateInput("2026-13-01", T)).toBeNull();
  });
});
