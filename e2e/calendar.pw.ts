import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";
const issue = (n: number, dueDate: string | null) => ({ id: `i${n}`, key: `TEST-${n}`, title: `Calendar issue ${n}`, typeId: "task", priorityId: n % 2 ? "critical" : "low", statusId: "s1", assigneeIds: [], reporterId: "u1", dueDate,
  epicId: null, parentId: null, sprintId: null, labels: [], complexity: null, rank: n, description: "", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", archivedAt: null, doneAt: null });
async function calendarApi(page: Page, count = 8) {
  await mockApi(page);
  let items = Array.from({ length: count }, (_, i) => issue(i + 1, i < 5 ? "2026-10-01" : "2026-10-02"));
  items.push(issue(count + 1, null));
  const queries: URLSearchParams[] = []; const writes: unknown[] = []; let reject = false;
  await page.route("**/api/projects/p1/issues**", async route => {
    const url = new URL(route.request().url());
    const tail = url.pathname.split("/issues")[1];
    if (tail === "" && route.request().method() === "GET") {
      queries.push(url.searchParams);
      let selected = items.filter(i => url.searchParams.has("dueEmpty") ? !i.dueDate : !url.searchParams.has("dueFrom") || !!i.dueDate && i.dueDate >= url.searchParams.get("dueFrom")! && i.dueDate <= url.searchParams.get("dueTo")!);
      const cursor = Number(url.searchParams.get("cursor") ?? 0); const limit = Number(url.searchParams.get("limit") ?? 100);
      const chunk = selected.slice(cursor, cursor + limit);
      return route.fulfill({ json: { items: chunk, hasMore: selected.length > cursor + limit, nextCursor: selected.length > cursor + limit ? String(cursor + limit) : null } });
    }
    if (/^\/i\d+$/.test(tail)) {
      const current = items.find(i => i.id === tail.slice(1))!;
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON(); writes.push(patch);
        if (reject) return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", reason: "Only own issues" } } });
        items = items.map(i => i.id === current.id ? { ...i, ...patch } : i);
      }
      return route.fulfill({ json: items.find(i => i.id === current.id) });
    }
    return route.fallback();
  });
  return { queries, writes, reject: () => { reject = true; } };
}
for (const theme of ["light", "dark"] as const) for (const lang of ["ru", "en"] as const) {
  test(`calendar month/week, keyboard, dates, drag and axe · ${theme} · ${lang}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript(({ theme, lang }) => { localStorage.setItem("taskira.theme", theme); localStorage.setItem("taskira.lang", lang); }, { theme, lang });
    const api = await calendarApi(page);
    await page.goto("/p/TEST/calendar");
    await expect(page.getByRole("grid")).toBeVisible();
    await expect.poll(() => api.queries.some(q => q.get("dueFrom") === "2026-09-28" && q.get("dueTo") === "2026-11-08")).toBe(true);
    const day = page.locator('[data-day="2026-10-01"]');
    await expect(day.locator('.calendar-plate:visible')).toHaveCount(3);
    await day.getByRole("button", { name: lang === "en" ? "2 more" : "ещё 2" }).click();
    await expect(page.getByRole("dialog", { name: lang === "en" ? "Issues for this day" : "Задачи дня" }).locator('.calendar-plate')).toHaveCount(5);
    await page.keyboard.press("Escape");
    const before = await page.locator('main [data-issue-id]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.issueId));
    expect(before.slice(0, 5)).toEqual(["i1", "i3", "i5", "i2", "i4"]);
    await page.getByRole("tab", { name: lang === "en" ? "Week" : "Неделя", exact: true }).click();
    await expect(page.locator('[role="gridcell"]')).toHaveCount(7);
    await expect(day.locator('.calendar-plate:visible')).toHaveCount(5);
    await expect(page.locator('main [data-issue-id]')).toHaveCount(8);
    await day.locator('[data-issue-id="i1"]').click();
    await expect(page).toHaveURL(/issue=TEST-1/);
    await page.getByRole("button", { name: lang === "en" ? "Next issue" : "Следующая задача", exact: true }).focus();
    await page.keyboard.press("j"); await expect(page).toHaveURL(/issue=TEST-3/);
    await page.keyboard.press("k"); await expect(page).toHaveURL(/issue=TEST-1/);
    await page.keyboard.press("Escape"); await expect(page).not.toHaveURL(/issue=/);
    const card = day.locator('[data-issue-id="i1"]');
    await card.focus(); await card.press("m");
    const text = page.getByRole("textbox", { name: lang === "en" ? "Due date" : "Срок", exact: true });
    await expect(text).toBeFocused(); await text.fill(lang === "en" ? "3 Oct 2026" : "3 окт 2026"); await text.press("Enter");
    await expect.poll(() => api.writes).toContainEqual({ dueDate: "2026-10-03" });
    await expect(page.locator('[data-day="2026-10-03"] [data-issue-id="i1"]')).toBeVisible();
    await page.locator('[data-day="2026-10-03"] [data-issue-id="i1"]').dragTo(page.locator('[data-day="2026-10-02"]'));
    await expect.poll(() => api.writes).toContainEqual({ dueDate: "2026-10-02" });
    await page.getByRole("button", { name: lang === "en" ? "No due date" : "Без срока", exact: true }).click();
    const aside = page.getByRole("complementary", { name: lang === "en" ? "No due date" : "Без срока" });
    await expect(aside.locator('[data-issue-id]')).toHaveCount(1);
    await aside.locator('[data-issue-id]').dragTo(day);
    await expect.poll(() => api.writes).toContainEqual({ dueDate: "2026-10-01" });
    await page.locator('[data-issue-id="i1"]').dragTo(aside.locator('.min-h-40'));
    await expect.poll(() => api.writes).toContainEqual({ dueDate: null });
    await aside.getByRole("button", { name: lang === "en" ? "Close" : "Закрыть", exact: true }).click();
    api.reject();
    await day.locator('[data-issue-id="i3"]').dragTo(page.locator('[data-day="2026-10-02"]'));
    await expect(day.locator('[data-issue-id="i3"]')).toBeVisible();
    await expect(page.getByText(lang === "en" ? /Only own issues|Couldn't save|Forbidden|Access denied/ : /Only own issues|Недостаточно|Не удалось|Нет прав|Запрещено/)).toBeVisible();
    const violations = await new AxeBuilder({ page }).analyze(); expect(violations.violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`calendar-week-${theme}-${lang}.png`), fullPage: true });
    await page.getByRole("tab", { name: lang === "en" ? "Month" : "Месяц", exact: true }).click();
    await expect(page.locator('[role="gridcell"]')).toHaveCount(42);
    await page.screenshot({ path: test.info().outputPath(`calendar-month-${theme}-${lang}.png`), fullPage: true });
    await day.focus(); await day.press("ArrowRight"); await expect(page.locator('[data-day="2026-10-02"]')).toBeFocused();
    await page.keyboard.press("Enter");
    const create = page.getByRole("dialog", { name: lang === "en" ? "New issue" : "Новая задача" });
    await expect(create).toBeVisible(); await expect(create.getByRole("button", { name: lang === "en" ? /^Due date:.*2/ : /^Срок:.*2/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(create).not.toBeVisible();
    await page.keyboard.press("1"); await expect(page).toHaveURL(/\/board/);
    await page.keyboard.press("4"); await expect(page).toHaveURL(/\/sprints/);
    await page.keyboard.press("5"); await expect(page).toHaveURL(/\/calendar/);
    expect(errors).toEqual([]);
  });
}
for (const theme of ["light", "dark"] as const) test(`calendar 300 issues month switching and drag performance · ${theme}`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("taskira.theme", theme), theme);
  await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
  const api = await calendarApi(page, 300);
  await page.goto("/p/TEST/calendar");
  await expect(page.locator('main [data-issue-id]')).toHaveCount(300);
  const start = Date.now();
  await page.getByRole("button", { name: "Следующий период" }).click();
  await expect(page.locator('[data-day="2026-11-30"]')).toHaveCount(1);
  const switching = Date.now() - start;
  await page.getByRole("button", { name: "Предыдущий период" }).click();
  await expect(page.locator('main [data-issue-id]')).toHaveCount(300);
  const dragStart = Date.now();
  await page.locator('[data-issue-id="i1"]').dragTo(page.locator('[data-day="2026-10-03"]'));
  await expect.poll(() => api.writes).toContainEqual({ dueDate: "2026-10-03" });
  await expect(page.locator('[data-day="2026-10-03"] [data-issue-id="i1"]')).toBeVisible();
  console.log(`calendar ${theme}: month switch ${switching} ms, drag + PATCH + revalidation ${Date.now() - dragStart} ms`);
});
