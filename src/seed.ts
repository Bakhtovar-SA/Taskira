import type { Workflow } from "./types";

/**
 * Единственное, что здесь ещё используется — DEFAULT_WORKFLOW (импортирует DocsView.tsx
 * как справочную схему статусов). Демо-данные (freshData/USERS/SPRINTS/issues) удалены:
 * клиент давно работает только через API (src/store.tsx), а их типы разошлись с текущей
 * моделью (роли, типы задач). См. ROLE_MIGRATION.md.
 */
export const DEFAULT_WORKFLOW: Workflow = {
  statuses: [
    { id: "todo", name: "К выполнению", category: "todo" },
    { id: "inprogress", name: "В работе", category: "inprogress" },
    { id: "review", name: "На ревью", category: "inprogress" },
    { id: "done", name: "Готово", category: "done" },
  ],
  transitions: [
    { id: "t1", from: "todo", to: "inprogress" },
    { id: "t2", from: "todo", to: "done" },
    { id: "t3", from: "inprogress", to: "todo" },
    { id: "t4", from: "inprogress", to: "review" },
    { id: "t5", from: "inprogress", to: "done" },
    { id: "t6", from: "review", to: "inprogress" },
    { id: "t7", from: "review", to: "done" },
    { id: "t8", from: "done", to: "inprogress" },
  ],
};
