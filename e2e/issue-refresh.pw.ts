import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { issueFixture } from "./issue-fixture";
test.setTimeout(60_000);

async function openIssue(page: import("@playwright/test").Page) {
  await page.goto("/p/CORP/board");
  await page.locator('[data-issue-id="i1"]').click();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Комментарии · 1" })).toBeVisible();
  return page.getByRole("dialog");
}

test("issue refresh: workflow action, overdue text, visible properties and subscription", async ({ page }) => {
  const writes = await issueFixture(page);
  const panel = await openIssue(page);
  await expect(panel.getByText("Дополнительные свойства")).toHaveCount(0);
  await expect(panel.getByText("просрочено 2 дня", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Октябрьский запуск" })).toBeVisible();
  await panel.getByRole("button", { name: "Взять в работу" }).click();
  await expect(panel.locator(".issue-action-row").getByRole("button", { name: "Готово", exact: true })).toBeVisible();
  expect(writes.find(w => w.path.endsWith("/transition"))?.body).toEqual({ to: "s2", beforeId: null });
  await panel.getByRole("button", { name: "Отписаться", exact: true }).click();
  await expect(panel.getByText("Вы не подписаны на задачу")).toBeVisible();
  expect(writes.some(w => w.path.endsWith("/watchers/me") && w.method === "DELETE")).toBe(true);
});

test("issue refresh: tabs with keyboard and comment after the feed", async ({ page }) => {
  const writes = await issueFixture(page);
  const panel = await openIssue(page);
  const tab = panel.getByRole("tab", { name: "Всё", exact: true });
  await tab.focus(); await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "Комментарии · 1" })).toBeFocused();
  await expect(panel.getByRole("tabpanel")).toContainText("Можно брать в работу");
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "История · 1" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("tabpanel")).not.toContainText("Можно брать в работу");
  await panel.getByRole("textbox", { name: "Комментарии", exact: true }).fill("Проверено");
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => writes.filter(w => w.path.endsWith("/comments")).length).toBe(1);
  await expect(panel.getByRole("textbox", { name: "Комментарии", exact: true })).toHaveValue("");
  await panel.getByRole("tab", { name: "Комментарии · 2" }).click();
  await expect(panel.getByRole("tabpanel")).toContainText("Проверено");
});

test("issue refresh: permissions hide workflow and editing for viewer", async ({ page }) => {
  const writes = await issueFixture(page, "light", "viewer", "ru", false);
  const panel = await openIssue(page);
  await expect(panel.getByRole("button", { name: "Взять в работу" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Переименовать/ })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Комментарии" })).toHaveCount(0);
  await expect(panel.getByText("Спринт", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Сложность", { exact: true })).toBeVisible();
  await expect(panel.getByText("просрочено 2 дня", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("issue refresh: files dropped anywhere in panel use the upload endpoint under CSP", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => {
    document.documentElement.dataset.issueCspViolation = event.violatedDirective;
  }));
  const writes = await issueFixture(page);
  const panel = await openIssue(page);
  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["notes"], "notes.txt", { type: "text/plain" })); return transfer;
  });
  await panel.locator(".issue-heading").dispatchEvent("dragover", { dataTransfer: transfer });
  await panel.locator(".issue-heading").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(panel.getByRole("button", { name: "notes.txt" })).toBeVisible();
  expect(writes.some(w => w.path.endsWith("/attachments"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.issueCspViolation)).toBeUndefined();
  await transfer.dispose();
});

for (const width of [390, 320]) test(`issue refresh: mobile order and targets at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await issueFixture(page, "dark");
  const panel = await openIssue(page);
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const name of ["Действия", "Закрыть"]) {
    const box = (await panel.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect((await panel.getByRole("textbox", { name: "Метки", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await panel.locator(".issue-properties").boundingBox())!.y).toBeLessThan((await panel.locator(".issue-content").boundingBox())!.y);
  await panel.getByRole("button", { name: "Действия", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Открыть полностью" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze();
  expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
