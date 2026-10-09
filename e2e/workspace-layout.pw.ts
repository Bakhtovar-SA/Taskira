import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { mockApi } from "./fixtures";

test("global controls use the current UI, with bounded responsive search", async ({ page }) => {
  await boardFixture(page, "dark");
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  await page.evaluate(() => document.fonts.ready);
  const sidebar = (await page.locator("aside").boundingBox())!;
  expect(sidebar.width).toBe(304);
  expect(sidebar.y).toBe(8);
  await expect(page.locator("aside .sidebar-user-menu")).toHaveCount(0);
  await expect(page.locator(".global-topbar .sidebar-user-menu")).toBeVisible();
  await expect(page.locator(".workspace-controls .project-members")).toBeVisible();
  await expect(page.locator(".project-topbar .project-members")).toHaveCount(0);
  for (const card of await page.locator(".board-card").all()) {
    expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(88);
    await expect(card.locator(".board-card-key")).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath("implemented-board.png") });
  let priorWidth = 0;
  for (const width of [1440, 2000, 3160, 4000]) {
    await page.setViewportSize({ width, height: 1000 });
    const search = (await page.locator(".global-search").boundingBox())!;
    const center = (await page.locator(".global-topbar-center").boundingBox())!;
    const header = (await page.locator(".global-topbar").boundingBox())!;
    expect(search.width).toBeGreaterThanOrEqual(priorWidth);
    expect(search.width).toBeLessThan(920);
    expect(Math.abs(center.x + center.width / 2 - header.x - header.width / 2)).toBeLessThan(1);
    priorWidth = search.width;
  }
  await page.locator(".global-search").click();
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator(".global-topbar").getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.locator(".global-topbar .sidebar-user-menu").click();
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const axe = await new AxeBuilder({ page }).include(".global-topbar").analyze();
  expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("quick creation is limited to the first todo stage in board and list", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-col header button")).toHaveCount(1);
  await expect(page.locator(".board-col").first().getByRole("button", { name: "Добавить в «К выполнению»", exact: true })).toBeVisible();
  await page.goto("/p/CORP/list?group=status&done=1");
  await expect(page.locator(".list-row")).toHaveCount(9);
  await expect(page.locator("[data-create-status]")).toHaveCount(1);
  await expect(page.locator("[data-create-status]")).toHaveAttribute("data-create-status", "s1");
  await page.locator("[data-create-status]").click();
  const input = page.locator(".list-group-create").getByRole("textbox");
  await expect(input).toBeFocused();
  const posted = page.waitForRequest(r => r.url().endsWith("/projects/p1/issues") && r.method() === "POST");
  await input.fill("Задача в первом этапе");
  await input.press("Enter");
  expect((await posted).postDataJSON().statusId).toBe("s1");
  await page.screenshot({ path: test.info().outputPath("implemented-list.png") });
});

test("workflows without a todo stage keep only global creation", async ({ page }) => {
  const { statuses } = await boardFixture(page);
  statuses[0].category = "inprogress";
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  await expect(page.locator(".board-col header button")).toHaveCount(0);
  await expect(page.locator(".board-col .quick-create")).toHaveCount(0);
  await expect(page.locator(".global-topbar .project-create")).toBeEnabled();
  await page.goto("/p/CORP/list?group=status&done=1");
  await expect(page.locator(".list-row")).toHaveCount(9);
  await expect(page.locator("[data-create-status]")).toHaveCount(0);
});

test("users without projects cannot open project creation from the header", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/projects", route => route.fulfill({ json: [] }));
  await page.goto("/");
  const create = page.locator(".global-topbar .project-create");
  await expect(create).toBeVisible();
  await expect(create).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Новая задача", exact: true })).toHaveCount(0);
});

test("solo guests keep their separate shell without project creation", async ({ page }) => {
  await mockApi(page, { globalRole: "member" });
  await page.route("**/api/projects", route => route.fulfill({ json: [] }));
  await page.route("**/api/issues/collaborating", route => route.fulfill({ json: [1, 2].map(n => ({
    issueId: `i${n}`, key: `TEST-${n}`, title: `Приглашённая задача ${n}`, projectId: "p1", projectName: "Test project", statusName: "Todo", statusCategory: "todo", typeId: "task", priorityId: "medium",
  })) }));
  await page.goto("/");
  await expect(page.getByText("Вы — гость", { exact: true })).toBeVisible();
  await expect(page.locator(".global-topbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать задачу", exact: true })).toHaveCount(0);
});

