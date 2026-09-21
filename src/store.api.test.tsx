import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";

/**
 * Защита публичного API стора при разрезании store.tsx (ТЗ 2.3): значение `useStore()` — единственный контракт для
 * 32 потребителей. Поле, потерянное при переносе действия в другой модуль, тихо ломает компонент (класс бага из
 * PERF-06), поэтому набор ключей зафиксирован явно. Добавили/убрали поле в `Api` — обновите список здесь осознанно.
 */
const API_KEYS = [
  "addChecklistItem",
  "addCollaborator",
  "addComment",
  "addCustomField",
  "addIssueLink",
  "addIssueTemplate",
  "addSprint",
  "addTransition",
  "authMode",
  "bootStatus",
  "bootstrap",
  "can",
  "completeSprint",
  "createDepartment",
  "createIssue",
  "createProject",
  "data",
  "deleteDepartment",
  "deleteIssue",
  "deleteProject",
  "dismissNotifications",
  "downloadAttachment",
  "ensureAllIssues",
  "enterProject",
  "epicsRevision",
  "goHome",
  "idx",
  "importIssues",
  "issuesRevision",
  "logout",
  "lookupIssue",
  "markNotificationsRead",
  "me",
  "moveStatus",
  "openCreateSubtask",
  "openIssue",
  "patchProject",
  "refreshCollaborations",
  "refreshNotifications",
  "removeAttachment",
  "removeAvatar",
  "removeChecklistItem",
  "removeCollaborator",
  "removeCustomField",
  "removeIssueLink",
  "removeIssueTemplate",
  "removeMember",
  "removeProjectMember",
  "removeTransition",
  "renameCustomField",
  "renameDepartment",
  "resetWorkflow",
  "resyncLdap",
  "searchAllProjects",
  "setCreateOpen",
  "setCustomFieldValue",
  "setDepartmentLdapGroup",
  "setIssueSprint",
  "setMemberRole",
  "setNotifyPrefs",
  "setProjectMember",
  "setView",
  "solo",
  "startSprint",
  "switchProject",
  "toast",
  "toasts",
  "toggleChecklistItem",
  "toggleFavoriteProject",
  "ui",
  "updateIssue",
  "updateIssueTemplateAction",
  "uploadAttachment",
  "uploadAvatar",
];

function Probe({ onKeys }: { onKeys: (keys: string[]) => void }) {
  onKeys(Object.keys(useStore()));
  return null;
}

afterEach(() => cleanup());

describe("публичный API стора", () => {
  test("useStore() отдаёт ровно зафиксированный набор полей", () => {
    let keys: string[] = [];
    render(
      <StoreProvider>
        <Probe onKeys={(k) => (keys = k)} />
      </StoreProvider>,
    );
    expect([...keys].sort()).toEqual([...API_KEYS].sort());
  });

  test("все поля-действия — функции, данные — не undefined", () => {
    let api: Record<string, unknown> = {};
    function Grab() {
      api = useStore() as unknown as Record<string, unknown>;
      return null;
    }
    render(
      <StoreProvider>
        <Grab />
      </StoreProvider>,
    );
    for (const k of API_KEYS) expect(api[k], k).not.toBeUndefined();
  });
});
