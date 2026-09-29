/** Hand-written CSV examples in __fixtures__ follow public Asana export documentation;
 * no live Asana account or proprietary export was used for verification. */
import { sanitizeLine } from "../validation";
import type { PriorityId } from "../types";
import { columnValue, hasColumn, parseCsv } from "./csv";
import { importLabels, sourceLabel, type ImportParseResult } from "./types";

function dueDate(value: string): string | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? text : null;
}

function priority(value: string): PriorityId {
  const level = value.trim().toLowerCase();
  return level === "high" ? "high" : level === "low" ? "low" : "medium";
}

export function parseAsanaExport(text: string): ImportParseResult {
  const table = parseCsv(text);
  if (!hasColumn(table, "Name")) throw new Error("Файл не похож на CSV-выгрузку Asana — нет колонки Name");
  const result: ImportParseResult = { items: [], skipped: 0 };
  for (const row of table.rows) {
    const title = sanitizeLine(columnValue(table, row, "Name"));
    if (!title) { result.skipped++; continue; }
    const id = sanitizeLine(columnValue(table, row, "Task ID"));
    const parent = sanitizeLine(columnValue(table, row, "Parent task"));
    const note = `Импортировано из Asana${id ? `: ${id}` : ""}${parent ? ` (подзадача ${parent})` : ""}`;
    const section = columnValue(table, row, "Section/Column").trim();
    result.items.push({
      title,
      description: [columnValue(table, row, "Notes"), note].filter(Boolean).join("\n\n"),
      dueDate: dueDate(columnValue(table, row, "Due Date")),
      closed: !!columnValue(table, row, "Completed At").trim(),
      priorityId: priority(columnValue(table, row, "Priority")),
      labels: importLabels(section ? sourceLabel("asana", section) : null, columnValue(table, row, "Tags").split(",")),
    });
  }
  return result;
}
