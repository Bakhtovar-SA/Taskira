import { describe, expect, test } from "vitest";
import bcrypt from "bcryptjs";
import { passwordPolicyError, passwordPolicyViolation } from "../src/passwordPolicy.js";
import { COMMON_PASSWORDS_SOURCE } from "../src/data/commonPasswords.js";
import { hashPassword, verifyPassword } from "../src/services/passwordHash.js";

const code = (password: string, opts: Parameters<typeof passwordPolicyViolation>[1] = {}) => passwordPolicyViolation(password, opts)?.code ?? null;

describe("local password policy (SEC-PWD-02, ASVS 5.0 V6.2)", () => {
  test("length: at least 14 and at most 128 characters, counted as characters", () => {
    expect(code("Abcdefghij-12")).toBe("PASSWORD_TOO_SHORT");
    expect(code("плавный-тракт!")).toBeNull(); // 14 кириллических символов (26 байт) — это 14 символов
    expect(code("плавный-тракт-".repeat(10).slice(0, 128))).toBeNull();
    expect(code("плавный-тракт-".repeat(10).slice(0, 129))).toBe("PASSWORD_TOO_LONG");
  });

  test("no composition rules: a lowercase four-word phrase is accepted (V6.2.5)", () => {
    expect(code("violet lantern quietly orbits", { username: "alice" })).toBeNull();
    expect(code("плавный зелёный трамвай гудит", { username: "alice" })).toBeNull();
    // раньше проходило «по группам» (три из четырёх) — теперь отвергается как тривиальный повтор
    expect(code("Aaaaaaaaaaaaaaaa1")).toBe("PASSWORD_COMMON");
  });

  test("top passwords that satisfy the length rule are rejected, case-insensitively (V6.2.4)", () => {
    const list = COMMON_PASSWORDS_SOURCE.split("\n");
    expect(list.length).toBeGreaterThanOrEqual(3000);
    expect(list.every((p) => p.length >= 14 && p === p.toLowerCase())).toBe(true);
    expect(code(list[0])).toBe("PASSWORD_COMMON");
    expect(code(list[list.length - 1].toUpperCase())).toBe("PASSWORD_COMMON");
  });

  test("username and context words are rejected (V6.1.2, V6.2.11)", () => {
    expect(code("Alice-Secure-42!xyz", { username: "alice" })).toBe("PASSWORD_CONTAINS_USERNAME");
    expect(code("my Taskira password 2026")).toBe("PASSWORD_CONTEXT_WORD");
    expect(code("Megafon-river-stone-77", { contextWords: ["ПАО Megafon"] })).toBe("PASSWORD_CONTEXT_WORD");
    // короткие слова (< 4 символов) не проверяются — иначе «IT» запрещал бы половину фраз
    expect(code("quiet orbit lantern 7", { contextWords: ["IT"] })).toBeNull();
  });

  test("known defaults stay rejected; the startup-only mode skips the lists", () => {
    expect(passwordPolicyError("admin", "admin")).toBeTruthy();
    const listed = COMMON_PASSWORDS_SOURCE.split("\n")[0];
    expect(passwordPolicyError(listed, "root", { lists: false })).toBeNull();
    expect(passwordPolicyError(listed, "root")).toBeTruthy();
  });
});

describe("password hashing without bcrypt truncation (V6.2.8, V6.2.9)", () => {
  test("passwords differing after byte 72 do not match", async () => {
    const stored = await hashPassword("я".repeat(40));
    expect((await verifyPassword("я".repeat(40), stored)).ok).toBe(true);
    expect((await verifyPassword("я".repeat(36) + "x", stored)).ok).toBe(false);
    expect(stored.startsWith("sha256b64$")).toBe(true);
  });

  test("legacy bcrypt hashes still verify and ask for a rehash", async () => {
    const legacy = await bcrypt.hash("Correct-Horse-42", 4);
    expect(await verifyPassword("Correct-Horse-42", legacy)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword("wrong-password-42", legacy)).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPassword("anything", null)).toEqual({ ok: false, needsRehash: false });
  });
});
