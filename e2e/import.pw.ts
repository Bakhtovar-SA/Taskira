import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const jira = resolve("src/import/__fixtures__/jira.csv");
const asana = resolve("src/import/__fixtures__/asana.csv");

for (const theme of ["light", "dark"] as const) {
  test(`import preview and axe · ${theme}`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => localStorage.setItem("taskira.theme", selectedTheme), theme);
    await page.goto("/dev/import");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.getByLabel("Источник").selectOption("jira");
    await page.getByLabel(/Файл экспорта/).setInputFiles(jira);
    await expect(dialog.getByText(/Найдено задач: 9/)).toBeVisible();
    await expect(dialog.getByText(/Сроков не распознано: 1/)).toBeVisible();
    await expect(dialog.getByText(/Будет создано: 7/)).toBeVisible();
    await page.getByRole("checkbox").check();
    await expect(dialog.getByText(/Будет создано: 9/)).toBeVisible();

    await page.getByLabel("Источник").selectOption("asana");
    await page.getByLabel(/Файл экспорта/).setInputFiles(asana);
    await expect(dialog.getByText(/Найдено задач: 7/)).toBeVisible();

    await page.getByLabel("Источник").selectOption("trello");
    await page.getByLabel(/Файл экспорта/).setInputFiles({ name: "trello.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ name: "Board", lists: [], cards: [{ id: "1", name: "Task" }] })) });
    await expect(dialog.getByText(/Найдено задач: 1/)).toBeVisible();

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
}
