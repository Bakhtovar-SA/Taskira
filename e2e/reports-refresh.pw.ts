import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { reportsFixture } from "./reports-fixture";

test("reports refresh: header, metrics, weekly data, ratios and period comparison", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = await reportsFixture(page); await page.goto("/reports");
  await expect(page.locator(".reports-metric")).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Отчёты и дашборды");
  await expect(page.locator(".project-topbar")).toHaveCount(0);
  expect((await page.locator(".reports-header").boundingBox())!.height).toBeCloseTo(52, 2);
  await expect(page.getByRole("link", { name: "Задачи за период", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".reports-comparison")).toHaveText("Сравнение с 4 авг. — 2 сент.");
  await expect(page.getByRole("link", { name: "Empty", exact: true })).toHaveCount(0);
  await expect(page.locator(".reports-view select")).toHaveCount(0);
  await expect(page.locator(".reports-metric").last()).toContainText("4,2 дн");
  await expect(page.locator(".reports-metric").first()).toContainText("+13% к прошлому периоду");
  await expect(page.locator(".reports-chart rect[data-series]")).toHaveCount(10);
  const panels = await page.locator(".reports-panels > section").evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
  expect(panels[0] / panels[1]).toBeCloseTo(1.25, 2);
  await page.getByText("Данные графика", { exact: true }).click();
  await expect(page.locator(".reports-chart-data tbody tr")).toHaveCount(5);
  await page.getByRole("button", { name: "Квартал", exact: true }).click();
  await expect(page.locator(".reports-metric")).toHaveCount(5);
  await expect.poll(() => requests.filter(u => u.pathname.endsWith("summary")).length).toBe(4);
  const current = requests.at(-2)!;
  expect((Date.parse(current.searchParams.get("to")!) - Date.parse(current.searchParams.get("from")!)) / 86400000).toBe(89);
});

test("reports refresh: DS department and multi-project filters, keyboard export and date range", async ({ page }) => {
  const requests = await reportsFixture(page); await page.goto("/reports");
  await expect(page.locator(".reports-metric")).toHaveCount(5);
  const dept = page.getByRole("button", { name: "Все отделы", exact: true });
  await dept.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Все отделы", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Общий отдел", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => requests.at(-1)?.searchParams.get("departmentId")).toBe("d1");
  await page.getByRole("button", { name: "2 проекта", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Проект", exact: true });
  await picker.getByRole("checkbox", { name: "CORP · Корпоративные задачи", exact: true }).uncheck();
  await expect.poll(() => requests.at(-1)?.searchParams.get("projectIds")).toBe("p2");
  await page.keyboard.press("Escape");
  const exportButton = page.getByRole("button", { name: "Экспорт", exact: true });
  await expect(exportButton).not.toHaveAttribute("aria-disabled", "true");
  await exportButton.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("End"); await expect(page.getByRole("menuitem", { name: "открытые сейчас · CSV", exact: true })).toBeFocused();
  const downloaded = page.waitForEvent("download"); await page.keyboard.press("Enter"); expect((await downloaded).suggestedFilename()).toBe("taskira-open-2026-09-03_2026-10-02.csv");
  expect(requests.at(-1)!.searchParams.get("scope")).toBe("open"); expect(requests.at(-1)!.searchParams.get("projectIds")).toBe("p2");
  await expect(exportButton).not.toHaveAttribute("aria-disabled", "true");
  await exportButton.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape"); await expect(exportButton).toBeFocused();
  const from = page.getByRole("button", { name: /^с:/ }); await from.click();
  await expect(page.getByRole("dialog", { name: "с", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(from).toBeFocused();
  await from.click();
  await page.getByRole("dialog", { name: "с", exact: true }).getByRole("gridcell", { name: "вторник, 1 сентября", exact: true }).click();
  await expect.poll(() => requests.filter(u => u.pathname.endsWith("summary")).at(-2)?.searchParams.get("from")).toBe("2026-09-01");
  await expect(page.getByRole("button", { name: "30 дней", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("reports refresh: zero selected projects never requests all projects", async ({ page }) => {
  const requests = await reportsFixture(page); await page.goto("/reports");
  await expect(page.locator(".reports-metric")).toHaveCount(5);
  await page.getByRole("button", { name: "5 проектов", exact: true }).click();
  await page.getByRole("dialog", { name: "Проект", exact: true }).getByRole("checkbox", { name: "Все доступные проекты", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "0 проектов", exact: true })).toBeVisible();
  await expect(page.getByText("За этот период данных нет", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Экспорт", exact: true })).toHaveAttribute("aria-disabled", "true");
  expect(requests).toHaveLength(2);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.locator(".reports-metric")).toHaveCount(5);
});

test("reports refresh: one empty state and reset", async ({ page }) => {
  await reportsFixture(page, "light", "ru", { empty: true }); await page.goto("/reports");
  await expect(page.getByText("За этот период данных нет", { exact: true })).toBeVisible();
  await expect(page.locator(".reports-view .ds-empty")).toHaveCount(1); await expect(page.locator(".reports-metric")).toHaveCount(0);
  await page.getByRole("button", { name: "Год", exact: true }).click(); await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.getByRole("button", { name: "30 дней", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("reports refresh: dashboard navigation, creation and legitimate empty personal dashboard", async ({ page }) => {
  await reportsFixture(page, "light", "ru", { personal: true }); await page.goto("/reports");
  await page.getByRole("link", { name: "Обзор организации", exact: true }).click(); await expect(page).toHaveURL(/\/dashboards\/overview$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Отчёты и дашборды");
  await page.getByRole("link", { name: "Empty", exact: true }).click(); await expect(page).toHaveURL(/\/dashboards\/personal$/);
  await expect(page.getByRole("button", { name: "Изменить", exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Задачи за период", exact: true }).click();
  await page.locator(".reports-header").getByRole("button", { name: "Дашборд", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Новый дашборд", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Отчёты и дашборды");
});

test("reports refresh: mobile overflow, touch targets, sidebar and English", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reportsFixture(page, "dark", "en"); await page.goto("/reports");
  await expect(page.locator(".reports-metric")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const quarter = page.getByRole("button", { name: "Quarter", exact: true }); expect((await quarter.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await quarter.click(); await expect(quarter).toHaveAttribute("aria-pressed", "true");
  const menu = page.locator(".reports-header").getByRole("button", { name: "Menu", exact: true }); await menu.click();
  await expect(page.locator("aside").getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("reports refresh: error retry and production CSP", async ({ page }) => {
  const violations: string[] = [], errors: string[] = [];
  page.on("console", msg => { if (msg.type() === "error" && /Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text()); });
  page.on("pageerror", e => errors.push(e.message));
  await reportsFixture(page, "light", "ru", { fail: true }); await page.goto("/reports");
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить отчёт");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(violations).toEqual([]); expect(errors).toEqual([]);
});

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`reports refresh: axe and CSP · ${theme}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    page.on("console", msg => { if (msg.type() === "error" && /Content Security Policy|Refused to/.test(msg.text())) errors.push(msg.text()); });
    await reportsFixture(page, theme); await page.goto("/reports"); await expect(page.locator(".reports-metric")).toHaveCount(5);
    const axe = await new AxeBuilder({ page }).include(".reports-view").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    const dept = page.getByRole("button", { name: "Все отделы", exact: true }); await dept.click(); await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });
}
