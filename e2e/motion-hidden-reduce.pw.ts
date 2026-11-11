import { expect, test, type Page } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

// Трек O, B-06: скрытая вкладка и смена «уменьшить движение» на лету. План — docs/tracks/TRACK-O-MOTION-WAVE2.md §B-06.

async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await boardFixture(page);
  for (const issue of f.issues.slice(0, 2)) {
    await page.route(`**/api/projects/p1/issues/${issue.id}`, route => route.request().method() === "GET" ? route.fulfill({ json: issue }) : route.fallback());
    await page.route(`**/api/projects/p1/issues/${issue.id}/transition`, async route => {
      const row = issue as Record<string, unknown>;
      row.statusId = route.request().postDataJSON().to;
      row.updatedAt = "2026-10-13T12:00:00Z";
      await route.fulfill({ json: row });
    });
  }
  const loaded = loadMotion(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator('article[data-issue-id="i1"]')).toBeVisible();
  await page.keyboard.press("["); await loaded; await page.keyboard.press("["); // прогреть движок
  await settle(page);
}
async function moveByKey(page: Page, id: string) {
  await page.locator(`article[data-issue-id="${id}"] .board-card-open`).focus();
  await page.keyboard.press("m");
  await page.getByRole("menuitem", { name: "В работе", exact: true }).click();
}
/** Записывает каждое появление «летящей» копии карточки — снимок не пропустит и мгновенное исчезновение. */
const watchFlights = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __flights: number };
  w.__flights = 0;
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.classList.contains("flip-flight")) w.__flights++;
  }).observe(document.body, { childList: true, subtree: true });
});
const flights = (page: Page) => page.evaluate(() => (window as unknown as { __flights: number }).__flights);

test("B-06: смена reduce на лету — идущий перенос доигрывается, следующий мгновенный", async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page);
  await watchFlights(page);
  await moveByKey(page, "i1");
  await expect.poll(() => flights(page)).toBe(1); // первый перенос — с движением
  await page.emulateMedia({ reducedMotion: "reduce" }); // на середине полёта
  await settle(page);
  await expect(page.locator(".flip-flight")).toHaveCount(0);
  await moveByKey(page, "i2");
  await expect(page.locator('article[data-issue-id="i2"]')).toBeVisible();
  await settle(page);
  expect(await flights(page), "после включения reduce новых полётов нет").toBe(1);
});

test("B-06: заморозка вкладки (CDP frozen) во время переноса — после возврата нет призраков и скрытых карточек", async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page);
  const cdp = await page.context().newCDPSession(page);
  await watchFlights(page);
  await moveByKey(page, "i1");
  await expect.poll(() => flights(page)).toBe(1);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  // Страховочный таймер fly() — 1 с; в замороженной вкладке он не идёт, за паузу его срок заведомо проходит.
  await new Promise<void>(resolve => setTimeout(resolve, 1500));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await settle(page);
  await expect(page.locator(".flip-flight")).toHaveCount(0);
  const card = page.locator('article[data-issue-id="i1"]');
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  expect(await card.evaluate(el => getComputedStyle(el).visibility)).not.toBe("hidden");
  expect(await card.evaluate(el => ({ transform: (el as HTMLElement).style.transform, opacity: (el as HTMLElement).style.opacity }))).toEqual({ transform: "", opacity: "" });
});
