/** /dev/ui: снимки каждого раздела в обеих темах + axe (ТЗ 5.7 п. 6, проверка: «визуальный тест падает при
 *  изменении отступа в кнопке», «axe без серьёзных нарушений», «каждый интерактивный компонент проходим с
 *  клавиатуры»). Раздел снимается отдельно (`?section=`), чтобы дифф указывал на компонент, а не на страницу. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SECTIONS = ["concepts", "button", "iconbutton", "inputs", "choice", "tabs", "overlays", "combobox", "dialogs", "display", "empty"];
const THEMES = ["light", "dark"] as const;

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
