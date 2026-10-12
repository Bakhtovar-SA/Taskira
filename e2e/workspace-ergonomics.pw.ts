import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { homeFixture } from "./home-fixture";
import { issueFixture } from "./issue-fixture";

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
      // Pins the ultrawide profile (2560–3199 CSS px, zoom 1.1, --lane-max 376px => ~317-414px, see refinement-2026-10-10/report.md);
      // >=3200 px is the very wide profile at 90% of it, tested below.
      expect(lane.width).toBeLessThanOrEqual(420);
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
    expect(content.width).toBeLessThanOrEqual(1440 * 1.1 + 1); // max-width 1440 CSS px, measured under the 1.1 ultrawide zoom
    expect(Math.abs(content.x + content.width / 2 - home.x - home.width / 2)).toBeLessThan(1);
    await page.screenshot({ path: test.info().outputPath(`home-wide-${theme}.png`) });
  });
}

/** >=3200 CSS px (3440×1440 at browser zoom 100%): the 2560 profile at ~90% — root zoom 0.99 instead of 1.1, same
 *  tokens. Measured values: docs/design/refinement-2026-10-10/width-sweep.json. */
for (const theme of ["light", "dark"]) {
  test(`very wide 3440 profile is the ultrawide one at 90% (${theme})`, async ({ page }) => {
    test.setTimeout(60_000);
    await issueFixture(page, theme);
    await page.setViewportSize({ width: 3440, height: 1440 });
    await page.goto("/p/CORP/board");
    await expect(page.locator(".board-card")).toHaveCount(8);
    expect(await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom))).toBeCloseTo(0.99, 3);
    expect((await page.locator("aside").boundingBox())!.width).toBeCloseTo(304 * 0.99, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const lanes = await page.locator(".board-col").evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
    expect(lanes).toHaveLength(4);
    // 2560 profile: 288–376 CSS px × 1.1; here × 0.99, i.e. 0.9 of it.
    for (const w of lanes) { expect(w).toBeGreaterThanOrEqual(288 * 0.99 - 1); expect(w).toBeLessThanOrEqual(376 * 0.99 + 1); }
    expect(await page.locator(".board-card h3").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) * ((el as unknown as { currentCSSZoom: number }).currentCSSZoom))).toBeCloseTo(16 * 0.99, 1);

    // Menus are positioned in visual px under the root zoom: next to their trigger and inside the window.
    const card = page.locator('[data-issue-id="i8"]');
    await card.hover();
    const trigger = card.getByRole("button", { name: "Переместить CORP-8" });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const [t, m] = [(await trigger.boundingBox())!, (await menu.boundingBox())!];
    expect(Math.abs(m.y - (t.y + t.height))).toBeLessThan(12);
    expect(Math.abs(m.x + m.width - (t.x + t.width))).toBeLessThan(12);
    expect(m.x + m.width).toBeLessThanOrEqual(3440); expect(m.y + m.height).toBeLessThanOrEqual(1440);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: test.info().outputPath(`board-3440-${theme}.png`) });

    // The issue side panel fits the window height under the zoom (--viewport-h divides by the same 0.99).
    await page.locator('[data-issue-id="i1"]').click();
    const panel = page.getByRole("dialog");
    await expect(panel.locator(".issue-title")).toBeVisible();
    const p = (await panel.boundingBox())!;
    expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y + p.height).toBeLessThanOrEqual(1440 + 1);
    expect(p.height).toBeGreaterThan(1440 - 40);
    expect((await panel.locator(".issue-properties").boundingBox())!.width).toBeCloseTo(384 * 0.99, 0);
    await page.screenshot({ path: test.info().outputPath(`issue-3440-${theme}.png`) });
    await page.keyboard.press("Escape");

    await page.goto("/p/CORP/list?done=1");
    await expect(page.locator(".list-row")).toHaveCount(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`list-3440-${theme}.png`) });
    await homeFixture(page, theme);
    await page.goto("/");
    await expect(page.locator(".home-task")).toHaveCount(5);
    expect((await page.locator(".home-content").boundingBox())!.width).toBeLessThanOrEqual(1440 * 0.99 + 1);
    await page.screenshot({ path: test.info().outputPath(`home-3440-${theme}.png`) });
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
