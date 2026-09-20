import { describe, expect, test } from "vitest";
import {
  decodeIssueListCursor,
  decodeIssueSortCursor,
  encodeIssueListCursor,
  encodeIssueSortCursor,
} from "../src/issueListCursor.js";

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
    expect(() => decodeIssueListCursor(cursor, `${SECRET}-other`)).toThrow();
    // Каждый бит каждого байта: любое изменение данных или подписи отклоняется.
    const bytes = Buffer.from(cursor, "base64url");
    for (let i = 0; i < bytes.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const flipped = Buffer.from(bytes);
        flipped[i] ^= 1 << bit;
        expect(() => decodeIssueListCursor(flipped.toString("base64url"), SECRET)).toThrow();
      }
    }
  });

  // Регрессия: в хвосте base64url есть неиспользуемые биты, и подмена последнего
  // символа на «A»/«B» иногда не меняла байты — курсор оставался валидным
  // (тест повреждённого курсора падал примерно в одном прогоне из шестнадцати).
  test.each([
    ["rank", () => encodeIssueListCursor(value, SECRET), (c: string) => decodeIssueListCursor(c, SECRET)],
    [
      "sort",
      () => encodeIssueSortCursor({ sort: "priority", dir: "desc", value: 2, num: 77 }, SECRET),
      (c: string) => decodeIssueSortCursor(c, SECRET),
    ],
  ] as const)("%s-курсор имеет ровно одну допустимую запись", (_name, encode, decode) => {
    const cursor = encode();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const accepted = [...alphabet].filter((ch) => {
      try {
        decode(`${cursor.slice(0, -1)}${ch}`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([cursor.at(-1)]);
  });
});
