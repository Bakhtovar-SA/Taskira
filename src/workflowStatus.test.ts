import { describe, expect, test } from "vitest";
import en from "./i18n/en";
import ru, { type TKey } from "./i18n/ru";
import { workflowStatusName } from "./workflowStatus";

const tr = (dict: Record<TKey, string>) => (key: TKey) => dict[key];

describe("workflowStatusName", () => {
  test("localizes every built-in workflow status by stable sid", () => {
    expect(workflowStatusName({ sid: "todo", name: "К выполнению" }, tr(en))).toBe("To do");
    expect(workflowStatusName({ sid: "inprogress", name: "В работе" }, tr(en))).toBe("In progress");
    expect(workflowStatusName({ sid: "review", name: "На ревью" }, tr(en))).toBe("Review");
    expect(workflowStatusName({ sid: "done", name: "Готово" }, tr(en))).toBe("Done");
    expect(workflowStatusName({ sid: "done", name: "Done" }, tr(ru))).toBe("Готово");
  });

  test("preserves custom workflow names", () => {
    expect(workflowStatusName({ sid: "legal-approval", name: "Legal approval" }, tr(en))).toBe("Legal approval");
    expect(workflowStatusName({ sid: "custom-done", name: "Done" }, tr(ru))).toBe("Done");
  });

  test("localizes known names in cross-project DTOs that have no sid", () => {
    expect(workflowStatusName({ name: "К работе" }, tr(en))).toBe("To do");
    expect(workflowStatusName({ name: "В работе" }, tr(en))).toBe("In progress");
    expect(workflowStatusName({ name: "Done" }, tr(ru))).toBe("Готово");
  });
});
