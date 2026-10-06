/** Календарные наступления в местном времени. Intl — единственный источник смещений пояса. */
import { RecurrenceSchedule } from "../contract.js";
import { ApiHttpError } from "../errors.js";

export interface RuleTiming {
  schedule: RecurrenceSchedule;
  timeOfDay: string;
  timeZone: string;
  startDate: string;
}

const DAY = 86_400_000;
const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const invalid = (reason: string): never => { throw new ApiHttpError(400, "VALIDATION", reason); };

function formatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== "string" || timeZone.length === 0) return invalid("Неизвестный часовой пояс");
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    } catch { return invalid("Неизвестный часовой пояс"); }
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function civilDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("Некорректная дата начала");
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date)
    return invalid("Некорректная дата начала");
  return value;
}

function assertTime(time: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) invalid("Время должно иметь формат HH:MM");
}

function instantMs(instant: Date): number {
  const value = instant.getTime();
  if (!Number.isFinite(value)) return invalid("Некорректный момент времени");
  return value;
}

/** Число UTC здесь кодирует поля местного календаря, а не реальный момент. */
function wallClock(ms: number, fmt: Intl.DateTimeFormat): number {
  const fields: Record<string, number> = {};
  for (const part of fmt.formatToParts(ms)) if (part.type !== "literal") fields[part.type] = Number(part.value);
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour, fields.minute, fields.second, 0);
  return date.getTime();
}

export function localDateOf(instant: Date, timeZone: string): string {
  return new Date(wallClock(instantMs(instant), formatter(timeZone))).toISOString().slice(0, 10);
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const midnight = civilDate(date);
  assertTime(time);
  const fmt = formatter(timeZone);
  const [hours, minutes] = time.split(":").map(Number);
  const target = midnight + hours * 60 * MINUTE + minutes * MINUTE;
  // Захватываем смещения по обе стороны перехода, включая сдвиги на полчаса/сутки.
  const offsets = new Set<number>();
  for (let hoursAway = -48; hoursAway <= 48; hoursAway += 6) {
    const sample = target + hoursAway * 60 * MINUTE;
    offsets.add(wallClock(sample, fmt) - sample);
  }
  const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
  const exact = candidates.find(candidate => wallClock(candidate, fmt) === target);
  if (exact !== undefined) return new Date(exact); // Повтор часа: первый момент.

  // Разрыв: ищем сам переход, а не прибавляем длительность разрыва к HH:MM.
  const below = candidates.filter(candidate => wallClock(candidate, fmt) < target);
  const above = candidates.filter(candidate => wallClock(candidate, fmt) > target);
  let low = Math.max(...below), high = Math.min(...above);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high)
    return invalid("Местное время не удалось перевести в UTC");
  low = Math.floor(low / MINUTE); high = Math.ceil(high / MINUTE);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wallClock(middle * MINUTE, fmt) >= target) high = middle;
    else low = middle;
  }
  return new Date(high * MINUTE);
}

function assertShape(t: RuleTiming): void {
  formatter(t.timeZone);
  civilDate(t.startDate);
  assertTime(t.timeOfDay);
  if (!RecurrenceSchedule.safeParse(t.schedule).success) invalid("Некорректное расписание");
}

function shiftYears(date: number, years: number): number {
  const d = new Date(date), month = d.getUTCMonth(), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + years);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

export function assertValidTiming(t: RuleTiming): void {
  assertShape(t);
  const today = civilDate(localDateOf(new Date(), t.timeZone));
  const start = civilDate(t.startDate);
  if (start < shiftYears(today, -1) || start > shiftYears(today, 5))
    invalid("Дата начала должна быть в пределах одного года назад и пяти лет вперёд");
}

function weekday(date: number): number { return (new Date(date).getUTCDay() + 6) % 7 + 1; }
function monday(date: number): number { return date - (weekday(date) - 1) * DAY; }

function eligible(schedule: RecurrenceSchedule, start: number, date: number): boolean {
  switch (schedule.kind) {
    case "daily": return ((date - start) / DAY) % schedule.every === 0;
    case "weekly": return schedule.weekdays.includes(weekday(date))
      && ((monday(date) - monday(start)) / (7 * DAY)) % schedule.every === 0;
    case "monthly": {
      const d = new Date(date), s = new Date(start);
      const months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + d.getUTCMonth() - s.getUTCMonth();
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      return months % schedule.every === 0
        && d.getUTCDate() === (schedule.day === "last" ? last : Math.min(schedule.day, last));
    }
  }
}

export function nextOccurrence(t: RuleTiming, after: Date): Date {
  // Окно startDate проверяется при сохранении: старое правило продолжает работать спустя годы.
  assertShape(t);
  const afterMs = instantMs(after), start = civilDate(t.startDate);
  const firstDate = Math.max(start, civilDate(localDateOf(after, t.timeZone)));
  for (let day = 0; day < 800; day++) {
    const date = firstDate + day * DAY;
    if (!eligible(t.schedule, start, date)) continue;
    const candidate = zonedToUtc(new Date(date).toISOString().slice(0, 10), t.timeOfDay, t.timeZone);
    if (candidate.getTime() > afterMs) return candidate;
  }
  return invalid("Расписание не наступает");
}

export function occurrencesBetween(t: RuleTiming, fromInclusive: Date, toInclusive: Date, limit: number): Date[] {
  const from = instantMs(fromInclusive), to = instantMs(toInclusive);
  if (!Number.isInteger(limit) || limit < 0) return invalid("Некорректный предел наступлений");
  if (limit === 0 || from > to) return [];
  const occurrences: Date[] = [];
  let after = new Date(from - 1);
  while (occurrences.length < limit) {
    const next = nextOccurrence(t, after);
    if (next.getTime() > to) break;
    occurrences.push(next); after = next;
  }
  return occurrences;
}
