import { describe, expect, test } from "vitest";
import { columnValues, parseCsv } from "./csv";

describe("parseCsv", () => {
  test("BOM, quotes, escaped quotes, embedded newlines and CRLF", () => {
    const table = parseCsv('\uFEFFName,Labels,Labels\r\n"A, B","a""b","line 1\nline 2"\r\n\r\n');
    expect(table.headers).toEqual(["Name", "Labels", "Labels"]);
    expect(table.rows).toEqual([["A, B", 'a"b', "line 1\nline 2"]]);
    expect(columnValues(table, table.rows[0], " labels ")).toEqual(['a"b', "line 1\nline 2"]);
  });
  test("semicolon delimiter and trailing empty rows", () => {
    expect(parseCsv('Name;Notes\nA;"one; two"\n\n').rows).toEqual([["A", "one; two"]]);
  });
  test("rejects malformed quotes", () => {
    expect(() => parseCsv('Name,Notes\nA,"unterminated')).toThrow(/CSV/);
  });
});
