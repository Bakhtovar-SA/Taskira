import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { roadmapFixture } from "./roadmap-fixture";

test("roadmap refresh: geometry, months, independent scroll and strict dependencies", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await roadmapFixture(page); await page.goto("/roadmap");
  await expect(page.locator(".roadmap-project-row")).toHaveCount(5);
  expect((await page.locator(".roadmap-toolbar").boundingBox())!.height).toBeCloseTo(52, 2);
  expect((await page.locator(".roadmap-projects").boundingBox())!.width).toBeCloseTo(300, 2);
  expect((await page.locator(".roadmap-project-row").first().boundingBox())!.height).toBeCloseTo(56, 2);
  expect((await page.locator(".roadmap-headings").boundingBox())!.height).toBeCloseTo(44, 2);
  expect((await page.locator(".roadmap-legend").boundingBox())!.height).toBeCloseTo(40, 2);
  expect((await page.locator(".roadmap-bar-track").first().boundingBox())!.height).toBeCloseTo(26, 2);
  await expect(page.locator(".rm-today-line")).toHaveCSS("width", "2px");
  const months = await page.locator(".rm-month").evaluateAll(els => els.slice(1,-1).map(el => el.getBoundingClientRect().width));
  expect(months.every(w => Math.abs(w-96)<0.01)).toBe(true);
  const chip = (await page.locator(".rm-today-chip").boundingBox())!, month = (await page.locator(".rm-month").filter({ hasText: "окт" }).boundingBox())!;
  expect(chip.y + chip.height).toBeLessThanOrEqual(month.y);
  await expect(page.locator('.roadmap-project-row[data-project-id=p1] small')).toHaveText("Пилотный запуск · 12 окт");
  const early = page.locator(".roadmap-milestone").filter({ hasText: "Подготовка" });
  await expect(early).toHaveAttribute("data-raised", "true");
  const keyBox = (await page.locator('.roadmap-timeline-row[data-project-id=p1] .roadmap-bar-key').boundingBox())!;
  const labelBox = (await early.locator("span").boundingBox())!;
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(keyBox.y + 4);
  expect(await page.locator(".roadmap-dependencies > path").evaluateAll(els => els.map(el => el.getAttribute("marker-end")))).toEqual(["url(#rm-arrow-late)", "url(#rm-arrow)", "url(#rm-arrow)"]);
  const name = page.locator('.roadmap-project-row[data-project-id=p1] strong'), box = (await name.boundingBox())!;
  await page.locator(".roadmap-timeline").evaluate(el => el.scrollLeft += 400);
  await expect.poll(() => page.locator(".roadmap-scale-shift").evaluate(el => Math.round(-new DOMMatrix(getComputedStyle(el).transform).m41))).toBe(await page.locator(".roadmap-timeline").evaluate(el => Math.round(el.scrollLeft)));
  expect((await name.boundingBox())!.x).toBeCloseTo(box.x, 2);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect.poll(() => page.locator(".roadmap-timeline").evaluate(el => { const line = el.querySelector(".rm-today-line")!.getBoundingClientRect(), area = el.getBoundingClientRect(); return line.x >= area.x && line.x < area.right; })).toBe(true);
  const today = (await page.locator(".rm-today-line").boundingBox())!, timeline = (await page.locator(".roadmap-timeline").boundingBox())!;
  expect(today.x).toBeGreaterThanOrEqual(timeline.x);
  expect(today.x).toBeLessThan(timeline.x + timeline.width);
});

test("roadmap refresh: department filter, keyboard menu, project default view and date editing", async ({ page }) => {
  await roadmapFixture(page); await page.goto("/roadmap");
  await page.getByRole("button", { name: "Все отделы", exact: true }).click();
  await page.getByRole("menuitem", { name: "Юридический отдел с длинным названием", exact: true }).click();
  await expect(page.locator(".roadmap-project-row")).toHaveCount(2);
  await expect(page.locator(".roadmap-dependencies > path")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Меню проекта «Юридические вопросы и согласование договоров»" })).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Меню проекта «Автоматизация работы команды»" });
  await menu.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Сроки и вехи проекта «Автоматизация работы команды»" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  await page.getByRole("button", { name: "+ Задать сроки", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/OPS\/settings\/roadmap$/);
});