test("global controls fit small screens and a collapsed sidebar", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  for (const width of [320, 390, 768, 1024, 1065, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const search = (await page.locator(".global-search").boundingBox())!;
    const create = (await page.locator(".global-topbar .project-create").boundingBox())!;
    const right = (await page.locator(".global-topbar-right").boundingBox())!;
    expect(search.width).toBeGreaterThan(30);
    expect(search.x + search.width).toBeLessThanOrEqual(create.x);
    expect(create.x + create.width).toBeLessThanOrEqual(right.x);
    await expect(page.locator(".global-topbar .sidebar-user-menu")).toBeInViewport();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("[");
  await expect(page.locator("aside")).toHaveClass(/w-\[60px\]/);
  await expect(page.locator(".global-search")).toBeVisible();
  await expect(page.locator(".global-topbar .sidebar-user-menu")).toBeVisible();
});

test("native drag accepts the blank lane below a compact column", async ({ page }) => {
  const { issues } = await boardFixture(page);
  await page.route("**/api/projects/p1/issues/i*", route => {
    const issue = issues.find(i => new URL(route.request().url()).pathname.endsWith(`/issues/${i.id}`));
    return issue ? route.fulfill({ json: issue }) : route.fallback();
  });
  const writes: { to: string; beforeId: string | null }[] = [];
  await page.route("**/issues/*/transition", route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    const issue = issues.find(i => route.request().url().includes(`/issues/${i.id}/`))!;
    issue.statusId = body.to;
    return route.fulfill({ json: issue });
  });
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  const lane = page.locator(".board-lane").nth(2);
  const box = (await lane.boundingBox())!;
  const block = (await lane.locator(".board-col").boundingBox())!;
  expect(box.height).toBeGreaterThan(block.height + 100);
  await page.locator('[data-issue-id="i2"]').dragTo(lane, { sourcePosition: { x: 20, y: 20 }, targetPosition: { x: box.width / 2, y: box.height - 30 } });
  await expect.poll(() => writes).toEqual([{ to: "s3", beforeId: null }]);
  await expect(lane.locator('[data-issue-id="i2"]')).toBeVisible();
  await page.locator('[data-issue-id="i3"]').dragTo(lane.locator('[data-issue-id="i6"]'));
  await expect.poll(() => writes[1]).toEqual({ to: "s3", beforeId: "i6" });
});

test("full column highlight follows branding and rejects forbidden transitions", async ({ page }) => {
  const { project, users, statuses, issues } = await boardFixture(page, "dark");
  await page.route("**/api/projects/p1/issues/i*", route => {
    const issue = issues.find(i => new URL(route.request().url()).pathname.endsWith(`/issues/${i.id}`));
    return issue ? route.fulfill({ json: issue }) : route.fallback();
  });
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: null, hue: 185, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.route("**/api/projects/p1", route => route.fulfill({ json: { project, users, members: users.map(u => ({ userId: u.id, role: "admin" })), workflow: { statuses, transitions: [{ from: "s1", to: "s2" }] }, issueTemplates: [], customFields: [], sprints: [] } }));
  let writes = 0;
  await page.route("**/issues/*/transition", route => { writes++; return route.fulfill({ status: 403, json: {} }); });
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto("/p/CORP/board");
  await expect(page.locator(".board-card")).toHaveCount(8);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator('[data-issue-id="i2"]').dispatchEvent("dragstart", { dataTransfer: transfer });
  const allowed = page.locator(".board-lane").nth(1);
  await allowed.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(allowed.locator(".board-col-highlight")).toHaveAttribute("data-drop-state", "allowed");
  const highlight = (await allowed.locator(".board-col-highlight").boundingBox())!;
  const block = (await allowed.locator(".board-col").boundingBox())!;
  expect(highlight.y).toBe(block.y);
  expect(highlight.height).toBe(block.height);
  const allowedShadow = await allowed.locator(".board-col-highlight").evaluate(el => getComputedStyle(el).boxShadow);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h").trim())).toBe("185");
  const forbidden = page.locator(".board-lane").nth(2);
  await forbidden.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(forbidden.locator(".board-col-highlight")).toHaveAttribute("data-drop-state", "forbidden");
  const shadow = await forbidden.locator(".board-col-highlight").evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe(allowedShadow);
  await forbidden.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".board-col-highlight[data-drop-state]")).toHaveCount(0);
  expect(writes).toBe(0);
  await page.locator('[data-issue-id="i2"]').dispatchEvent("dragend", { dataTransfer: transfer });
  await forbidden.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.locator(".board-col-highlight[data-drop-state]")).toHaveCount(0);
});
