/** Hand-written CSV examples in __fixtures__ follow public Jira export documentation;
 * no live Jira account or proprietary export was used for verification. */
import { sanitizeLine } from "../validation";
import type { IssueTypeId, PriorityId } from "../types";
import { columnValue, columnValues, hasColumn, parseCsv } from "./csv";
import { importLabels, sourceLabel, type ImportParseResult } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function dateParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseJiraDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return dateParts(+match[1], +match[2], +match[3]);
  match = /^(\d{1,2})\.([0-9]{1,2})\.(\d{4})$/.exec(text);
  if (match) return dateParts(+match[3], +match[2], +match[1]);
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return dateParts(+match[3], +match[1], +match[2]);
  match = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+.*)?$/.exec(text);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    return month ? dateParts(year, month, +match[1]) : null;
  }
  return null;
}

function issueType(value: string): IssueTypeId {
  const kind = value.trim().toLowerCase();
  if (kind === "bug") return "bug";
  if (["service request", "request", "запрос"].includes(kind)) return "request";
  return "task";
}

function priority(value: string): PriorityId {
  const level = value.trim().toLowerCase();
  if (["highest", "blocker"].includes(level)) return "critical";
  if (["high", "critical", "major"].includes(level)) return "high";
  if (["low", "lowest", "minor", "trivial"].includes(level)) return "low";
  return "medium";
}

export function parseJiraExport(text: string): ImportParseResult {
  const table = parseCsv(text);
  if (!hasColumn(table, "Summary")) throw new Error("Файл не похож на CSV-выгрузку Jira — нет колонки Summary");
  const result: ImportParseResult = { items: [], skipped: 0, unrecognizedDates: 0 };
  for (const row of table.rows) {
    const title = sanitizeLine(columnValue(table, row, "Summary"));
    if (!title) { result.skipped++; continue; }
    const key = sanitizeLine(columnValue(table, row, "Issue key"));
    const parent = sanitizeLine(columnValue(table, row, "Parent") || columnValue(table, row, "Parent id"));
    const note = `Импортировано из Jira${key ? `: ${key}` : ""}${parent ? ` (подзадача ${parent})` : ""}`;
    const description = [columnValue(table, row, "Description"), note].filter(Boolean).join("\n\n");
    const status = columnValue(table, row, "Status").trim();
    const dueRaw = columnValue(table, row, "Due Date");
    const dueDate = parseJiraDate(dueRaw);
    if (dueRaw.trim() && !dueDate) result.unrecognizedDates!++;
    result.items.push({
      title, description, dueDate,
      typeId: issueType(columnValue(table, row, "Issue Type")),
      priorityId: priority(columnValue(table, row, "Priority")),
      closed: columnValue(table, row, "Status Category").trim().toLowerCase() === "done"
        || !!columnValue(table, row, "Resolution").trim(),
      labels: importLabels(status ? sourceLabel("jira", status) : null, columnValues(table, row, "Labels")),
    });
  }
  return result;
}
