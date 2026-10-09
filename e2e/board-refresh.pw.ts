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
  expect(await page.locator(".board-scroll").evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(columns >= 5);
  await expect(page.getByRole("button", { name: "Добавить в «В работе»", exact: true })).toHaveCount(0);
  const col = page.locator(".board-col").first();
  await col.getByRole("button", { name: "Добавить в «К выполнению»", exact: true }).click();
  await expect(col.getByRole("textbox")).toBeFocused();
  const posted = page.waitForRequest(r => r.url().endsWith("/projects/p1/issues") && r.method() === "POST");
  await col.getByRole("textbox").fill("Создано к выполнению"); await page.keyboard.press("Enter");
  expect((await posted).postDataJSON().statusId).toBe("s1");
  await expect(col.getByRole("heading", { name: "Создано к выполнению" })).toBeVisible();
});

test("board refresh: English toolbar", async ({ page }) => {
  await boardFixture(page, "light", 4, "en");
  await page.goto("/p/CORP/board");
  await expect(page.getByRole("textbox", { name: "Filter issues" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mine", exact: true })).toHaveText("Mine");
  await expect(page.getByRole("button", { name: "Grouping: none" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Board photo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select", exact: true })).toBeVisible();
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

test("board can clear URL-only conditions through its filter summary", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/board?priority=high&label=internal-label");
  const summary = page.locator(".active-filter-summary");
  await expect(summary).toContainText("Приоритет: Высокий");
  await expect(summary).toContainText("internal-label");
  await summary.getByRole("button", { name: /Сбросить/ }).click();
  await expect(page).not.toHaveURL(/priority=|label=/);
  await expect(summary).toHaveCount(0);
});

test("assignee overflow preserves avatar order and marks the active filter", async ({ page }) => {
  const { project, users, statuses } = await boardFixture(page);
  const allUsers = [...users, ...[3, 4, 5, 6].map(n => ({ ...users[1], id: `u${n}`, username: `user${n}`, name: `Исполнитель ${n}`, initials: `И${n}` })),
    { ...users[1], id: "svc", username: "service", name: "Сервисный бот", authSource: "service" }];
  await page.route("**/api/projects/p1", route => route.fulfill({ json: {
    project, users: allUsers, members: allUsers.map(user => ({ userId: user.id, role: "employee" })),
    workflow: { statuses, transitions: [] }, issueTemplates: [], customFields: [], sprints: [],
  } }));
  await page.route("**/api/projects/p1/issues/assignees*", route => route.fulfill({ json: {
    items: allUsers.map(user => ({ userId: user.id, count: 1 })), truncated: false, limit: 24,
  } }));
  await page.goto("/p/CORP/board");
  const avatars = page.locator(".board-member-filter");
  await expect(avatars).toHaveCount(4);
  const before = await avatars.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  const more = page.locator(".board-member-more");
  await expect(more).not.toHaveAttribute("data-active", "true");
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Сервисный бот" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Исполнитель 5" }).click();
  await expect(page).toHaveURL(/assignee=u5/);
  await expect(more).toHaveAttribute("data-active", "true");
  await expect(more).toHaveAttribute("aria-label", /Исполнитель 5/);
  expect(await avatars.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")))).toEqual(before);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Исполнитель 5" }).locator("svg")).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Исполнитель 5" }).click();
  await expect(page).not.toHaveURL(/assignee=/);
  await expect(more).not.toHaveAttribute("data-active", "true");
});

for (const width of [390, 320]) test(`board refresh: mobile targets and no overflow at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await boardFixture(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator(".workspace-controls button").all()) expect(Number((await button.boundingBox())!.height.toFixed(2))).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".board-col").last()).toBeVisible();
});

test.describe("touch board guidance", () => {
  test.use({ hasTouch: true });
  test("move guidance and card action remain visible without hover", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await boardFixture(page);
    await page.goto("/p/CORP/board");
    await expect(page.locator(".board-move-touch-hint")).toBeVisible();
    const move = page.locator('[data-issue-id="i1"] button[aria-keyshortcuts="M"]');
    await expect(move).toBeVisible();
    const box = (await move.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await move.click();
    await expect(page.getByRole("menuitem", { name: "В работе", exact: true })).toBeVisible();
  });
});
