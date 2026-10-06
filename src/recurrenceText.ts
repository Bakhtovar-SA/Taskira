/** Описание расписания; сами наступления рассчитывает сервер. */
import type { RecurrenceSchedule } from "../server/src/contract";
import type { useT, TKey } from "./i18n";
type Translator = ReturnType<typeof useT>;
export function recurrenceText(schedule: RecurrenceSchedule, t: Translator["t"], tn: Translator["tn"], time?: string): string {
  // A rule parked by the worker may still contain an invalid legacy schedule.
  if (!schedule || !Number.isInteger(schedule.every) || schedule.every < 1
    || schedule.every > (schedule.kind === "daily" ? 30 : 12)
    || (schedule.kind === "weekly" && (!Array.isArray(schedule.weekdays) || !schedule.weekdays.length
      || schedule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)))
    || (schedule.kind === "monthly" && schedule.day !== "last" && (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31))
    || !["daily", "weekly", "monthly"].includes(schedule.kind)) return t("recurring.paused.invalid_timing");
  const unit = (n: number, kind: "day" | "week" | "month") => tn(n,
    `recurring.unit.${kind}.one`, `recurring.unit.${kind}.few`, `recurring.unit.${kind}.many`);
  let text: string;
  if (schedule.kind === "daily") text = schedule.every === 1 ? t("recurring.schedule.daily")
    : t("recurring.schedule.days", { count: schedule.every, unit: unit(schedule.every, "day") });
  else if (schedule.kind === "weekly") {
    const days = [...schedule.weekdays].sort((a, b) => a - b);
    const names = days.map(day => t(`recurring.weekday.${day}` as TKey)).join(", ");
    if (schedule.every > 1) text = t("recurring.schedule.weeks", { count: schedule.every, unit: unit(schedule.every, "week"), days: names });
    else if (days.join() === "1,2,3,4,5") text = t("recurring.schedule.weekdays");
    else if (days.join() === "6,7") text = t("recurring.schedule.weekends");
    else if (days.length === 1) text = t(`recurring.schedule.weekday.${days[0]}` as TKey);
    else text = t("recurring.schedule.week", { days: names });
  } else if (schedule.every === 1) text = schedule.day === "last" ? t("recurring.schedule.monthLast")
    : t("recurring.schedule.monthDay", { day: schedule.day });
  else text = t(schedule.day === "last" ? "recurring.schedule.monthsLast" : "recurring.schedule.monthsDay",
    { day: schedule.day, count: schedule.every, unit: unit(schedule.every, "month") });
  return time ? t("recurring.schedule.at", { schedule: text, time }) : text;
}

export function recurringDate(value: string, timeZone: string, lang: "ru" | "en"): string {
  try { return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value)); }
  catch { return value; }
}
