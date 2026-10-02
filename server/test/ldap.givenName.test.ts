import { expect, test, vi } from "vitest";

const directory = vi.hoisted(() => ({ entry: {} as Record<string, unknown> }));
vi.mock("../src/config.js", () => ({ loadConfig: () => ({ ldap: {
  url: "ldap://directory.invalid", timeoutMs: 1000, startTls: false,
  userDnTemplate: "uid={username},dc=test", groupMembership: "memberOf",
  attrLogin: "uid", attrName: "displayName", attrMail: "mail", attrTitle: "title", attrPhone: "telephoneNumber",
} }) }));
vi.mock("ldapts", () => ({
  Client: class {
    async bind() {}
    async unbind() {}
    async search(_dn: string, options: { attributes: string[] }) {
      expect(options.attributes).toContain("givenName");
      return { searchEntries: [directory.entry] };
    }
  },
  InvalidCredentialsError: class extends Error {},
}));
import { ldapAuthenticate } from "../src/services/ldap.js";

test.each(["givenName", "givenname", "GIVENNAME"])("directory attribute %s uses its value without changing displayName", async (key) => {
  directory.entry = { uid: "greeting", displayName: "Сафарлизод Бахтовар", [key]: [" Бахтовар "] };
  expect(await ldapAuthenticate("greeting", "fixture-password")).toMatchObject({
    name: "Сафарлизод Бахтовар", givenName: "Бахтовар",
  });
});

test("absent or blank givenName remains null", async () => {
  for (const value of [undefined, [], "  "]) {
    directory.entry = { uid: "greeting", displayName: "Сафарлизод Бахтовар", givenname: value };
    expect((await ldapAuthenticate("greeting", "fixture-password"))?.givenName).toBeNull();
  }
});
