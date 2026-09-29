export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 fields; preserve duplicate headers and embedded line breaks. */
function parseWithDelimiter(raw: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (char === '"' && raw[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === delimiter) {
      row.push(field); field = ""; afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      row.push(field); records.push(row); row = []; field = ""; afterQuote = false;
    } else if (char === '"' && !field && !afterQuote) {
      quoted = true;
    } else if ((char === " " || char === "\t") && afterQuote) {
      // Excel can leave whitespace between the closing quote and delimiter.
    } else if (afterQuote) {
      throw new Error("Некорректный CSV: символ после закрывающей кавычки");
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Некорректный CSV: незакрытая кавычка");
  if (field || row.length) { row.push(field); records.push(row); }
  return records;
}

export function parseCsv(text: string): CsvTable {
  const raw = text.replace(/^\uFEFF/, "");
  let records = parseWithDelimiter(raw, ",");
  if (records[0]?.length === 1 && records[0][0].includes(";")) records = parseWithDelimiter(raw, ";");
  const [headers = [], ...allRows] = records;
  const rows = allRows.filter((row) => row.some((value) => value.trim() !== ""));
  return { headers, rows };
}

export function columnValues(table: CsvTable, row: string[], name: string): string[] {
  const key = name.trim().toLowerCase();
  return table.headers.flatMap((header, index) => header.trim().toLowerCase() === key ? [row[index] ?? ""] : []);
}

export const columnValue = (table: CsvTable, row: string[], name: string): string =>
  columnValues(table, row, name)[0] ?? "";

export const hasColumn = (table: CsvTable, name: string): boolean =>
  table.headers.some((header) => header.trim().toLowerCase() === name.toLowerCase());
