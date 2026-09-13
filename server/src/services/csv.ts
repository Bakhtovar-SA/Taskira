/** Сериализация CSV для выгрузок, пригодная для русского Excel.
 *
 *  Два решения, без которых файл открывается неправильно:
 *   1) разделитель `;`, а не `,` — в русской локали Excel считает запятую
 *      десятичным разделителем и складывает всю строку в одну ячейку;
 *   2) UTF-8 BOM в начале — без него Excel читает файл в cp1251 и кириллица
 *      превращается в кракозябры.
 *
 *  Экранирование по RFC 4180: поле берётся в кавычки, если содержит разделитель,
 *  кавычку или перевод строки; внутренние кавычки удваиваются.
 *
 *  Инъекция формул (CSV injection): значение, начинающееся с = + - @ или с
 *  управляющих символов табуляции/возврата каретки, Excel исполняет как формулу.
 *  Названия задач пользователи пишут сами, поэтому такие значения префиксуются
 *  апострофом — Excel показывает текст как есть и ничего не вычисляет.
 */

export const CSV_BOM = "﻿";
const SEP = ";";

/** Символы, с которых Excel/LibreOffice начинают интерпретировать ячейку как формулу. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(SEP);
}

/** Полный документ: BOM + заголовок + строки, перевод строки CRLF (RFC 4180). */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return CSV_BOM + [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** Дата для ячейки: ГГГГ-ММ-ДД ЧЧ:ММ в локальном времени сервера. */
export function csvDateTime(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