test("roadmap refresh: zoom persists and timeline primitive still renders", async ({ page }) => {
  await roadmapFixture(page); await page.goto("/roadmap");
  for (const label of ["Недели", "Кварталы", "Месяцы"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".rm-today-chip")).toBeVisible();
  }
  expect(await page.evaluate(() => localStorage.getItem("taskira.roadmap.zoom"))).toBe("month");
  await page.goto("/p/CORP/timeline");
  await expect(page.getByRole("button", { name: "Недели", exact: true })).toBeVisible();
  await expect(page.locator(".roadmap-view")).toHaveCount(0);
});

test("roadmap refresh: 100 projects stay virtualized and columns remain aligned at the bottom", async ({ page }) => {
  await roadmapFixture(page, "light", "ru", 100); await page.goto("/roadmap");
  await expect(page.locator(".roadmap-count")).toContainText("100 проектов");
  expect(await page.locator(".roadmap-project-row").count()).toBeLessThan(30);
  await page.locator(".roadmap-timeline").evaluate(el => el.scrollTop = el.scrollHeight);
  await expect.poll(() => page.locator(".roadmap-projects").evaluate(el => el.scrollTop)).toBe(await page.locator(".roadmap-timeline").evaluate(el => el.scrollTop));
  await expect(page.locator('.roadmap-project-row[data-project-id=p5]')).toBeVisible();
  const row = (await page.locator('.roadmap-project-row[data-project-id=p5]').boundingBox())!;
  expect((await page.locator('.roadmap-timeline-row[data-project-id=p5]').boundingBox())!.y).toBeCloseTo(row.y, 2);
  await page.locator(".roadmap-projects").evaluate(el => el.scrollTop -= 112);
  await expect.poll(() => page.locator(".roadmap-timeline").evaluate(el => el.scrollTop)).toBe(await page.locator(".roadmap-projects").evaluate(el => el.scrollTop));
  expect(await page.locator(".roadmap-project-row").count()).toBeLessThan(30);
});

for (const width of [320, 390]) test(`roadmap refresh: mobile ${width}, touch targets and axe`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await roadmapFixture(page); await page.goto("/roadmap");
  await expect(page.locator(".roadmap-project-row")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.getByRole("button", { name: "Месяцы", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const axe = await new AxeBuilder({ page }).include(".roadmap-view").analyze();
  expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.screenshot({ path: `shots/roadmap-mobile-${width}.png` });
});

test("roadmap refresh: empty and retry states", async ({ page }) => {
  await roadmapFixture(page, "light", "ru", 0); await page.goto("/roadmap");
  await expect(page.getByText("Проектов пока нет", { exact: true })).toBeVisible();
  let fail = true;
  await page.route("**/api/roadmap", route => fail ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fulfill({ json: { projects: [], dependencies: [] } }));
  await page.reload(); await expect(page.getByText("Не удалось загрузить роадмап", { exact: true })).toBeVisible();
  fail = false; await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Проектов пока нет", { exact: true })).toBeVisible();
});

test("roadmap refresh: English and production CSP", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", e => document.documentElement.dataset.roadmapCsp = (document.documentElement.dataset.roadmapCsp ?? "") + e.violatedDirective + ";"); });
  await roadmapFixture(page, "dark", "en"); await page.goto("/roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap", exact: true })).toBeVisible();
  await expect(page.locator(".roadmap-count")).toHaveText("5 projects · 2 departments");
  await expect(page.locator(".roadmap-bar-done").first()).not.toHaveCSS("background-image", "none");
  expect(await page.evaluate(() => document.documentElement.dataset.roadmapCsp)).toBeUndefined();
  expect(errors).toEqual([]);
});
