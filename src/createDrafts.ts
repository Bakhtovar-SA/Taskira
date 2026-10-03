import type { ComplexityId, Issue, IssueTypeId, PriorityId } from "./types";

export type CreateDraft = {
  typeId: IssueTypeId; title: string; description: string; priorityId: PriorityId;
  complexity: ComplexityId | null; assigneeIds: string[]; epicId: string | null; epicPicked: Issue | null;
  dueDate: string; labels: string[]; labelDraft: string; checklistItems: string[]; checklistDraft: string;
  templateId: string; templateStatusId: string | null; again: boolean;
};

// Only in memory for this signed-in session. No issue content is written to browser storage.
const drafts = new Map<string, CreateDraft>();
let epoch = 0;
export const createDraftKey = (user: string, project: string, parent: string | null) => `${epoch}:${user}:${project}:${parent ?? ""}`;
export const readCreateDraft = (key: string) => drafts.get(key);
export function saveCreateDraft(key: string, draft: CreateDraft) {
  if (!key.startsWith(`${epoch}:`)) return;
  drafts.set(key, draft);
}
export const deleteCreateDraft = (key: string) => drafts.delete(key);
export function clearCreateDrafts() { epoch++; drafts.clear(); }
