import { afterEach, expect, test } from "vitest";
import { clearCreateDrafts, createDraftKey, deleteCreateDraft, readCreateDraft, saveCreateDraft, type CreateDraft } from "./createDrafts";

const draft: CreateDraft = {
  typeId: "task", title: "Private draft", description: "Details", priorityId: "medium", complexity: null,
  assigneeIds: [], epicId: null, epicPicked: null, dueDate: "", labels: [], labelDraft: "",
  checklistItems: [], checklistDraft: "", templateId: "", templateStatusId: null, again: false,
};
afterEach(clearCreateDrafts);

test("drafts belong to one user, project and parent; discarding one leaves the others", () => {
  const key = createDraftKey("u1", "p1", null);
  const subtask = createDraftKey("u1", "p1", "i1");
  saveCreateDraft(key, draft);
  saveCreateDraft(subtask, { ...draft, title: "Subtask" });
  expect(readCreateDraft(createDraftKey("u2", "p1", null))).toBeUndefined();
  expect(readCreateDraft(createDraftKey("u1", "p2", null))).toBeUndefined();
  expect(readCreateDraft(key)?.title).toBe("Private draft");
  deleteCreateDraft(key);
  expect(readCreateDraft(key)).toBeUndefined();
  expect(readCreateDraft(subtask)?.title).toBe("Subtask");
});

test("logout clears drafts and late saves from the previous session cannot restore them", () => {
  const oldKey = createDraftKey("u1", "p1", null);
  saveCreateDraft(oldKey, draft);
  clearCreateDrafts();
  saveCreateDraft(oldKey, draft);
  const newKey = createDraftKey("u1", "p1", null);
  expect(newKey).not.toBe(oldKey);
  expect(readCreateDraft(oldKey)).toBeUndefined();
  expect(readCreateDraft(newKey)).toBeUndefined();
  saveCreateDraft(newKey, { ...draft, title: "New session" });
  deleteCreateDraft(oldKey);
  expect(readCreateDraft(newKey)?.title).toBe("New session");
});
