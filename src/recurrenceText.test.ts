import { expect, test } from "vitest";
import type { RecurrenceSchedule } from "../server/src/contract";
import ru, { type TKey } from "./i18n/ru";
import en from "./i18n/en";
import { pluralForm } from "./i18n";
import { recurrenceText, recurringDate } from "./recurrenceText";

const examples: [RecurrenceSchedule, string, string][] = [
  [{ kind: "daily", every: 1 }, "Каждый день", "Every day"],
  [{ kind: "daily", every: 3 }, "Каждые 3 дня", "Every 3 days"],
  [{ kind: "daily", every: 11 }, "Каждые 11 дней", "Every 11 days"],
  [{ kind: "weekly", every: 1, weekdays: [5, 3, 1, 4, 2] }, "По будням", "On weekdays"],
  [{ kind: "weekly", every: 1, weekdays: [7, 6] }, "По выходным", "On weekends"],
  [{ kind: "weekly", every: 1, weekdays: [1] }, "Каждый понедельник", "Every Monday"],
  [{ kind: "weekly", every: 2, weekdays: [3, 1] }, "Каждые 2 недели: пн, ср", "Every 2 weeks: Mon, Wed"],
  [{ kind: "monthly", every: 1, day: 15 }, "15-го числа каждого месяца", "Day 15 of every month"],
  [{ kind: "monthly", every: 1, day: "last" }, "Последний день каждого месяца", "Last day of every month"],
  [{ kind: "monthly", every: 5, day: 31 }, "31-го числа каждые 5 месяцев", "Day 31 every 5 months"],
];
for (const lang of ["ru", "en"] as const) test.each(examples)(`schedule in ${lang}: %j`, (schedule, russian, english) => {
  const dict = lang === "ru" ? ru : en;
  const t = (key: TKey, params?: Record<string, string | number>) => dict[key].replace(/\{(\w+)\}/g, (text, key: string) => String(params?.[key] ?? text));
  const tn = (n: number, one: TKey, few: TKey, many: TKey) => t(pluralForm(lang, n, [one, few, many]) as TKey);
  const expected = lang === "ru" ? russian : english;
  expect(recurrenceText(schedule, t, tn)).toBe(expected);
  expect(recurrenceText(schedule, t, tn, "09:00")).toBe(`${expected} ${lang === "ru" ? "в" : "at"} 09:00`);
});
test("dates are formatted in the rule zone, across a UTC date boundary", () => {
  expect(recurringDate("2026-10-05T23:00:00Z", "Asia/Tashkent", "en")).toContain("6 Oct 2026");
  expect(recurringDate("2026-10-05T23:00:00Z", "Asia/Tashkent", "en")).toContain("04:00");
});
test.each([null, { kind: "weekly", every: 1 }, { kind: "weekly", every: 1, weekdays: [8] }, { kind: "daily", every: 0 }, { kind: "monthly", every: 1, day: 32 }])("invalid parked schedules stay readable: %j", schedule => {
  const t = (key: TKey) => ru[key];
  expect(recurrenceText(schedule as RecurrenceSchedule, t, () => "")).toBe(ru["recurring.paused.invalid_timing"]);
  expect(recurringDate("2026-10-06T04:00:00Z", "Invalid/Zone", "ru")).toBe("2026-10-06T04:00:00Z");
});
