/** COV-01 в настоящем Chromium: число дорастает при росте, а итог в тексте и в дереве доступности виден с первой миллисекунды
 *  (jsdom не рисует ::after и не считает раскладку). Стенд — раздел `countup` в /dev/ui. */
import { expect, test } from "@playwright/test";
import { settle } from "./motion-helpers";

const url = "/dev/ui?section=countup";

/** Следим за DOM каждый кадр и собираем: текст (textContent), показанное в ::after, ширину и положение. */
const watch = (page: import("@playwright/test").Page, sel: string) =>
  page.evaluate(
    (s) =>
      new Promise<{ texts: string[]; shown: string[]; widths: number[]; afterBox: { dx: number; dy: number } | null; counting: boolean }>((resolve) => {
        const el = document.querySelector(s)!.querySelector<HTMLElement>(".count-up")!;
        const texts = new Set<string>();
        const shown: string[] = [];
        const widths: number[] = [];
        let afterBox: { dx: number; dy: number } | null = null;
        let counting = false;
        const t0 = performance.now();
        const tick = () => {
          if (el.hasAttribute("data-counting")) {
            texts.add(el.textContent ?? ""); // текст фиксируем только пока идёт счёт
            counting = true;
            const c = getComputedStyle(el, "::after").content;
            if (shown[shown.length - 1] !== c) shown.push(c);
            widths.push(Math.round(el.getBoundingClientRect().width));
            if (!afterBox) {
              const cs = getComputedStyle(el, "::after");
              afterBox = { dx: parseFloat(cs.left), dy: parseFloat(cs.top) };
            }
          }
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else resolve({ texts: [...texts], shown, widths, afterBox, counting });
        };
        tick();
      }),
    sel,
  );

test("рост: текст всё время итоговый, ::after показывает промежуточные числа и исчезает; ширина не плывёт", async ({ page }) => {
  await page.goto(url);
  await settle(page);
  const value = page.getByTestId("countup-value");
  await expect(value).toHaveText("7");
  await expect(value.locator(".count-up")).not.toHaveAttribute("data-counting", "");
  const watching = watch(page, '[data-testid="countup-value"]');
  await page.getByRole("button", { name: "+120" }).click();
  const r = await watching;
  expect(r.counting).toBe(true);
  expect(r.texts).toEqual(["127"]); // дерево доступности и textContent — только итог
  expect(r.shown.length).toBeGreaterThan(3); // кадры реально менялись
  const nums = r.shown.map((c) => Number(c.replace(/[^0-9]/g, "")));
  expect(nums[0]).toBe(7);
  expect([...nums]).toEqual([...nums].sort((a, b) => a - b)); // монотонно, без перелёта
  expect(Math.max(...nums)).toBeLessThanOrEqual(127);
  expect(r.afterBox).toEqual({ dx: 0, dy: 0 }); // числа рисуются поверх текста
  expect(new Set(r.widths).size).toBe(1); // ширина держится текстом, раскладка не прыгает
  await settle(page);
  await expect(value.locator(".count-up")).not.toHaveAttribute("data-counting", "");
  await expect(value).toHaveText("127");
  // псевдоэлемент убран: контента нет
  expect(await value.locator(".count-up").evaluate((e) => getComputedStyle(e, "::after").content)).toMatch(/^(none|normal)$/);
});

test("формат применяется и к кадрам, а первый показ, убывание и смена resetKey — без движения", async ({ page }) => {
  await page.goto(url);
  await settle(page);
  const line = page.getByTestId("countup-line");
  await expect(line).toHaveText("задач: 7 шт.");
  const frames = watch(page, '[data-testid="countup-line"]');
  await page.getByRole("button", { name: "+120" }).click();
  const r = await frames;
  expect(r.shown.every((c) => /шт\./.test(c))).toBe(true);
  await settle(page);
  await expect(line).toHaveText("задач: 127 шт.");

  const down = watch(page, '[data-testid="countup-value"]');
  await page.getByRole("button", { name: "−5" }).click();
  expect((await down).counting).toBe(false);
  await expect(page.getByTestId("countup-value")).toHaveText("122");

  const key = watch(page, '[data-testid="countup-value"]');
  await page.getByRole("button", { name: "+50 (другой фильтр)" }).click();
  expect((await key).counting).toBe(false);
  await expect(page.getByTestId("countup-value")).toHaveText("172");
});

test("движение уменьшено в системе: сразу итог, кадров нет", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await settle(page);
  await expect(page.getByTestId("countup-value")).toHaveText("7");
  const w = watch(page, '[data-testid="countup-value"]');
  await page.getByRole("button", { name: "+120" }).click();
  expect((await w).counting).toBe(false);
  await expect(page.getByTestId("countup-value")).toHaveText("127");
});

test("скриншот середины счёта: число стоит на месте текста", async ({ page }, info) => {
  await page.goto(url);
  await settle(page);
  await page.getByRole("button", { name: "+120" }).click();
  await page.waitForFunction(() => document.querySelector(".count-up[data-counting]") !== null);
  await page.locator('[data-section="countup"]').screenshot({ path: info.outputPath("countup-mid.png") });
  await settle(page);
  await expect(page.getByTestId("countup-value")).toHaveText("127");
});
