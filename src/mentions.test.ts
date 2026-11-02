import { describe, expect, test } from "vitest";
import { insertMention, mentionAt } from "./mentions";

describe("mention editing", () => {
  test("finds a name at the caret including Cyrillic, but not email or selected text", () => {
    expect(mentionAt("Привет, @Ив", 11)).toEqual({ start: 8, end: 11, query: "Ив" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionAt("почта@example.com", 17)).toBeNull();
    expect(mentionAt("test@example.com", 16)).toBeNull();
    expect(mentionAt("@@name", 6)).toBeNull();
    expect(mentionAt("@name", 3, 5)).toBeNull();
  });
  test("replaces only the mention token, preserves surrounding text, and restores caret", () => {
    const text = "Привет @iv и всем";
    const range = mentionAt(text, 10)!;
    expect(insertMention(text, range, "ivan.petrov")).toEqual({ text: "Привет @ivan.petrov и всем", caret: 19 });
    expect(insertMention("@ivan", mentionAt("@ivan", 3)!, "viewer")).toEqual({ text: "@viewer ", caret: 8 });
  });
  test("never inserts a truncated or server-incompatible username", () => {
    const range = mentionAt("@", 1)!;
    expect(insertMention("@", range, "viewer", 5)).toBeNull();
    expect(insertMention("@", range, "full name")).toBeNull();
  });
});
