import { describe, expect, test } from "vitest";
import { sep } from "node:path";
import { keyToRelPath, newAvatarStorageKey, newStorageKey } from "../src/services/storage.js";

describe("storage keys have portable path segments", () => {
  test("generated issue and avatar keys keep their relative layout", () => {
    for (const key of [newStorageKey("issue-id"), newAvatarStorageKey("user-id")]) {
      expect(keyToRelPath(key)).toBe(key.split("/").join(sep));
    }
  });
  test.each(["", ".", "..", "segment\\name", "segment:name", "segment\0name"])("rejects an invalid segment %j", key => {
    expect(() => keyToRelPath(key)).toThrow("недопустимый ключ");
  });
});
