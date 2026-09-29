import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../validation";
import { parseAsanaExport } from "./asana";

/** Fixture is hand-written from public Asana CSV export documentation, not a live account. */
const fixture = readFileSync("src/import/__fixtures__/asana.csv", "utf8");

describe("Asana import", () => {
  test("maps notes, ID, section, tags, due date, closure, priority and parent", () => {
    const parsed = parseAsanaExport(fixture);
    expect(parsed.skipped).toBe(1);
    expect(parsed.items).toHaveLength(7);
    expect(parsed.items[0]).toMatchObject({ title: "Prepare launch", priorityId: "high", dueDate: "2026-09-29", closed: false });
    expect(parsed.items[0].description).toBe("Notes, with comma\n\nИмпортировано из Asana: 1001");
    expect(parsed.items[0].labels).toEqual(["asana:planning", "release", "urgent"]);
    expect(parsed.items[1]).toMatchObject({ priorityId: "medium", closed: true });
    expect(parsed.items[2].priorityId).toBe("low");
    expect(parsed.items[3].description).toContain("(подзадача Prepare launch)");
    expect(parsed.items[4].dueDate).toBeNull();
    expect(parsed.items[5].priorityId).toBe("medium");
  });
  test("limits labels while keeping section", () => {
    const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`).join(", ");
    const item = parseAsanaExport(`Name,Section/Column,Tags\nTest,Doing,"${tags}"`).items[0];
    expect(item.labels).toHaveLength(LIMITS.labelsPerIssue);
    expect(item.labels[0]).toBe("asana:doing");
  });
  test("wrong file gives a clear error", () => expect(() => parseAsanaExport("Summary,Notes\nA,B")).toThrow(/Name/));
});
