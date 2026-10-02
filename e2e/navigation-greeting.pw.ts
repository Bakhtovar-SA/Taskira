import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const lang of ["ru", "en"]) test(`help labels have no numbers and align right (${lang})`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem("taskira.lang", lang), lang);
  await mockApi(page);
  await page.goto("/help");
  const buttons = page.locator("main nav button");
  await expect(buttons.first()).toBeVisible();
  await expect(buttons).toHaveCount(await page.locator('main section[id^="doc-"]').count());
  for (const button of await buttons.all()) {
    expect(await button.innerText()).not.toMatch(/^\d/);
    await expect(button).toHaveCSS("text-align", "right");
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
