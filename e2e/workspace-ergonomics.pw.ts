import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { homeFixture } from "./home-fixture";

for (const theme of ["light", "dark"]) {
  test(`workspace stays readable without stretching on a 4K screen (${theme})`, async ({ page }) => {
    await boardFixture(page, theme);
    await page.setViewportSize({ width: 3160, height: 1260 });
    await page.goto("/p/CORP/board");
    await expect(page.locator(".board-card")).toHaveCount(8);
    const lanes = await page.locator(".board-col").evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    expect(lanes).toHaveLength(4);
    for (const lane of lanes) {
      expect(lane.width).toBeGreaterThanOrEqual(260);
      expect(lane.width).toBeLessThanOrEqual(340);
      expect(lane.height).toBeLessThan(600);
    }
    await page.screenshot({ path: test.info().outputPath(`board-wide-${theme}.png`) });
    await page.goto("/p/CORP/list?done=1");
    await expect(page.locator(".list-row")).toHaveCount(9);
    const table = (await page.locator(".list-table").boundingBox())!;
    const list = (await page.locator(".list-view").boundingBox())!;
    expect(table.width).toBeLessThan(1400);
    expect(Math.abs(table.x + table.width / 2 - list.x - list.width / 2)).toBeLessThan(1);
    expect((await page.locator(".list-row [data-col=title]").first().boundingBox())!.width).toBeLessThan(550);
    await page.screenshot({ path: test.info().outputPath(`list-wide-${theme}.png`) });
    await homeFixture(page, theme);
    await page.goto("/");
    await expect(page.locator(".home-task")).toHaveCount(5);
    const content = (await page.locator(".home-content").boundingBox())!;
    const home = (await page.locator(".home-view").boundingBox())!;
    expect(content.width).toBeLessThanOrEqual(1440);
    expect(Math.abs(content.x + content.width / 2 - home.x - home.width / 2)).toBeLessThan(1);
    await page.screenshot({ path: test.info().outputPath(`home-wide-${theme}.png`) });
  });
}

test("a long board lane scrolls to its last card while the header stays reachable", async ({ page }) => {
  const { issues } = await boardFixture(page);
  const many = Array.from({ length: 100 }, (_, n) => ({ ...issues[0], id: `long-${n}`, key: `CORP-${n + 10}`, title: `Задача ${n + 1}`, rank: n }));
  await page.route("**/api/projects/p1/issues**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/counts")) return route.fulfill({ json: { total: 100, byStatus: { s1: 100, s2: 0, s3: 0, s4: 0 } } });
    if (url.pathname === "/api/projects/p1/issues") return route.fulfill({ json: { items: url.searchParams.get("status") && url.searchParams.get("status") !== "s1" ? [] : many, hasMore: false, nextCursor: null } });
    return route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/CORP/board");
  const lane = page.locator(".board-col").first();
  await expect(lane.locator(".board-card")).toHaveCount(100);
  const header = await lane.locator("header").boundingBox();
  const body = lane.locator(".board-col-body");
  expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(lane.locator(".board-card").last()).toBeInViewport();
  const settledHeader = (await lane.locator("header").boundingBox())!;
  for (const edge of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(settledHeader[edge] - header![edge])).toBeLessThan(0.1);
  }
  await expect(page.getByRole("button", { name: "Добавить в «Готово»", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить в «К выполнению»", exact: true }).click();
  await expect(lane.getByRole("textbox")).toBeVisible();
});
