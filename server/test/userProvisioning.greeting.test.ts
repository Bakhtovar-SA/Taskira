import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { safeUser } from "../src/auth.js";
import { provisionFromLdap } from "../src/services/userProvisioning.js";
import { getApp, resetDb, seedFixture, stopApp } from "./helpers.js";

beforeAll(getApp);
afterAll(stopApp);
beforeEach(async () => { await resetDb(); await seedFixture(); });

test("givenName survives new LDAP provisioning, resync and local account adoption", async () => {
  const principal = { login: "ldap.greeting", dn: "uid=ldap.greeting,dc=test", name: "Сафарлизод Бахтовар", givenName: " Бахтовар ", email: null, title: null, phone: null, groupDns: [] };
  const row = await provisionFromLdap(principal);
  expect(safeUser(row)).toMatchObject({ name: principal.name, givenName: "Бахтовар" });
  const updated = await provisionFromLdap({ ...principal, givenName: "Новое имя" });
  expect(updated.id).toBe(row.id);
  expect(safeUser(updated).givenName).toBe("Новое имя");
  expect(safeUser(await provisionFromLdap({ ...principal, givenName: null })).givenName).toBeNull();
  expect(safeUser(await provisionFromLdap({ ...principal, login: "emp1", dn: "uid=emp1,dc=test" }))).toMatchObject({ authSource: "ldap", givenName: "Бахтовар" });
});
