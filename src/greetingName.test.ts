import { expect, test } from "vitest";
import { greetingName } from "./greetingName";

test("LDAP greeting uses givenName independently of displayName order", () => {
  for (const name of ["Сафарлизод Бахтовар", "Бахтовар Сафарлизод"]) {
    expect(greetingName({ name, givenName: " Бахтовар ", authSource: "ldap" })).toBe("Бахтовар");
  }
});

test("missing directory givenName keeps the full name rather than guessing a surname", () => {
  expect(greetingName({ name: "Сафарлизод Бахтовар", givenName: null, authSource: "ldap" })).toBe("Сафарлизод Бахтовар");
  expect(greetingName({ name: "  Test   Admin  ", authSource: "local" })).toBe("Test");
  expect(greetingName(undefined)).toBe("");
});
