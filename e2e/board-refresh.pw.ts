import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
test.setTimeout(60_000);

test("board refresh: card hierarchy, due states and closed critical priority", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", event => {
      document.documentElement.dataset.boardCspViolation = event.violatedDirective;
    });
  });
  await boardFixture(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  const card = page.locator('[data-issue-id="i1"]');
  await expect(card.locator(":scope > :first-child h3")).toHaveText("Единая авторизация для корпоративных сервисов");
  await expect(card.locator(".board-card-direction")).toHaveText("Корпоративная платформа");
  await expect(page.locator(".board-card").getByText("internal-label")).toHaveCount(0);
  await expect(card.locator(".board-card-due")).toHaveAttribute("data-urgency", "late");
  for (const [id, urgency] of [["i2", "soon"], ["i3", "later"], ["i8", "done"]]) {
    await expect(page.locator(`[data-issue-id="${id}"] .board-card-due`)).toHaveAttribute("data-urgency", urgency);
  }
  await expect(page.locator('[data-issue-id="i8"]')).not.toHaveAttribute("data-priority", "critical");
  expect((await card.locator(".ds-av").first().boundingBox())!.width).toBe(22);
  await card.focus(); await page.keyboard.press("m");
  await expect(page.getByRole("menuitem", { name: "В работе", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: "Переместить CORP-1" })).toBeFocused();
  expect(await card.locator(".board-card-direction i").evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await page.evaluate(() => document.documentElement.dataset.boardCspViolation)).toBeUndefined();
});

for (const columns of [4, 5, 6]) test(`board refresh: ${columns} statuses at 1440`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boardFixture(page, "light", columns);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-col")).toHaveCount(columns);
  expect(await page.locator(".board-scroll").evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(columns >= 6);
  const col = page.locator(".board-col").nth(1);
  await col.getByRole("button", { name: "Добавить в «В работе»", exact: true }).click();
  await expect(col.getByRole("textbox")).toBeFocused();
  const posted = page.waitForRequest(r => r.url().endsWith("/projects/p1/issues") && r.method() === "POST");
  await col.getByRole("textbox").fill("Создано в работе"); await page.keyboard.press("Enter");
  expect((await posted).postDataJSON().statusId).toBe("s2");
  await expect(col.getByRole("heading", { name: "Создано в работе" })).toBeVisible();
});

test("board refresh: English toolbar", async ({ page }) => {
  await boardFixture(page, "light", 4, "en");
  await page.goto("/p/CORP/board");
  await expect(page.getByRole("textbox", { name: "Filter issues" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mine", exact: true })).toHaveText("Mine");
  await expect(page.getByRole("button", { name: "Grouping: none" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View settings", exact: true })).toHaveText("View");
});

test("board refresh: quick filters restore from URL and compose with overdue", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/board?assignee=u1");
  const mine = page.getByRole("button", { name: "Мои задачи", exact: true });
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await mine.click(); await expect(page).not.toHaveURL(/assignee=/);
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await expect(page).toHaveURL(/overdue=1/);
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();
  await expect(page).toHaveURL(/assignee=none/);
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Без исполнителя", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Просрочено", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("/"); await expect(page.getByRole("textbox", { name: "Фильтр задач" })).toBeFocused();
});

for (const width of [390, 320]) test(`board refresh: mobile targets and no overflow at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await boardFixture(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator(".workspace-controls button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".board-col").last()).toBeVisible();
});
