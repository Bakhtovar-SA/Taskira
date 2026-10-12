import { expect, type Locator } from "@playwright/test";

/** ds `Select` instead of `locator.selectOption()`: open the list, click the option, the list closes. */
export async function chooseOption(combobox: Locator, name: string): Promise<void> {
  // Resolve the button once: while open, its listbox carries the same label (getByLabel would match both).
  const id = await combobox.getAttribute("id");
  const button = combobox.page().locator(`[id="${id}"]`);
  await button.click();
  const list = combobox.page().locator(`[id="${await button.getAttribute("aria-controls")}"]`);
  await expect(list).toBeVisible();
  await list.getByRole("option", { name, exact: true }).click();
  await expect(list).toHaveCount(0);
}
