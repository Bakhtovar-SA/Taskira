import { afterEach, describe, expect, test, vi } from "vitest";
import { RecurrenceSchedule } from "../src/contract.js";
import { assertValidTiming, localDateOf, nextOccurrence, occurrencesBetween, zonedToUtc, type RuleTiming } from "../src/services/recurrence.js";

const timing = (schedule: RecurrenceSchedule = { kind: "daily", every: 1 }, overrides: Partial<RuleTiming> = {}): RuleTiming =>
  ({ schedule, timeOfDay: "09:00", timeZone: "Europe/Moscow", startDate: "2026-10-01", ...overrides });
const next = (t: RuleTiming, after: string) => nextOccurrence(t, new Date(after)).toISOString();
const between = (t: RuleTiming, from: string, to: string, limit = 100) =>
  occurrencesBetween(t, new Date(from), new Date(to), limit).map(d => d.toISOString());
afterEach(() => vi.useRealTimers());

describe("календарные наступления", () => {
  test("местная дата учитывает пояс и переход через полночь", () => {
    expect(localDateOf(new Date("2026-10-01T22:00:00Z"), "Europe/Moscow")).toBe("2026-10-02");
  });
  test("ежедневно: наступление строго позже after", () => {
    expect(next(timing(), "2026-10-04T05:00Z")).toBe("2026-10-04T06:00:00.000Z");
    expect(next(timing(), "2026-10-04T06:00Z")).toBe("2026-10-05T06:00:00.000Z");
  });
  test("каждые три дня отсчитываются от даты начала", () => {
    expect(between(timing({ kind: "daily", every: 3 }), "2026-10-01T00:00Z", "2026-10-07T23:59Z"))
      .toEqual(["2026-10-01T06:00:00.000Z", "2026-10-04T06:00:00.000Z", "2026-10-07T06:00:00.000Z"]);
  });
  test("будни: после пятничного наступления следующий понедельник", () => {
    expect(next(timing({ kind: "weekly", every: 1, weekdays: [1, 2, 3, 4, 5] }), "2026-10-09T07:00Z"))
      .toBe("2026-10-12T06:00:00.000Z");
  });
  test("каждые две недели: неделя старта нулевая, даты до старта исключены", () => {
    expect(between(timing({ kind: "weekly", every: 2, weekdays: [1] }, { startDate: "2026-10-07" }),
      "2026-10-01T00:00Z", "2026-11-03T00:00Z"))
      .toEqual(["2026-10-19T06:00:00.000Z", "2026-11-02T06:00:00.000Z"]);
  });
  test("31-е число сокращается до последнего дня короткого месяца", () => {
    expect(between(timing({ kind: "monthly", every: 1, day: 31 }), "2027-01-31T06:00:00.001Z", "2027-04-01T00:00Z"))
      .toEqual(["2027-02-28T06:00:00.000Z", "2027-03-31T06:00:00.000Z"]);
  });
  test("последний день високосного февраля", () => {
    expect(next(timing({ kind: "monthly", every: 1, day: "last" }), "2028-02-01T00:00Z"))
      .toBe("2028-02-29T06:00:00.000Z");
  });
  test("месяцы отсчитываются от старта через границу года", () => {
    expect(between(timing({ kind: "monthly", every: 3, day: 1 }, { startDate: "2026-11-01" }),
      "2026-11-01T00:00Z", "2027-03-01T00:00Z"))
      .toEqual(["2026-11-01T06:00:00.000Z", "2027-02-01T06:00:00.000Z"]);
    expect(next(timing({ kind: "weekly", every: 1, weekdays: [7] }), "2026-12-31T00:00Z"))
      .toBe("2027-01-03T06:00:00.000Z");
  });
  test.each([
    ["2027-03-28", "02:30", "Europe/Berlin", "2027-03-28T01:00:00.000Z"],
    ["2026-10-25", "02:30", "Europe/Berlin", "2026-10-25T00:30:00.000Z"],
    ["2027-03-14", "02:30", "America/New_York", "2027-03-14T07:00:00.000Z"],
    ["2026-10-04", "02:15", "Australia/Lord_Howe", "2026-10-03T15:30:00.000Z"],
    ["2011-12-30", "12:00", "Pacific/Apia", "2011-12-30T10:00:00.000Z"],
  ])("перевод %s %s (%s)", (date, time, zone, expected) => {
    expect(zonedToUtc(date, time, zone).toISOString()).toBe(expected);
  });
  test("повтор часа не создаёт второго наступления в тот же день", () => {
    expect(next(timing(undefined, { timeZone: "Europe/Berlin", timeOfDay: "02:30" }), "2026-10-25T00:30Z"))
      .toBe("2026-10-26T01:30:00.000Z");
  });
  test("диапазон включителен, результат ограничен и отсортирован", () => {
    const t = timing(), from = "2026-10-01T06:00Z", to = "2026-10-10T06:00Z";
    const all = between(t, from, to);
    expect(all).toHaveLength(10); expect(all).toEqual([...all].sort());
    expect(all[0]).toBe("2026-10-01T06:00:00.000Z"); expect(all[9]).toBe("2026-10-10T06:00:00.000Z");
    expect(between(t, from, to, 3)).toEqual(all.slice(0, 3));
    expect(between(t, from, to, 0)).toEqual([]); expect(between(t, to, from)).toEqual([]);
  });
  test("старое правило продолжает работать за пределами окна создания", () => {
    expect(next(timing(undefined, { startDate: "2020-01-01" }), "2026-10-04T05:00Z")).toBe("2026-10-04T06:00:00.000Z");
  });
});

describe("валидация расписания", () => {
  test.each([
    { timeZone: "Unknown/Zone" }, { timeOfDay: "24:00" }, { timeOfDay: "9:00" },
    { startDate: "2027-02-29" }, { startDate: "2026-02-30" }, { startDate: "2025-10-05" }, { startDate: "2031-10-07" },
    { schedule: { kind: "weekly", every: 1, weekdays: [] } },
    { schedule: { kind: "weekly", every: 1, weekdays: [1, 1] } },
    { schedule: { kind: "daily", every: 0 } }, { schedule: { kind: "monthly", every: 1, day: 32 } },
  ] as Partial<RuleTiming>[]) ("отклоняет %j кодом VALIDATION", overrides => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T09:00Z"));
    expect(() => assertValidTiming(timing(undefined, overrides))).toThrowError(expect.objectContaining({ statusCode: 400, code: "VALIDATION" }));
  });
  test("принимает границы календарного окна", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T09:00Z"));
    for (const startDate of ["2025-10-06", "2031-10-06"])
      expect(() => assertValidTiming(timing(undefined, { startDate }))).not.toThrow();
  });
});
