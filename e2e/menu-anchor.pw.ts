import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";
test("dashboard actions stay next to the ellipsis after repeated opening", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/dashboards", route => route.fulfill({ json: [{ id: "d1", name: "Мой дашборд", kind: "personal", ownerId: "u1", projectId: null, canEdit: true, widgets: [], updatedAt: "2026-10-01" }] }));
  await page.goto("/dashboards/d1");
  const button = page.getByRole("button", { name: "Ещё" });
  for (let i = 0; i < 3; i++) {
    await button.hover();
    await expect(page.getByRole("tooltip", { name: "Ещё", exact: true })).toBeVisible();
    await button.click();
    const menu = page.getByRole("menu", { name: "Ещё" });
    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const a = (await button.boundingBox())!;
      const m = (await menu.boundingBox())!;
      return Math.abs(m.y - (a.y + a.height)) < 12 && m.x <= a.x + a.width && m.x + m.width >= a.x;
    }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
  }
});



