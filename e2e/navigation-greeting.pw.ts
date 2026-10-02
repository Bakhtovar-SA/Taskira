import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const lang of ["ru", "en"]) test(`help labels have no numbers and align left (${lang})`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem("taskira.lang", lang), lang);
  await mockApi(page);
  await page.goto("/help");
  const buttons = page.locator("main nav button");
  await expect(buttons.first()).toBeVisible();
  await expect(buttons).toHaveCount(await page.locator('main section[id^="doc-"]').count());
  for (const button of await buttons.all()) {
    expect(await button.innerText()).not.toMatch(/^\d/);
    await expect(button).toHaveCSS("text-align", "left");
    const buttonBox = await button.boundingBox();
    const labelBox = await button.locator(":scope > .truncate").boundingBox();
    expect(labelBox!.width).toBeGreaterThan(buttonBox!.width - 30);
  }
  await page.screenshot({ path: `shots/help-alignment-${lang}.png`, fullPage: true });
});

test("LDAP home greeting uses directory givenName across project switches", async ({ page }) => {
  await mockApi(page, { username: "bakhtovar", name: "Сафарлизод Бахтовар", givenName: "Бахтовар", authSource: "ldap" });
  await page.route("**/api/issues/assigned-to-me*", route => route.fulfill({ json: { items: [], truncated: false, limit: 100 } }));
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Бахтовар/, exact: false }).first()).not.toContainText("Сафарлизод");
  await page.getByRole("button", { name: /Test project/ }).first().click();
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Бахтовар/ }).first()).not.toContainText("Сафарлизод");
  await page.screenshot({ path: "shots/home-greeting.png", fullPage: true });
});

for (const profile of [
  { authSource: "ldap", givenName: null, expected: "Сафарлизод Бахтовар" },
  { authSource: "local", givenName: null, expected: "Сафарлизод" },
]) test(`home greeting without givenName (${profile.authSource})`, async ({ page }) => {
  await mockApi(page, { name: "Сафарлизод Бахтовар", authSource: profile.authSource, givenName: profile.givenName });
  await page.route("**/api/issues/assigned-to-me*", route => route.fulfill({ json: { items: [], truncated: false, limit: 100 } }));
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(new RegExp(`, ${profile.expected}$`));
});

test("inbox labels fill the row and retain avatar spacing", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/notifications?*", route => route.fulfill({ json: {
    items: [{ id: "n1", type: "issue.status", actorId: "u2", actor: { id: "u2", name: "Анна Иванова", initials: "АИ", color: "" }, projectId: "p1", issueId: "i1", payload: { key: "TEST-1", title: "Короткая задача", from: "Todo", to: "Done" }, createdAt: new Date().toISOString(), read: false }], nextCursor: null,
  } }));
  await page.goto("/inbox");
  const row = page.locator("main button.ds-btn.text-left").filter({ hasText: "Короткая задача" });
  await expect(row).toBeVisible();
  const label = row.locator(":scope > .truncate");
  const rowBox = (await row.boundingBox())!;
  const labelBox = (await label.boundingBox())!;
  expect(labelBox.width).toBeGreaterThan(rowBox.width - 30);
  const avatarBox = (await label.locator(":scope > span").first().boundingBox())!;
  const titleBox = (await label.locator(":scope > span").nth(1).boundingBox())!;
  expect(avatarBox.x - labelBox.x).toBeLessThan(2);
  expect(titleBox.x - (avatarBox.x + avatarBox.width)).toBeGreaterThanOrEqual(6);
  expect(titleBox.x - (avatarBox.x + avatarBox.width)).toBeLessThanOrEqual(12);
  await page.screenshot({ path: "shots/inbox-alignment.png", fullPage: true });
});
