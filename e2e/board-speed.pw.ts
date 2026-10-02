import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

for (const theme of ["light", "dark"]) test(`300 board cards: scrolling, keyboard and accessibility (${theme})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
  await mockApi(page);
  const issues = Array.from({ length: 300 }, (_, n) => ({
    id: `i${n}`, key: `TEST-${n + 1}`, title: `Board task ${n + 1}`, description: "", typeId: "task", statusId: "s1",
    priorityId: "medium", assigneeIds: [], reporterId: "u1", epicId: null, parentId: null, labels: [], complexity: null,
    dueDate: null, rank: n, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z",
    doneAt: null, archivedAt: null, sprintId: null, attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [],
  }));
  await page.route("**/api/projects/p1/issues**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/counts")) return route.fulfill({ json: { total: 300, byStatus: { s1: 300 } } });
    if (url.pathname.endsWith("/assignees") || url.pathname.endsWith("/epics")) return route.fulfill({ json: { items: [], truncated: false } });
    if (url.pathname === "/api/projects/p1/issues") {
      const start = Number(url.searchParams.get("cursor") ?? 0);
      return route.fulfill({ json: { items: issues.slice(start, start + 100), hasMore: start < 200, nextCursor: start < 200 ? String(start + 100) : null } });
    }
    const id = url.pathname.match(/\/issues\/(i\d+)$/)?.[1];
    if (id) return route.fulfill({ json: issues.find(issue => issue.id === id) });
    return route.fulfill({ json: [] });
  });
  await page.goto("/p/TEST/board");
  const cards = page.locator("article[data-issue-id]");
  await expect(cards).toHaveCount(100);
  // Scroll each loaded range to its sentinel, preserving native paging.
  for (const count of [200, 300]) {
    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(count);
  }
  const last = cards.last();
  await last.scrollIntoViewIfNeeded();
  await last.focus();
  await expect(last).toBeFocused();
  await page.keyboard.press("m");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-issue-details="i299"]')).toBeVisible();
  const dialog = page.locator("dialog[open]");
  await expect.poll(() => dialog.evaluate(el => ({ modal: el.matches(":modal"), focusInside: el.contains(document.activeElement), active: el.contains(document.activeElement) ? "inside" : document.activeElement?.tagName }))).toEqual({ modal: true, focusInside: true, active: "inside" });
  // Native modality prevents background focus; Tab stays in the panel.
  await last.focus();
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // J/K traverse the full DOM, including cards that started outside the viewport.
  await page.locator("dialog[open]").focus();
  await page.keyboard.press("k");
  await expect(page.locator('[data-issue-details="i298"]')).toBeVisible();
  await page.locator("dialog[open]").focus();
  await page.keyboard.press("j");
  await expect(page.locator('[data-issue-details="i299"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(last).toBeFocused();
  await expect(cards).toHaveCount(300);
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
