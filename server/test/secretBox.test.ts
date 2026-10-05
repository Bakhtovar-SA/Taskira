import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
import { open, seal, SecretUnavailableError } from "../src/services/secretBox.js";

test.each(["", "subscription-secret", "Секрет 🔒\n東京"])("authenticated encryption round-trips %j with fresh IVs", plain => {
  const key = randomBytes(32);
  const first = seal(plain, key), second = seal(plain, key);
  expect(open(first, key)).toBe(plain); expect(open(second, key)).toBe(plain);
  expect(first).not.toBe(second);
  expect(first.split(".")[0]).toBe("v1");
  expect(Buffer.from(first.split(".")[1], "base64url")).toHaveLength(12);
  expect(Buffer.from(first.split(".")[3], "base64url")).toHaveLength(16);
});
test("tampered IV, ciphertext, tag and wrong key fail without logging or disclosing arguments", () => {
  const key = randomBytes(32), plain = "private-subscription-secret", sealed = seal(plain, key);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(() => open(sealed, randomBytes(32))).toThrow(SecretUnavailableError);
    for (const index of [1, 2, 3]) {
      const parts = sealed.split("."); const bytes = Buffer.from(parts[index], "base64url");
      bytes[0] ^= 1; parts[index] = bytes.toString("base64url");
      expect(() => open(parts.join("."), key)).toThrow("Секрет недоступен");
    }
    expect(errorLog).not.toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});
test.each(["", "v2.a.b.c", "v1.a.b", "v1.a.b.c.extra", "v1.!.b.c", "v1.a=.b.c", "v1.A.B.C", "v1..."])("rejects malformed envelope %j", value => {
  expect(() => open(value, randomBytes(32))).toThrow(SecretUnavailableError);
});
test.each([0, 16, 31, 33, 64])("rejects key length %i for encryption and decryption", length => {
  expect(() => seal("private", Buffer.alloc(length))).toThrow(SecretUnavailableError);
  expect(() => open("v1.private.private.private", Buffer.alloc(length))).toThrow("Секрет недоступен");
});
