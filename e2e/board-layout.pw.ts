import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";

for (const [width, height] of [[1920, 1080], [1460, 900], [390, 844]]) test(`board stays in place while selecting cards and filtering (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await boardFixture(page, "dark");
  await page.goto("/p/CORP/board");
  const columns = page.locator(".board-columns");
  const card = page.locator('.board-card[data-issue-id="i2"]');
  await expect(card).toBeVisible();
  const top = async () => (await columns.boundingBox())!.y;
  const size = async () => { const box = (await card.boundingBox())!; return { width: box.width, height: box.height }; };
  const shadow = async () => card.evaluate(element => getComputedStyle(element).boxShadow);
  const initialTop = await top();
  const initialSize = await size();
  const initialShadow = await shadow();
  const countFont = await page.locator(".workspace-count").evaluate(element => getComputedStyle(element).fontSize);
  const expectStableTop = async () => expect(Math.abs((await top()) - initialTop)).toBeLessThan(1);

  await expect(page.getByRole("button", { name: "Выделить", exact: true })).toHaveAttribute("title", /Отмечайте карточки кликом/);
  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  await expect(page.locator('.workspace-view-header [role="status"]')).toContainText("Отмечайте карточки кликом");
  await expectStableTop();
  expect(await size()).toEqual(initialSize);
  await card.click();
  await expect(card).toHaveAttribute("data-selected", "");
  await expectStableTop();
  expect(await size()).toEqual(initialSize);
  expect(await shadow()).toBe(initialShadow);

  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  await page.getByRole("button", { name: "Фильтр: Анна Смирнова" }).click();
  const summaryTrigger = page.getByRole("button", { name: /Фильтры:/ });
  const summaryDialog = page.getByRole("dialog", { name: "Фильтры" });
  await expect(summaryTrigger).toBeVisible();
  expect(await summaryTrigger.evaluate(element => getComputedStyle(element).fontSize)).toBe(countFont);
  await expectStableTop();
  await summaryTrigger.click();
  await expect(summaryDialog).toContainText("Исполнитель: Анна Смирнова");
  await summaryDialog.getByRole("button", { name: "Сбросить" }).click();
  await expect(summaryTrigger).toHaveCount(0);
  await expectStableTop();

  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();

  await page.getByRole("textbox", { name: "Фильтр задач" }).fill("Единая");
  await expectStableTop();

  await page.goto("/p/CORP/board?status=s1&priority=high");
  await expect(summaryTrigger).toBeVisible();
  await expectStableTop();
  await summaryTrigger.click();
  await expect(summaryDialog).toContainText("Статус: К выполнению");
  await expect(summaryDialog).toContainText("Приоритет: Высокий");
});
