import { expect, test } from "@playwright/test";
test("combobox Enter uses the current query and Escape stays inside the control", async ({ page }) => {
  await page.goto("/dev/ui?section=combobox");
  const input = page.getByRole("combobox");
  await input.focus();
  await expect(page.getByRole("option").first()).toBeVisible();
  await input.fill("Игорь");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("Игорь");
  await expect(page.getByRole("option", { name: /Игорь/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("Игорь Петров");
  await input.fill("ошибка");
  await expect(page.getByRole("status")).toContainText("Не удалось загрузить");
  await page.keyboard.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
});
