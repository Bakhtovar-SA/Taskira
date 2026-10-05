import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const theme of ["light", "dark"] as const) for (const lang of ["ru", "en"] as const) {
  test(`portfolio overview, template and project catalogue · ${theme} · ${lang}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(({ theme, lang }) => { localStorage.setItem("taskira.theme", theme); localStorage.setItem("taskira.lang", lang); }, { theme, lang });
    await mockApi(page);
    const milestone = { id: "m1", projectId: "p1", projectKey: "TEST", projectName: "Test project", name: "Release", date: "2026-10-08", overdue: false };
    await page.route("**/api/roadmap", r => r.fulfill({ json: { projects: [{ id: "p1", milestones: [milestone], canEdit: true }], dependencies: [] } }));
    await page.route("**/api/projects/p1/overview", r => r.fulfill({ json: { dashboard: null, canEdit: true } }));
    await page.route("**/api/dashboards/data", r => {
      const { widgets } = r.request().postDataJSON();
      const results = Object.fromEntries(widgets.map((w: { id: string; type: string }) => {
        let data: unknown;
        switch (w.type) {
          case "projects": data = { type: w.type, items: [{ projectId: "p1", key: "TEST", name: "Test project", team: "Platform", total: 10, open: 2, overdue: 0, targetDate: "2026-10-14", health: "onTrack" }] }; break;
          case "projectHealth": data = { type: w.type, items: [{ health: "onTrack", count: 1 }] }; break;
          case "milestones": data = { type: w.type, items: [milestone] }; break;
          case "count": data = { type: w.type, value: 2 }; break;
          case "breakdown": data = { type: w.type, items: [], total: 0 }; break;
          case "trend": data = { type: w.type, weeks: [] }; break;
          default: data = { type: w.type, items: [], truncated: false };
        }
        return [w.id, data];
      }));
      return r.fulfill({ json: { results } });
    });
    await page.goto("/dashboards/overview");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Release", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: lang === "en" ? "On track" : "По плану" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`portfolio-${theme}-${lang}.png`), fullPage: true });
    await page.getByRole("button", { name: lang === "en" ? "Dashboard" : "Дашборд", exact: true }).click();
    await expect(page.getByText(lang === "en" ? "Project portfolio" : "Портфель проектов", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("table").getByRole("button", { name: "Test project", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/TEST\/overview/);
    await expect(page.getByText("Release", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: lang === "en" ? "Edit" : "Изменить", exact: true }).click();
    await page.getByRole("button", { name: lang === "en" ? "Add widget" : "Добавить виджет", exact: true }).click();
    const catalog = page.getByRole("dialog", { name: lang === "en" ? "Add widget" : "Добавить виджет" });
    for (const name of lang === "en" ? ["Projects", "Project health", "By project", "Project progress"] : ["Проекты", "Состояние проектов", "По проектам", "Прогресс проектов"]) {
      await expect(catalog.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(catalog.getByRole("button", { name: lang === "en" ? "Upcoming milestones" : "Ближайшие вехи", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
