import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";

for (const [width, height] of [[1920, 1080], [390, 844]]) test(`board selection uses the same floating actions as the list (${width}px)`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height });
  await boardFixture(page, "dark");

  await page.goto("/p/CORP/list");
  const row = page.locator(".list-row").first();
  await row.hover();
  await row.getByRole("checkbox").locator("..").click();
  const listBar = page.locator(".list-selection-dock .list-bulk-bar");
  await expect(listBar).toHaveAttribute("aria-label", "Выбрано: 1");
  await expect(listBar).toBeVisible();
  const alignment = await listBar.evaluate(bar => {
    const count = bar.querySelector<HTMLElement>("[role=status]")!;
    const actions = bar.querySelector<HTMLButtonElement>("[aria-haspopup]")!;
    const closeIcon = bar.querySelector<HTMLButtonElement>("[data-icon]")!.querySelector("svg")!;
    return {
      countSize: getComputedStyle(count).fontSize,
      actionsSize: getComputedStyle(actions).fontSize,
      left: count.getBoundingClientRect().left - bar.getBoundingClientRect().left,
      right: bar.getBoundingClientRect().right - closeIcon.getBoundingClientRect().right,
    };
  });
  expect(alignment.countSize).toBe(alignment.actionsSize);
  expect(alignment.left).toBeCloseTo(alignment.right, 0);
  const listBounds = await listBar.boundingBox();
  await listBar.screenshot({ path: testInfo.outputPath("list-reference.png") });

  await page.goto("/p/CORP/board");
  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  await page.locator(".board-card").first().click();
  const boardBar = page.locator(".list-selection-dock .list-bulk-bar");
  await expect(boardBar).toHaveAttribute("aria-label", "Выбрано: 1");
  await expect(boardBar).toBeVisible();
  await expect(page.locator(".workspace-view-header [role=toolbar]")).toHaveCount(0);
  const boardBounds = await boardBar.boundingBox();
  await boardBar.screenshot({ path: testInfo.outputPath("board-result.png") });
  expect(boardBounds!.width).toBeCloseTo(listBounds!.width, 0);
  expect(boardBounds!.height).toBeCloseTo(listBounds!.height, 0);
  expect(boardBounds!.x).toBeCloseTo(listBounds!.x, 0);
  expect(height - boardBounds!.y - boardBounds!.height).toBeCloseTo(height - listBounds!.y - listBounds!.height, 0);
  expect(boardBounds!.y).toBeGreaterThan(height - 180);

  await boardBar.getByRole("button", { name: "Действия", exact: true }).click();
  await expect(page.locator(".bulk-action-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await boardBar.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(page.locator(".list-selection-dock")).toHaveCount(0);
});

test("touch dock keeps equal visible side spacing", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await boardFixture(page, "dark");
    await page.goto("/p/CORP/list");
    const row = page.locator(".list-row").first();
    await row.getByRole("checkbox").locator("..").click();
    const spacing = await page.locator(".list-bulk-bar").evaluate(bar => {
      const count = bar.querySelector<HTMLElement>("[role=status]")!;
      const closeIcon = bar.querySelector<HTMLButtonElement>("[data-icon]")!.querySelector("svg")!;
      return {
        left: count.getBoundingClientRect().left - bar.getBoundingClientRect().left,
        right: bar.getBoundingClientRect().right - closeIcon.getBoundingClientRect().right,
      };
    });
    expect(spacing.left).toBeCloseTo(spacing.right, 0);
  } finally {
    await context.close();
  }
});
