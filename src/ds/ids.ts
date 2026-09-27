/** Уникальные id для связок label/aria (ТЗ 5.7). Отдельно от floating.ts, чтобы поля ввода не тянули
 *  @floating-ui/dom во входной чанк. */
let seq = 0;
export const dsId = (prefix: string) => `${prefix}-${(++seq).toString(36)}`;
