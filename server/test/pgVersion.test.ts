import { describe, expect, test } from "vitest";
import {
  PG_MAX_TESTED_MAJOR,
  PG_MIN_MAJOR,
  assessPgVersion,
  parseServerVersionNum,
  unsupportedVersionMessage,
} from "../src/services/pgVersion.js";

describe("разбор server_version_num", () => {
  test("10+ : major*10000 + minor", () => {
    expect(parseServerVersionNum("160004")).toEqual({ versionNum: 160004, major: 16, minor: 4 });
    expect(parseServerVersionNum(140000)).toEqual({ versionNum: 140000, major: 14, minor: 0 });
    expect(parseServerVersionNum(" 170002 ")).toEqual({ versionNum: 170002, major: 17, minor: 2 });
    expect(assessPgVersion(" 170002 ")).toMatchObject({ versionNum: 170002, major: 17, minor: 2, status: "supported" });
  });
  test("до 10 — старая схема", () => {
    expect(parseServerVersionNum("090624")).toEqual({ versionNum: 90624, major: 9, minor: 6 });
  });
  test("мусор — ошибка", () => {
    expect(() => parseServerVersionNum("")).toThrow();
    expect(() => parseServerVersionNum("abc")).toThrow();
    expect(() => parseServerVersionNum(0)).toThrow();
  });
});

describe("пороги поддержки", () => {
  test("ниже минимума — unsupported", () => {
    expect(assessPgVersion((PG_MIN_MAJOR - 1) * 10000 + 5).status).toBe("unsupported");
    expect(assessPgVersion("090624").status).toBe("unsupported");
  });
  test("границы диапазона — supported", () => {
    expect(assessPgVersion(PG_MIN_MAJOR * 10000).status).toBe("supported");
    expect(assessPgVersion(PG_MAX_TESTED_MAJOR * 10000 + 9).status).toBe("supported");
  });
  test("выше проверенного — newer_than_tested", () => {
    expect(assessPgVersion((PG_MAX_TESTED_MAJOR + 1) * 10000).status).toBe("newer_than_tested");
  });
  test("сообщение называет версию и минимум", () => {
    const msg = unsupportedVersionMessage(assessPgVersion(130012));
    expect(msg).toContain("13.12");
    expect(msg).toContain(String(PG_MIN_MAJOR));
  });
});
