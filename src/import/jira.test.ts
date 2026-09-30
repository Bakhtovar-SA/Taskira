import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LIMITS, sanitizeLabel, validateDescription } from "../validation";
import { parseJiraDate, parseJiraExport } from "./jira";

/** Fixture is hand-written from public Jira CSV export documentation, not a live account. */
const fixture = readFileSync("src/import/__fixtures__/jira.csv", "utf8");

describe("Jira import", () => {
  test("maps types, priorities, descriptions, repeated labels, status and closure", () => {
    const parsed = parseJiraExport(fixture);
    expect(parsed.skipped).toBe(1);
    expect(parsed.items).toHaveLength(9);
    expect(parsed.unrecognizedDates).toBe(1);
    const bug = parsed.items[0];
    expect(bug).toMatchObject({ title: "Fix login", typeId: "bug", priorityId: "critical", closed: false, dueDate: "2026-09-29" });
    expect(bug.description).toContain("First line\nSecond line\n\nИмпортировано из Jira: APP-12");
    expect(bug.labels).toEqual(["jira:in progress", "frontend", "urgent"]);
    expect(parsed.items[1]).toMatchObject({ typeId: "request", priorityId: "high", closed: true, dueDate: "2026-09-29" });
    expect(parsed.items[2]).toMatchObject({ typeId: "task", priorityId: "low", closed: true, dueDate: "2026-09-29" });
    expect(parsed.items[2].description).toContain("(подзадача APP-12)");
    expect(parsed.items[3].dueDate).toBe("2026-09-29");
    expect(parsed.items[4].dueDate).toBeNull();
    expect(parsed.items[5].priorityId).toBe("critical");
    expect(parsed.items[6]).toMatchObject({ typeId: "request", priorityId: "high" });
    expect(parsed.items[7].priorityId).toBe("low");
    expect(parsed.items[8].priorityId).toBe("medium");
  });
  test("all four date formats and invalid calendar dates", () => {
    for (const text of ["2026-09-29", "29/Sep/26 12:00 PM", "29.09.2026", "9/29/2026"]) expect(parseJiraDate(text)).toBe("2026-09-29");
    expect(parseJiraDate("31.02.2026")).toBeNull();
  });
  test("reserves status label before truncating extra labels", () => {
    const headers = ["Summary", "Status", ...Array.from({ length: 15 }, () => "Labels")].join(",");
    const values = ["Issue", "Open", ...Array.from({ length: 15 }, (_, i) => `label${i}`)].join(",");
    const item = parseJiraExport(`${headers}\n${values}`).items[0];
    expect(item.labels).toHaveLength(LIMITS.labelsPerIssue);
    expect(item.labels[0]).toBe("jira:open");
    expect(item.labels.map(sanitizeLabel)).toEqual(item.labels);
  });
  test("wrong file gives a clear error", () => expect(() => parseJiraExport("Name,Notes\nA,B")).toThrow(/Summary/));
  test("long description is shortened without losing the Jira source note", () => {
    const long = "x".repeat(LIMITS.description.max + 100);
    const parsed = parseJiraExport(`Summary,Description,Issue key\nIssue,${long},APP-99`);
    expect(parsed.truncatedDescriptions).toBe(1);
    expect(parsed.items[0].description.endsWith("Импортировано из Jira: APP-99")).toBe(true);
    expect(parsed.items[0].description.length).toBeLessThanOrEqual(LIMITS.description.max);
    expect(validateDescription(parsed.items[0].description).ok).toBe(true);
  });
});
