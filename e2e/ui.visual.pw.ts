/** /dev/ui: снимки каждого раздела в обеих темах + axe (ТЗ 5.7 п. 6, проверка: «визуальный тест падает при
 *  изменении отступа в кнопке», «axe без серьёзных нарушений», «каждый интерактивный компонент проходим с
 *  клавиатуры»). Раздел снимается отдельно (`?section=`), чтобы дифф указывал на компонент, а не на страницу. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { shellFixture } from "./shell-fixture";
import { boardFixture } from "./board-fixture";
import { homeFixture } from "./home-fixture";
import { issueFixture } from "./issue-fixture";
import { roadmapFixture } from "./roadmap-fixture";
import { reportsFixture } from "./reports-fixture";

const SECTIONS = ["concepts", "button", "iconbutton", "inputs", "choice", "tabs", "overlays", "combobox", "dialogs", "display", "empty"];
const THEMES = ["light", "dark"] as const;

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`reports refresh · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await reportsFixture(page, theme); await page.goto("/reports");
    await expect(page.locator(".reports-metric")).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    if (process.platform === "win32") await expect(page.locator(".reports-view")).toHaveScreenshot(`reports-${theme}-win32.png`);
    const axe = await new AxeBuilder({ page }).include(".reports-view").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`roadmap refresh · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await roadmapFixture(page, theme); await page.goto("/roadmap");
    await expect(page.locator(".roadmap-project-row")).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    if (process.platform === "win32") {
      // Refresh even a small correction that falls within the normal comparison tolerance.
      const refresh = ["all", "changed"].includes(test.info().config.updateSnapshots);
      await expect(page.locator(".roadmap-view")).toHaveScreenshot(`roadmap-${theme}-win32.png`, refresh ? { maxDiffPixelRatio: 0, maxDiffPixels: 0 } : {});
    }
    const axe = await new AxeBuilder({ page }).include(".roadmap-view").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`issue refresh · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await issueFixture(page, theme);
    await page.goto("/p/CORP/board");
    await page.locator('[data-issue-id="i1"]').click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("tab", { name: "Комментарии · 1" })).toBeVisible();
    await expect(panel.getByText("Корпоративная платформа", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect((await panel.boundingBox())!.width).toBe(980);
    expect((await panel.locator(".issue-toolbar").boundingBox())!.height).toBe(52);
    expect((await panel.locator(".issue-properties").boundingBox())!.width).toBe(320);
    await expect(panel.locator(".issue-nav-button").last()).toHaveCSS("border-top-style", "solid");
    await expect(panel.locator(".issue-action-row .issue-status-button")).toHaveCSS("border-top-width", "1px");
    if (process.platform === "win32") await expect(panel).toHaveScreenshot(`issue-${theme}-win32.png`);
    const axe = await new AxeBuilder({ page }).include("dialog").exclude("[aria-disabled=true]").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`board refresh · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boardFixture(page, theme);
    await page.goto("/p/CORP/board");
    await expect(page.locator(".board-card")).toHaveCount(8);
    await expect(page.locator(".workspace-count")).toHaveText("8 из 9");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator(".board-scroll").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (process.platform === "win32") await expect(page.locator(".board-view")).toHaveScreenshot(`board-${theme}-win32.png`);
    const axe = await new AxeBuilder({ page }).include(".board-view").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

// Shell references are captured in pinned Windows Chromium; Linux still checks layout and axe.
// Existing DS references remain Linux-only, as documented in playwright.config.ts.
for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`shell refresh · ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await shellFixture(page, theme);
    await page.goto("/p/CORP/board");
    await expect(page.locator(".project-topbar")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect((await page.locator(".project-topbar").boundingBox())!.height).toBe(52);
    expect((await page.locator("aside").boundingBox())!.width).toBe(280);
    if (process.platform === "win32") {
      await expect(page.locator(".project-topbar")).toHaveScreenshot(`shell-topbar-${theme}-win32.png`);
      await expect(page.locator("aside")).toHaveScreenshot(`shell-sidebar-${theme}-win32.png`);
    }
    const axe = await new AxeBuilder({ page }).include(".project-topbar").include("aside").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test(`list refresh · ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boardFixture(page, theme);
    await page.goto("/p/CORP/list?done=1");
    await expect(page.locator(".list-row")).toHaveCount(9);
    await page.evaluate(() => document.fonts.ready);
    if (process.platform === "win32") await expect(page.locator(".list-view")).toHaveScreenshot(`list-${theme}-win32.png`);
    const axe = await new AxeBuilder({ page }).include(".list-view").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}

for (const theme of THEMES) {
  for (const section of SECTIONS) {
    test(`${section} · ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`/dev/ui?theme=${theme}&section=${section}`);
      const el = page.locator(`[data-section=${section}]`);
      await expect(el).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(el).toHaveScreenshot(`${section}-${theme}.png`);
    });
  }

  test(`плотная плотность · ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(`/dev/ui?theme=${theme}&density=compact&section=button`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-section=button]")).toHaveScreenshot(`button-compact-${theme}.png`);
  });

  test(`axe: без serious/critical · ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(`/dev/ui?theme=${theme}`);
    await expect(page.locator("[data-section=empty]")).toBeVisible();
    // Принудительные состояния (data-force) — искусственные снимки; контраст недоступных кнопок axe считает
    // ошибкой, хотя WCAG 1.4.3 исключает неактивные элементы — их исключаем явно.
    const res = await new AxeBuilder({ page }).exclude("[aria-disabled=true]").analyze();
    const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}

test("клавиатура: меню, вкладки, диалог", async ({ page }) => {
  await page.goto("/dev/ui?section=overlays");
  const trigger = page.getByRole("button", { name: "Действия" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Редактировать" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Копировать ссылку" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); // «В архив» недоступен — пропускается
  await expect(page.getByRole("menuitem", { name: "Удалить" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await page.goto("/dev/ui?section=tabs");
  await page.getByRole("tab", { name: "Доска" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Список" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Список" })).toBeFocused();

  await page.goto("/dev/ui?section=dialogs");
  const open = page.getByRole("button", { name: "Открыть диалог" });
  await open.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByPlaceholder("CORP")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
});

for (const theme of ["light", "dark", "dusk", "graphite", "dawn", "paper"]) {
  test("home refresh · " + theme, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await homeFixture(page, theme);
    await page.goto("/");
    await expect(page.locator(".home-task")).toHaveCount(5);
    await expect(page.getByRole("progressbar", { name: "Готовность проекта «Корпоративные задачи»" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (process.platform === "win32") await expect(page.locator(".home-view")).toHaveScreenshot("home-" + theme + "-win32.png");
    const axe = await new AxeBuilder({ page }).include(".home-view").include("aside").analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}
