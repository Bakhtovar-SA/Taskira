import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

// Трек N, FIX-01 и FIX-12: после пружины на элементе не остаётся inline-стиль последнего кадра (он перебивает классы:
// ширина сайдбара, прозрачность силуэта при перетаскивании), а после переноса карточки клавишей фокус возвращается на неё.
test("пружины не оставляют inline-стили; фокус возвращается на перенесённую карточку", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await boardFixture(page);
  await page.route("**/api/projects/p1/issues/i1", route => route.request().method() === "GET" ? route.fulfill({ json: f.issues[0] }) : route.fallback());
  await page.route("**/api/projects/p1/issues/i1/transition", async route => {
    const issue = f.issues[0] as Record<string, unknown>;
    issue.statusId = route.request().postDataJSON().to;
    issue.updatedAt = "2026-10-13T12:00:00Z";
    await route.fulfill({ json: issue });
  });
  const loaded = loadMotion(page);
  await page.goto("/p/CORP/board");
  const card = page.locator('article[data-issue-id="i1"]');
  await expect(card).toBeVisible();

  // Сайдбар: свернуть и развернуть (дважды, чтобы вторая пружина шла уже загруженным движком) — inline-ширины нет.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("[");
    if (i === 0) await loaded;
    await settle(page);
    await page.keyboard.press("[");
    await settle(page);
  }
  expect(await page.evaluate(() => [...document.querySelectorAll("aside")].map(a => (a as HTMLElement).style.width))).toEqual([""]);

  // Перенос с клавиатуры: M → «В работе».
  await card.locator(".board-card-open").focus();
  await page.keyboard.press("m");
  await page.getByRole("menuitem", { name: "В работе" }).click();
  // Фокус — на кнопке карточки в новой колонке (после полёта), inline-стили сняты.
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.classList.contains("board-card-open") ? active.closest("article")?.getAttribute("data-issue-id") : null;
  }), { timeout: 10_000 }).toBe("i1");
  await settle(page);
  const inline = await card.evaluate(el => ({ transform: (el as HTMLElement).style.transform, opacity: (el as HTMLElement).style.opacity }));
  expect(inline).toEqual({ transform: "", opacity: "" });
});


// Трек N, FIX-02: личный выключатель «Уменьшить движение» в «Внешний вид» — атрибут на <html>, переживает перезагрузку
// (public/theme-init.js ставит его до первой отрисовки), CSS-анимации гасятся общим правилом.
test("выключатель «Уменьшить движение»: атрибут, перезагрузка, анимации гасятся", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boardFixture(page);
  await page.goto("/settings/appearance");
  const toggle = page.getByRole("switch", { name: "Уменьшить движение" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-motion"))).toBeNull();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-motion"))).toBe("reduce");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Уменьшить движение" })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-motion"))).toBe("reduce");
  // Общее правило: у экрана с анимацией входа (anim-view) нулевая длительность.
  const duration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "anim-view";
    document.body.appendChild(probe);
    const d = getComputedStyle(probe).animationDuration;
    probe.remove();
    return d;
  });
  expect(duration).toBe("0s");
  // Выключить обратно.
  await page.getByRole("switch", { name: "Уменьшить движение" }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-motion"))).toBeNull();
});
