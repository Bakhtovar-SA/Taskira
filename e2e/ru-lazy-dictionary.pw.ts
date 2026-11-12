import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";

// The Russian dictionary is split: ruCore ships with startup, ruLazy is a separate chunk that every lazy screen waits
// for (lazyView() in src/i18n). On a slow network the screen must stay behind its fallback until the strings arrive,
// never render with blank labels.
test("a lazy screen waits for the lazy part of the Russian dictionary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boardFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = 0;
  await page.route(/ruLazy/, async (route) => { requested++; await held; await route.continue(); });

  await page.goto("/p/CORP/list");
  await expect.poll(() => requested).toBeGreaterThan(0);
  // Startup shell is complete from ruCore alone: navigation has its labels.
  await expect(page.getByRole("navigation").first()).toContainText("Входящие");
  // The list itself is not rendered while its strings are missing.
  await page.waitForTimeout(700);
  await expect(page.locator(".list-row")).toHaveCount(0);
  await expect(page.locator(".list-head")).toHaveCount(0);

  release();
  await expect(page.locator(".list-row")).toHaveCount(7);
  await expect(page.getByRole("columnheader", { name: "Исполнитель" })).toHaveText("Исполнитель");
  // No control on the screen is left without an accessible name or text.
  const blank = await page.evaluate(() => [...document.querySelectorAll("button, [role=columnheader], h1, h2")]
    .filter((el) => !(el.textContent ?? "").trim() && !el.getAttribute("aria-label") && !el.querySelector("svg, img")).length);
  expect(blank).toBe(0);
});
