import { describe, expect, test } from "vitest";
import { passwordPolicyError } from "../src/passwordPolicy.js";

describe("local password policy", () => {
  test("rejects short, known, username-derived, and low-complexity passwords", () => {
    expect(passwordPolicyError("admin", "admin")).toBeTruthy();
    expect(passwordPolicyError("alllowercase-password", "alice")).toBeTruthy();
    expect(passwordPolicyError("Alice-Secure-42!", "alice")).toBeTruthy();
  });

  test("accepts a long password with three character groups", () => {
    expect(passwordPolicyError("Correct-Horse-42", "alice")).toBeNull();
  });
});
