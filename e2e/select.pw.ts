/** ds `Select` in the product: the issue card's custom select field (owner's report: «Канал обращения» rendered as a
 *  browser-native list), a settings field and a dashboard widget dialog. Real Chromium checks what jsdom cannot: the
 *  list is in the top layer, Escape closes only the list inside the side panel, the PUT carries the chosen value. With
 *  SELECT_SHOTS=1 the test also saves 1920 and 390 px screenshots to test-results for a visual review. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { issueFixture } from "./issue-fixture";
import { mockApi } from "./fixtures";
import { chooseOption } from "./select-helpers";

const FIELDS = [
  { id: "cf1", name: "Канал обращения", fieldType: "select", options: ["Телефон", "Почта", "Портал", "Чат"], position: 0 },
  { id: "cf2", name: "Уровень поддержки", fieldType: "select", options: ["Первая линия", "Вторая линия", "Третья линия"], position: 1 },
];
const shots = !!process.env.SELECT_SHOTS;
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: test.info().outputPath(`${name}.png`) }); };

for (const width of [1920, 390]) {
  test(`issue card custom select field · ${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width > 1000 ? 1080 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writes = await issueFixture(page, "light", "admin", "ru", false, FIELDS);
    await page.goto("/p/CORP/board");
    await page.locator('[data-issue-id="i1"]').click();
    const panel = page.getByRole("dialog");
    const channel = panel.getByRole("combobox", { name: "Канал обращения" });
    // Below 768 px the remaining properties fold behind «Остальные свойства»; wait for the card before deciding.
    const more = panel.locator(".issue-details-toggle");
    await expect(channel.or(more).filter({ visible: true }).first()).toBeVisible();
    if (await more.isVisible()) await more.click();
    await channel.scrollIntoViewIfNeeded();
    await expect(channel).toHaveText("—");
    expect(await channel.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await channel.evaluate((el) => el.classList.contains("ds-input"))).toBe(true);
    if (width < 1024) expect((await channel.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await channel.click();
    const list = page.getByRole("listbox", { name: "Канал обращения" });
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => el.parentElement!.matches(":popover-open"))).toBe(true);
    await shot(page, `issue-select-open-${width}`);
    const opt = list.getByRole("option", { name: "Портал" });
    if (width < 1024) expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).include("dialog").include("[role=listbox]").exclude("[aria-disabled=true]").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    // Escape: the list closes, the issue card stays open, focus is back on the field.
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(channel).toBeFocused();

    // Choosing by click sends the value; typeahead in Russian picks by first letters.
    await chooseOption(channel, "Почта");
    await expect(channel).toHaveText("Почта");
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/custom-fields/cf1")).map((w) => w.body)).toEqual([{ value: "Почта" }]);
    const level = panel.getByRole("combobox", { name: "Уровень поддержки" });
    await level.focus();
    // Playwright's keyboard has no Cyrillic keys; a Russian layout produces keydown with key «в».
    await level.dispatchEvent("keydown", { key: "в", bubbles: true, cancelable: true });
    await expect(page.getByRole("listbox", { name: "Уровень поддержки" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(level).toHaveText("Вторая линия");
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/custom-fields/cf2")).map((w) => w.body)).toEqual([{ value: "Вторая линия" }]);
    // «—» clears the value (null), as the native empty option did.
    await chooseOption(channel, "—");
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/custom-fields/cf1")).map((w) => w.body)).toEqual([{ value: "Почта" }, { value: null }]);
    await expect(channel).toHaveText("—");
    await shot(page, `issue-select-closed-${width}`);
  });

  test(`settings and widget dialog selects · ${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width > 1000 ? 1080 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("taskira.theme", "dark"));
    await mockApi(page);
    await page.route("**/api/projects/p1/overview", (r) => r.fulfill({ json: { dashboard: null, canEdit: true } }));
    await page.route("**/api/roadmap", (r) => r.fulfill({ json: { projects: [], dependencies: [] } }));
    await page.route("**/api/dashboards/data", (r) => {
      const { widgets } = r.request().postDataJSON();
      return r.fulfill({ json: { results: Object.fromEntries(widgets.map((w: { id: string; type: string }) => [w.id, w.type === "count" ? { type: w.type, value: 2 } : w.type === "breakdown" ? { type: w.type, items: [], total: 0 } : w.type === "trend" ? { type: w.type, weeks: [] } : { type: w.type, items: [], truncated: false }])) } });
    });
    await page.route("**/api/me/tokens**", (r) => r.fulfill({ json: [] }));
    await page.goto("/settings/tokens");
    await page.getByRole("button", { name: "Новый токен", exact: true }).first().click();
    const lifetime = page.getByRole("combobox", { name: "Срок действия" });
    await lifetime.click();
    await expect(page.getByRole("listbox", { name: "Срок действия" })).toBeVisible();
    if (width < 1024) expect((await lifetime.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, `settings-select-open-${width}`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Новый токен" })).toBeVisible();

    await page.goto("/p/TEST/overview");
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await page.getByRole("button", { name: /^Настроить виджет/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Настройки виджета" });
    await expect(dialog).toBeVisible();
    const first = dialog.getByRole("combobox").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(first).toBeFocused();
    await shot(page, `widget-select-open-${width}`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
}

// WorkflowView wraps its selects in <label>: the list renders inside that label, and a click on an option must not be
// turned into a second «click» on the trigger by label activation (the list re-opened right after the choice).
test("a select inside a wrapping label closes after a mouse pick and names its list by the label text", async ({ page }) => {
  await mockApi(page);
  await page.goto("/p/TEST/settings/templates");
  const type = page.getByRole("combobox", { name: /^Тип задачи/ });
  await type.click();
  const list = page.getByRole("listbox", { name: "Тип задачи", exact: true });
  await expect(list).toBeVisible();
  await list.getByRole("option", { name: "Баг" }).click();
  await expect(type).toHaveText("Баг");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(type).toHaveAttribute("aria-expanded", "false");
});
