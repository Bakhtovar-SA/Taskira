import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";
import { renderOne, renderDigest } from "../server/src/services/emailTemplates";
import { mailAccent } from "../server/src/services/mailBrand";

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) for (const hue of [145, 235, 300]) test(`navigation colours, rail and mobile (${theme}/${hue})`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { navigationCspViolations: violations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
  });
  await mockApi(page);
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: "Example", hue, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.goto("/p/TEST/board");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h").trim())).toBe(String(hue));
  const neutral = await page.evaluate(() => {
    const el = document.createElement("span"); el.style.color = "var(--text-2)"; document.body.append(el);
    const color = getComputedStyle(el).color; el.remove(); return color;
  });
  const accent = await page.evaluate(() => {
    const el = document.createElement("span"); el.style.color = "var(--accent-text)"; document.body.append(el);
    const color = getComputedStyle(el).color; el.remove(); return color;
  });
  const side = page.getByRole("complementary", { name: "Меню", exact: true });
  const inbox = side.getByRole("button", { name: "Входящие", exact: true });
  await expect(inbox.locator("svg").first()).toHaveCSS("color", neutral);
  await expect(page.locator(".tk-nav-glyph-active svg").first()).toHaveCSS("color", accent);
  await inbox.focus(); await expect(inbox).toBeFocused();
  await inbox.click(); await expect(inbox).toHaveAttribute("aria-current", "page");
  await expect(inbox.locator("svg").first()).toHaveCSS("color", accent);
  await page.screenshot({ path: `shots/nav-${theme}-${hue}.png` });
  await side.getByRole("button", { name: "Свернуть панель", exact: true }).click();
  await expect(side.getByRole("button", { name: "Входящие", exact: true }).locator("svg").first()).toHaveCSS("color", accent);
  const railInbox = side.getByRole("button", { name: "Входящие", exact: true });
  const railBox = await railInbox.boundingBox(), iconBox = await railInbox.locator("svg").first().boundingBox();
  expect(Math.abs(iconBox!.x + iconBox!.width / 2 - railBox!.x - railBox!.width / 2)).toBeLessThanOrEqual(1);
  expect(iconBox!.width).toBe(22);
  await page.screenshot({ path: `shots/rail-${theme}-${hue}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(side).toBeVisible();
  await expect(side.getByRole("button", { name: "Входящие", exact: true }).locator("svg").first()).toHaveCSS("color", accent);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as {navigationCspViolations: string[]}).navigationCspViolations)).toEqual([]);
});

test("reminder intervals persist, protect an in-flight save and can all be disabled", async ({ page }) => {
  await mockApi(page);
  let days = [1, 0];
  await page.route("**/api/notifications/prefs", async route => {
    if (route.request().method() === "PATCH") {
      days = route.request().postDataJSON().dueReminderDays ?? days;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await route.fulfill({ json: { notifyPrefs: { dueReminderDays: days } } });
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { id: "u1", username: "admin", name: "Test Admin", initials: "TA", globalRole: "admin", isActive: true, authSource: "local", notifyPrefs: { dueReminderDays: days }, onboarding: { hidden: true } } }));
  await page.goto("/settings/notifications");
  const one = page.getByRole("switch", { name: "За день", exact: true });
  const seven = page.getByRole("switch", { name: "За 7 дней", exact: true });
  await expect(one).toHaveAttribute("aria-checked", "true");
  await seven.click(); await expect(one).toHaveAttribute("aria-disabled", "true");
  await expect(seven).toHaveAttribute("aria-checked", "true");
  await expect(one).not.toHaveAttribute("aria-disabled");
  await page.reload(); await expect(seven).toHaveAttribute("aria-checked", "true");
  for (const name of ["За 7 дней", "За день", "В день срока"]) {
    const toggle = page.getByRole("switch", { name, exact: true });
    await toggle.click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).not.toHaveAttribute("aria-disabled");
  }
  expect(days).toEqual([]);
});

for (const lang of ["ru", "en"] as const) test(`email previews stay responsive and escape data (${lang})`, async ({ page }) => {
  const item = { type: "issue.dueSoon" as const, issueKey: "LONG-PROJECT-KEY-1234567890", projectKey: "LONG-PROJECT-KEY", issueId: "i", projectId: "p", dueDate: "2026-10-10" };
  for (const width of [390, 1280]) for (const digest of [false, true]) {
    const brand = { name: "Example & Company", accent: mailAccent(145) };
    const mail = digest ? renderDigest("https://taskira.test", [item, { ...item, type: "issue.assigned" }], lang, brand) : renderOne("https://taskira.test", item, lang, brand);
    await page.setViewportSize({ width, height: 900 }); await page.setContent(mail.html);
    await expect(page.locator("body")).toContainText(brand.name);
    await expect(page.locator("body")).toContainText(item.dueDate);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `shots/mail-${lang}-${digest ? "digest" : "single"}-${width}.png`, fullPage: true });
  }
});


test("saved brand stays applied after the logo returns to home", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { navigationCspViolations: violations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
  });
  await mockApi(page);
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: "Megafon", hue: 145, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.goto("/p/TEST/board");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h").trim())).toBe("145");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h"));
  await page.getByRole("button", { name: "На главный экран", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h"))).toBe(accent);
  await expect(page.locator("html")).toHaveAttribute("data-brand-palette", "extended");
});
