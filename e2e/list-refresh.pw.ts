import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "./board-fixture";

test.setTimeout(60_000);

test("list refresh: default grouping, dimensions, density and header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boardFixture(page);
  await page.goto("/p/CORP/list");
  await expect(page.locator(".list-row")).toHaveCount(7);
  await expect(page.locator(".list-group-head")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Группировка: статус" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Исполнитель" })).toHaveText("Исполнитель");
  // DOMRect coordinates can contain floating-point rounding from the sheet transform.
  expect((await page.locator(".list-head").boundingBox())!.height).toBeCloseTo(36, 2);
  expect((await page.locator(".list-group-head").first().boundingBox())!.height).toBeCloseTo(36, 2);
  expect((await page.locator(".list-row").first().boundingBox())!.height).toBeCloseTo(36, 2);
  await page.evaluate(() => document.documentElement.dataset.density = "compact");
  const compactHeight = (await page.locator(".list-row").first().boundingBox())!.height;
  expect(compactHeight).toBeGreaterThanOrEqual(32);
  expect(compactHeight).toBeLessThan(36);
  for (const [col, width] of [["priority", 28], ["key", 76], ["direction", 230], ["due", 110], ["assignee", 112]] as const) {
    expect((await page.locator(`.list-row [data-col=${col}]`).first().boundingBox())!.width).toBeCloseTo(width, 2);
  }
});

test("list refresh: quick filters, grouping modes and reload", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/list");
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();
  await expect(page.locator(".list-row")).toHaveCount(1);
  await expect(page).toHaveURL(/overdue=1/);
  await expect(page).toHaveURL(/assignee=none/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Просрочено", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Фильтр задач" })).toBeFocused();
  for (const [label, mode] of [["Направление", "epic"], ["Исполнитель", "assignee"], ["Нет", "none"]]) {
    await page.getByRole("button", { name: /^Группировка:/ }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`group=${mode}`));
    await expect(page.locator(".list-row")).toHaveCount(1);
  }
  await expect(page.locator(".list-group-head")).toHaveCount(0);
});

test("list refresh: status and assignee edits stay in the table under CSP", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => { document.documentElement.dataset.listCspViolation = event.violatedDirective; }));
  const { issues } = await boardFixture(page);
  const writes: { path: string; body: any }[] = [];
  await page.route("**/api/projects/p1/issues/i1**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects/p1/issues/i1" && route.request().method() === "GET") return route.fulfill({ json: issues[0] });
    if (route.request().method() === "PATCH" || path.endsWith("/transition")) {
      const body = route.request().postDataJSON(); writes.push({ path, body });
      Object.assign(issues[0], path.endsWith("/transition") ? { statusId: body.to } : body);
      return route.fulfill({ json: issues[0] });
    }
    return route.fallback();
  });
  await page.goto("/p/CORP/list");
  const row = page.locator('[data-issue-id="i1"]');
  await row.hover();
  await row.getByRole("button", { name: "Изменить статус CORP-1" }).click();
  await page.getByRole("menuitem", { name: "В работе", exact: true }).click();
  await expect.poll(() => writes.some(w => w.body.to === "s2")).toBe(true);
  await expect(page.getByRole("rowgroup", { name: "В работе", exact: true }).locator('[data-issue-id="i1"]')).toBeVisible();
  await row.getByRole("button", { name: "Изменить исполнителей CORP-1" }).click();
  const picker = page.locator(".ds-pop");
  await expect(picker.getByRole("button", { name: /^Игорь Петров/ })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: /^Игорь Петров/ }).click();
  await expect.poll(() => writes).toEqual(expect.arrayContaining([expect.objectContaining({ body: { assigneeIds: ["u1"] } })]));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.listCspViolation)).toBeUndefined();
});

