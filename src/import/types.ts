import type { IssueTypeId, PriorityId } from "../types";
import { LIMITS, sanitizeLabel, sanitizeText } from "../validation";

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
  truncatedDescriptions?: number;
}

/** Leave room for the provenance note so store validation cannot reject a long export. */
export function importDescription(raw: string, note: string): { description: string; truncated: boolean } {
  const suffix = sanitizeText(note, LIMITS.description.max);
  const source = sanitizeText(raw, LIMITS.description.max + 1);
  const budget = Math.max(0, LIMITS.description.max - suffix.length - (source ? 2 : 0));
  const content = source.slice(0, budget).trimEnd();
  return {
    description: content ? `${content}\n\n${suffix}` : suffix,
    truncated: source.length > content.length || note.length > suffix.length,
  };
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
