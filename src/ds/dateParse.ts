/** Разбор даты, введённой словами (концепция DatePicker, ТЗ 5.7): «завтра», «пт», «+3», «через 2 недели»,
 *  «15.10», «15 окт», «2026-10-15», и то же по-английски. Чистая функция — дата в ISO `YYYY-MM-DD`
 *  или `null`. Считаем в UTC от полуночи «сегодня», чтобы переход на летнее время не сдвигал день. */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

const WEEKDAYS: [RegExp, number][] = [
  [/^(пн|пон|понедельник|mon|monday)$/, 1],
  [/^(вт|вто|вторник|tue|tuesday)$/, 2],
  [/^(ср|сре|среда|среду|wed|wednesday)$/, 3],
  [/^(чт|чет|четверг|thu|thursday)$/, 4],
  [/^(пт|пят|пятница|пятницу|fri|friday)$/, 5],
  [/^(сб|суб|суббота|субботу|sat|saturday)$/, 6],
  [/^(вс|вос|воскресенье|sun|sunday)$/, 0],
];
const MONTHS: [RegExp, number][] = [
  [/^(янв|jan)/, 0],
  [/^(фев|feb)/, 1],
  [/^(мар|mar)/, 2],
  [/^(апр|apr)/, 3],
  [/^(мая|май|may)/, 4],
  [/^(июн|jun)/, 5],
  [/^(июл|jul)/, 6],
  [/^(авг|aug)/, 7],
  [/^(сен|sep)/, 8],
  [/^(окт|oct)/, 9],
  [/^(ноя|nov)/, 10],
  [/^(дек|dec)/, 11],
];

/** `today` — ISO-дата «сегодня» (по часам пользователя). */
export function parseDateInput(input: string, today: string): string | null {
  const s = input.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  if (!s) return null;
  const base = new Date(`${today}T00:00:00Z`);
  const y0 = base.getUTCFullYear();

  if (/^(сегодня|today)$/.test(s)) return today;
  if (/^(завтра|tomorrow)$/.test(s)) return iso(addDays(base, 1));
  if (/^(послезавтра)$/.test(s)) return iso(addDays(base, 2));

  // +3, +2н, +2w, через 3 дня, через неделю, in 2 weeks
  const rel = s.match(/^(?:\+|через |in )(\d+)? ?(д|дн|дня|дней|день|d|days?|н|нед|недели|недель|неделю|w|weeks?|м|мес|месяц|месяца|месяцев|m|months?)?$/);
  if (rel && (rel[1] || rel[2])) {
    const n = rel[1] ? Number(rel[1]) : 1;
    const unit = rel[2] ?? "д";
    if (/^(н|нед|w)/.test(unit)) return iso(addDays(base, n * 7));
    if (/^(м|m)/.test(unit)) {
      const d = new Date(Date.UTC(y0, base.getUTCMonth() + n, base.getUTCDate()));
      return iso(d);
    }
    return iso(addDays(base, n));
  }

  // день недели — ближайший следующий (сегодняшний день недели → через неделю)
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(s)) {
      const diff = (wd - base.getUTCDay() + 7) % 7 || 7;
      return iso(addDays(base, diff));
    }
  }

  // 2026-10-15
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);

  // 15.10 / 15.10.26 / 15.10.2026 / 15/10
  m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/);
  if (m) return withYear(+m[1], +m[2] - 1, m[3], base);

  // 15 окт / 15 октября 2026 / oct 15
  m = s.match(/^(\d{1,2}) ([a-zа-я]+)(?: (\d{4}))?$/) ?? null;
  const m2 = s.match(/^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/);
  const [day, word, year] = m ? [m[1], m[2], m[3]] : m2 ? [m2[2], m2[1], m2[3]] : [];
  if (day && word) {
    const mon = MONTHS.find(([re]) => re.test(word))?.[1];
    if (mon !== undefined) return withYear(+day, mon, year, base);
  }
  return null;
}

function valid(y: number, mon: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mon, d));
  return dt.getUTCMonth() === mon && dt.getUTCDate() === d ? iso(dt) : null;
}

/** Без года — ближайшая такая дата не раньше сегодня (15.01 в октябре — это январь следующего года). */
function withYear(d: number, mon: number, year: string | undefined, base: Date): string | null {
  if (year) return valid(year.length === 2 ? 2000 + +year : +year, mon, d);
  const y = base.getUTCFullYear();
  const cand = valid(y, mon, d);
  if (cand && cand >= iso(base)) return cand;
  return valid(y + 1, mon, d);
}
