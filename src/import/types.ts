import type { IssueTypeId, PriorityId } from "../types";
import { LIMITS, sanitizeLabel } from "../validation";

export interface ImportItem {
  title: string;
  description: string;
  labels: string[];
  dueDate: string | null;
  closed: boolean;
  priorityId?: PriorityId;
  typeId?: IssueTypeId;
}

export interface ImportParseResult {
  items: ImportItem[];
  skipped: number;
  unrecognizedDates?: number;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

/** Keep distinct long source names distinct after the store sanitizes labels again. */
export function sourceLabel(prefix: string, name: string): string {
  const clean = sanitizeLabel(name);
  const start = `${prefix}:`;
  const budget = Math.max(0, LIMITS.label.max - start.length);
  if (clean.length <= budget) return `${start}${clean}`;
  const suffix = `~${shortHash(name)}`;
  return `${start}${clean.slice(0, Math.max(0, budget - suffix.length))}${suffix}`;
}

/** Source status/section has first claim on the limited label slots. */
export function importLabels(source: string | null, values: string[]): string[] {
  return [...new Set([...(source ? [source] : []), ...values].map(sanitizeLabel).filter(Boolean))]
    .slice(0, LIMITS.labelsPerIssue);
}
