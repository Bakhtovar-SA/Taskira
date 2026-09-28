/** Цвета-данные, которые хранятся в БД как hex (contract.ts: /^#[0-9a-f]{6}$/): цвет направления задачи и
 *  цвет пользователя при создании. Это данные, а не оформление, поэтому они не токены; палитра — палитра
 *  проектов ТЗ 5.3. Единственное место с сырыми hex вне tokens.css (scripts/check-raw-colors.mjs). */
export const DATA_COLORS = ["#5283e0", "#a468c7", "#c65b93", "#d15c56", "#c66c00", "#2e9e52", "#00a19a", "#0094ce"] as const;

/** Цвет по строке — у одного логина всегда один цвет. */
export const dataColorFor = (s: string): string => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return DATA_COLORS[Math.abs(h) % DATA_COLORS.length];
};
