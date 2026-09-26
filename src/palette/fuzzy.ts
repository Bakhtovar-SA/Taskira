/**
 * Нечёткий поиск команд палитры (ТЗ 5.8 п.4). Чистые функции, без React.
 *
 * Совпадение — подпоследовательность: все буквы запроса встречаются в тексте в
 * том же порядке. Очки выше, если буквы идут подряд и попадают на начало слова
 * («нз» → «Новая задача»). Плюс запрос, набранный не в той раскладке
 * («ljcrf» → «доска», «ищфкв» → «board»), тоже находит команду — частая
 * ситуация у тех, кто пишет на двух языках.
 */

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const EN_TO_RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Тот же ввод в другой раскладке ЙЦУКЕН ↔ QWERTY. Символы вне раскладки не меняются. */
export function swapLayout(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) out += EN_TO_RU.get(ch) ?? RU_TO_EN.get(ch) ?? ch;
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Очки совпадения запроса с текстом или null, если совпадения нет. Больше — лучше. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = norm(query.trim()).replace(/\s+/g, "");
  if (!q) return 0;
  const t = norm(text);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const wordStart = at === 0 || /[\s\-/«(·]/.test(t[at - 1]);
    score += 1 + (at === prev + 1 ? 3 : 0) + (wordStart ? 4 : 0);
    prev = at;
    ti = at + 1;
  }
  // Короткие точные попадания выше длинных случайных; префикс — лучше всего.
  if (t.startsWith(q)) score += 8;
  return score - t.length * 0.02;
}

/** Лучшее из прямого запроса и запроса в другой раскладке, по любому из текстов команды. */
export function matchScore(query: string, texts: readonly string[]): number | null {
  const variants = [query, swapLayout(query)];
  let best: number | null = null;
  for (const v of variants)
    for (const text of texts) {
      const s = fuzzyScore(v, text);
      if (s !== null && (best === null || s > best)) best = s;
    }
  return best;
}
