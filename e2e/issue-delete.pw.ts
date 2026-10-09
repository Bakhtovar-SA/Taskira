import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { issueFixture } from "./issue-fixture";

for (const mode of ["panel", "page", "list"] as const) for (const width of [1440, 390]) {
  test(`issue deletion requires confirmation (${mode}, ${width})`, async ({ page }) => {
    await issueFixture(page, "dark");
    let deleted = 0;
    await page.route("**/api/projects/p1/issues/i1", route => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleted++;
      return route.fulfill({ json: { ok: true } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (mode === "page") {
      await page.route("**/api/issues/resolve**", route => route.fulfill({ json: { projectId: "p1", id: "i1", projectKey: "CORP" } }));
      await page.goto("/p/CORP/issue/CORP-1");
    } else if (mode === "list") {
      await page.goto("/p/CORP/list");
      await expect(page.locator('[role=row][data-issue-id="i1"]')).toBeVisible();
    } else {
      await page.goto("/p/CORP/board");
      await page.locator('[data-issue-id="i1"]').click();
    }
    const actions = mode === "list" ? page.locator('[role=row][data-issue-id="i1"]').getByRole("button", { name: "Действия", exact: true }) : page.locator(".issue-toolbar").getByRole("button", { name: "Действия", exact: true });
    const openDelete = async () => {
      await actions.click();
      await page.getByRole("menuitem", { name: "Удалить", exact: true }).click();
    };
    await openDelete();
    const confirm = page.getByRole("dialog", { name: "Вы действительно хотите удалить задачу?", exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("CORP-1");
    await expect(confirm).toContainText("Единая авторизация для корпоративных сервисов");
    const box = (await confirm.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(Math.min(480, width - 40));
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(1);
    await expect(confirm.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
    expect(deleted).toBe(0);
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(actions).toBeFocused();
    if (mode === "panel") await expect(page.getByRole("dialog").locator(".issue-detail")).toBeVisible();
    await openDelete();
    await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(deleted).toBe(0);
    await openDelete();
    const axe = await new AxeBuilder({ page }).include('dialog:modal').analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await confirm.screenshot({ path: test.info().outputPath("delete-confirmation.png") });
    await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect.poll(() => deleted).toBe(1);
  });
}

test("viewer cannot open deletion confirmation", async ({ page }) => {
  await issueFixture(page, "light", "viewer");
  await page.goto("/p/CORP/board");
  await page.locator('[data-issue-id="i1"]').click();
  await page.locator(".issue-toolbar").getByRole("button", { name: "Действия", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Удалить", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.goto("/p/CORP/list");
  await page.locator('[role=row][data-issue-id="i1"]').getByRole("button", { name: "Действия", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Удалить", exact: true })).toHaveCount(0);
});

test("list deletion confirmation animates out and restores focus", async ({ page }) => {
  await issueFixture(page, "dark");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/p/CORP/list");
  const actions = page.locator('[role=row][data-issue-id="i1"]').getByRole("button", { name: "Действия", exact: true });
  await actions.click();
  await page.getByRole("menuitem", { name: "Удалить", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Вы действительно хотите удалить задачу?", exact: true });
  await expect(confirm).toBeVisible();
  const closing = await page.evaluateHandle(() => ({ seen: false }));
  await confirm.evaluate((el, result) => {
    const observer = new MutationObserver(() => {
      if (el.getAttribute("data-closing") === "true") { result.seen = true; observer.disconnect(); }
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-closing"] });
  }, closing);
  await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await closing.evaluate(result => result.seen)).toBe(true);
  await closing.dispose();
  await expect(actions).toBeFocused();
  await expect(page.locator('[role=row][data-issue-id="i1"]')).toBeVisible();
});