test("list refresh: create within a status group and restore focus", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/list");
  await expect(page.getByRole("button", { name: "Добавить в «В работе»", exact: true })).toHaveCount(0);
  const add = page.getByRole("button", { name: "Добавить в «К выполнению»", exact: true });
  await add.click();
  const field = page.locator(".list-group-create textarea");
  await expect(field).toBeFocused();
  await field.fill("Новая задача в группе");
  const posted = page.waitForRequest(r => r.url().endsWith("/projects/p1/issues") && r.method() === "POST");
  await page.keyboard.press("Enter");
  expect((await posted).postDataJSON()).toMatchObject({ statusId: "s1", title: "Новая задача в группе" });
  await expect(page.getByRole("link", { name: "Новая задача в группе" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
});

for (const width of [390, 320]) test(`list refresh: mobile reflow and targets at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await boardFixture(page);
  await page.goto("/p/CORP/list");
  await expect(page.locator(".list-row")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".list-table").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const row = page.locator(".list-row").first();
  await expect(row.locator(".list-mobile-status")).toBeVisible();
  for (const button of await row.getByRole("button").all()) {
    if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("textbox", { name: "Фильтр задач" }).fill("Подготовить");
  const clear = page.getByRole("button", { name: "Очистить", exact: true });
  expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect(page.locator(".list-row")).toHaveCount(7);
  const axe = await new AxeBuilder({ page }).include(".list-view").analyze();
  expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.locator(".list-view").screenshot({ path: test.info().outputPath(`list-mobile-${width}.png`) });
});

test("list refresh: English labels and closed rows", async ({ page }) => {
  await boardFixture(page, "light", 4, "en");
  await page.goto("/p/CORP/list?done=1");
  await expect(page.getByRole("button", { name: "Grouping: status" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Filter issues" })).toBeVisible();
  await expect(page.locator(".list-row")).toHaveCount(9);
  await expect(page.locator(".list-row[data-done]")).toHaveCount(2);
  await expect(page.locator('[data-issue-id="i8"] [data-col="due"] .list-due')).toHaveAttribute("data-urgency", "done");
});

test("list refresh: viewer sees data without mutation controls", async ({ page }) => {
  const { users, project, statuses } = await boardFixture(page);
  const viewer = { ...users[0], globalRole: "member" };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { ...viewer, favoriteProjectIds: [] } }));
  await page.route("**/api/projects/p1", route => route.fulfill({ json: {
    project, users: [viewer, users[1]], members: users.map(u => ({ userId: u.id, role: "viewer" })),
    workflow: { statuses, transitions: [{ from: "s1", to: "s2" }] }, issueTemplates: [], customFields: [], sprints: [],
  } }));
  await page.goto("/p/CORP/list");
  await expect(page.locator(".list-row")).toHaveCount(7);
  await expect(page.locator(".list-group-add, .list-assignee-action, .list-status-action, .list-select")).toHaveCount(0);
  const row = page.locator(".list-row").first();
  await row.hover(); await row.getByRole("button", { name: "Действия", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Открыть задачу" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Удалить" })).toHaveCount(0);
});

test("list refresh: paginated groups show loaded totals and preserve all task IDs", async ({ page }) => {
  const { issues, statuses } = await boardFixture(page);
  const open = issues.filter(i => i.statusId !== "s4");
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/projects/p1/issues**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/counts")) return route.fulfill({ json: { total: open.length, byStatus: Object.fromEntries(statuses.map(st => [st.id, open.filter(i => i.statusId === st.id).length])) } });
    if (url.pathname !== "/api/projects/p1/issues" || route.request().method() !== "GET") return route.fallback();
    if (url.searchParams.has("cursor")) {
      await gate;
      return route.fulfill({ json: { items: open.slice(2), hasMore: false, nextCursor: null } });
    }
    return route.fulfill({ json: { items: open.slice(0, 2), hasMore: true, nextCursor: "page2" } });
  });
  try {
    await page.goto("/p/CORP/list");
    await expect(page.locator(".list-group-count").first()).toHaveText("2/3");
    release();
    await expect(page.locator(".list-row")).toHaveCount(7);
    const ids = await page.locator(".list-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-issue-id")));
    expect(new Set(ids).size).toBe(7);
    await expect(page.locator(".list-group-count").first()).toHaveText("3");
  } finally { release(); }
});

test("list annotations: avatar filters toggle and survive reload", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/list");
  const user = page.locator(".workspace-controls").getByRole("button", { name: "Фильтр: Игорь Петров", exact: true });
  await expect(user).toBeVisible();
  await user.click();
  await expect(page).toHaveURL(/assignee=u2/);
  await expect(user).toHaveAttribute("aria-pressed", "true");
  const count = await page.locator(".list-row").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(7);
  await page.reload();
  await expect(user).toHaveAttribute("aria-pressed", "true");
  await user.click();
  await expect(page).not.toHaveURL(/assignee=u2/);
  await expect(page.locator(".list-row")).toHaveCount(7);
});

test("list annotations: direct import, labeled sort direction and separated headers", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("taskira.list.columns", JSON.stringify(["priority", "direction", "due", "assignee", "updated"])));
  await boardFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/CORP/list");
  const toolbar = page.locator(".workspace-controls");
  await expect(toolbar.getByRole("button", { name: "Импорт", exact: true })).toHaveCount(1);
  await expect(page.locator(".workspace-options-body").getByRole("button", { name: "Импорт", exact: true })).toHaveCount(0);
  const assignee = page.getByRole("columnheader", { name: "Исполнитель", exact: true });
  const updated = page.getByRole("columnheader", { name: "Обновление", exact: true });
  const a = (await assignee.boundingBox())!, b = (await updated.boundingBox())!;
  expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(11.9);
  expect(await assignee.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await toolbar.getByRole("button", { name: "Импорт", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Настройки вида", exact: true }).click();
  const direction = page.getByRole("button", { name: /^Направление сортировки: Приоритет/ });
  await expect(direction).toContainText("По возрастанию");
  const descending = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/issues") && url.searchParams.get("dir") === "desc";
  });
  await direction.click();
  await descending;
  await expect(direction).toContainText("По убыванию");
  await page.screenshot({ path: test.info().outputPath("list-desktop-options.png") });
});

for (const width of [320, 390]) test("list annotations: mobile urgency stays visible at " + width, async ({ page }) => {
  await boardFixture(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/p/CORP/list");
  const row = page.locator('[data-issue-id="i1"]');
  await expect(row.locator(".list-mobile-meta .list-due")).toBeVisible();
  await expect(row.locator(".list-mobile-priority")).toBeVisible();
  await expect(row.locator(".list-mobile-meta .list-due")).toHaveAttribute("data-urgency", "late");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("list annotations: empty direction saves space and populated direction remains readable", async ({ page }) => {
  const { issues } = await boardFixture(page);
  for (const issue of issues) issue.epicId = null;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/CORP/list");
  const direction = page.locator('.list-row [data-col="direction"]').first();
  await expect(page.locator(".list-row")).toHaveCount(7);
  expect((await direction.boundingBox())!.width).toBeCloseTo(140, 2);
  issues[0].epicId = "epic1";
  await page.reload();
  await expect(direction.locator(".list-direction")).toContainText("Корпоративная платформа");
  expect((await direction.boundingBox())!.width).toBeCloseTo(230, 2);
});

for (const theme of ["light", "dark"]) for (const width of [1920, 3440, 390, 320]) {
  test(`contextual list selection (${theme}, ${width})`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: width < 640 ? 844 : 1080 }, hasTouch: width < 640, reducedMotion: "reduce" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    try {
      await boardFixture(page, theme);
      const writes: Record<string, unknown>[] = [];
      await page.route("**/api/projects/p1/issues/bulk", async route => {
        const body = route.request().postDataJSON(); writes.push(body);
        await route.fulfill({ json: { succeeded: body.issueIds, failed: [] } });
      });
      await page.goto("/p/CORP/list");
      const row = page.locator(".list-row").first();
      await expect(row).toBeVisible();
      const before = await row.locator(".list-title").boundingBox();
      expect(await row.locator(".list-select").evaluate(el => getComputedStyle(el).opacity)).toBe(width < 640 ? "1" : "0");
      await expect(page.locator(".list-selection-dock")).toHaveCount(0);
      await page.getByRole("button", { name: "Настройки вида", exact: true }).click();
      await expect(page.getByRole("button", { name: "Выделить", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      if (width >= 640) await row.hover();
      await expect(row.locator(".list-select")).toHaveCSS("opacity", "1");
      const first = row.getByRole("checkbox");
      await first.locator("..").click(); await expect(first).toBeChecked();
      const second = page.locator(".list-row").nth(1).getByRole("checkbox");
      await second.locator("..").click(); await expect(second).toBeChecked();
      const dock = page.locator(".list-selection-dock");
      await expect(dock.getByRole("toolbar", { name: "Выбрано: 2" })).toBeVisible();
      expect((await row.locator(".list-title").boundingBox())!.x).toBeCloseTo(before!.x, 1);
      const bounds = (await dock.boundingBox())!;
      expect(bounds.y).toBeGreaterThan(600); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await expect(row).toHaveAttribute("aria-selected", "true");
      const actions = dock.getByRole("button", { name: "Действия", exact: true });
      await actions.click();
      await page.getByRole("button", { name: "Статус", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "В работе", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dock).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dock).toBeVisible();
      await expect(actions).toBeFocused();
      await actions.click();
      await dock.getByRole("button", { name: "Приоритет", exact: true }).click();
      await page.getByRole("menuitem", { name: "Высокий", exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ action: "priority", priorityId: "high", issueIds: expect.arrayContaining(["i1", "i2"]) });
      await expect(dock).toHaveCount(0);
      await first.focus();
      await page.keyboard.press("Space");
      await expect(dock).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dock).toHaveCount(0);
      await expect(first).toBeFocused();
      await first.locator("..").click(); await expect(first).toBeChecked(); await dock.getByRole("button", { name: "Очистить", exact: true }).click();
      await expect(dock).toHaveCount(0);
      await first.locator("..").click(); await expect(first).toBeChecked(); await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
      await expect(dock).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const axe = await new AxeBuilder({ page }).include(".list-view").analyze();
      expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    } finally { await context.close().catch(() => undefined); }
  });
}