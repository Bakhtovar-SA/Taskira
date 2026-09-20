import { describe, expect, test } from "vitest";
import { decodeIssueListCursor, encodeIssueListCursor } from "../src/issueListCursor.js";

const SECRET = "cursor-test-secret-with-more-than-32-chars";
const value = { rank: -1234.5, id: "123e4567-e89b-42d3-a456-426614174000" };

describe("issue list cursor", () => {
  test("round-trips the ordering tuple without exposing a JSON contract", () => {
    const cursor = encodeIssueListCursor(value, SECRET);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("rank");
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toContain("id");
    expect(decodeIssueListCursor(cursor, SECRET)).toEqual(value);
  });

  test("rejects tampering and cursors signed by another installation", () => {
    const cursor = encodeIssueListCursor(value, SECRET);
    const tail = cursor.at(-1) === "A" ? "B" : "A";
    expect(() => decodeIssueListCursor(`${cursor.slice(0, -1)}${tail}`, SECRET)).toThrow();
    expect(() => decodeIssueListCursor(cursor, `${SECRET}-other`)).toThrow();
  });
});
