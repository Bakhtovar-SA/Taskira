import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const project = { id: "p1", key: "TEST", name: "Recurring project", description: "", departmentId: null, isShared: false, sprintsEnabled: false,
  defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
const user = { id: "u1", username: "admin", name: "Anna Admin", initials: "AA", color: "", jobRole: "", globalRole: "admin", isActive: true,
  authSource: "local", favoriteProjectIds: [], notifyPrefs: {}, onboarding: { hidden: true } };
const rule = { id: "r1", projectId: "p1", name: "Еженедельная проверка", templateId: "t1", title: null, schedule: { kind: "weekly", every: 1, weekdays: [1] },
  timeOfDay: "09:00", timeZone: "Asia/Tashkent", startDate: "2026-10-06", assigneeIds: [], dueInDays: null, skipIfOpen: true, ownerId: "u1",
  state: "active", pausedReason: null, nextRunAt: "2026-10-12T04:00:00Z", lastRunAt: "2026-10-05T04:00:00Z", lastResult: "created",
  createdAt: "2026-10-06T04:00:00Z", updatedAt: "2026-10-06T04:00:00Z" };
async function mockApi(page: Page, viewer = false, enabled = true) {
  const account = { ...user, globalRole: viewer ? "member" : "admin" };
  const errors: string[] = []; page.on("pageerror", error => { errors.push(error.message); console.error("pageerror:", error.message); });
  const rules = [rule, { ...rule, id: "r2", name: "Месячный отчёт", schedule: { kind: "monthly", every: 1, day: "last" },
    state: "paused", pausedReason: "owner_lost_access", nextRunAt: null, lastResult: "failed" }];
  const writes: Record<string, unknown>[] = [], previews: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const path = pathname.slice(4), method = route.request().method(); let body: unknown = [];
    if (path === "/auth/me") body = account;
    else if (path === "/auth/config") body = { authMode: "local" };
    else if (path === "/projects") body = [project];
    else if (path === "/projects/p1") body = { project, users: [account], members: [{ userId: "u1", role: viewer ? "viewer" : "manager" }],
      workflow: { statuses: [{ id: "s1", sid: "todo", name: "Todo", category: "todo", position: 0 }], transitions: [] },
      issueTemplates: [{ id: "t1", name: "Проверка оборудования", title: "Проверка {date}", description: "", typeId: "task", priorityId: "medium", statusId: null, position: 0 }], customFields: [], sprints: [] };
    else if (path === "/projects/p1/issues") body = { items: [], hasMore: false, nextCursor: null };
    else if (path === "/projects/p1/issues/counts") body = { total: 0, byStatus: {}, byPriority: {}, overdue: 0 };
    else if (path === "/issues/assigned-to-me") body = { items: [], truncated: false, limit: 100 };
    else if (path === "/issues/search") body = { items: [], truncated: false };
    else if (path.endsWith("/issues/epics") || path.endsWith("/issues/assignees")) body = { items: [], truncated: false, limit: 200 };
    else if (path === "/instance/brand") body = { name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" };
    else if (path === "/me/onboarding") body = { done: [], hints: [], hidden: true };
    else if (path === "/admin/setup") body = { completed: true };
    else if (path === "/notifications") body = { items: [], nextCursor: null };
    else if (path === "/notifications/unread-count") body = { count: 0 };
    else if (path === "/recurring/config") body = { enabled, defaultTimeZone: "Asia/Tashkent" };
    else if (path === "/projects/p1/recurring/preview") {
      previews.push(route.request().postDataJSON()); body = { next: [12, 19, 26].map(day => `2026-10-${day}T04:00:00Z`).concat(["2026-11-02T04:00:00Z", "2026-11-09T04:00:00Z"]) };
    } else if (path === "/projects/p1/recurring" && method === "POST") {
      const input = route.request().postDataJSON(); writes.push(input); const saved = { ...rule, ...input, id: "r3" }; rules.push(saved); body = saved;
    } else if (path === "/projects/p1/recurring") body = rules;
    else if (path.endsWith("/runs")) body = [{ id: "run1", scheduledFor: rule.lastRunAt, ranAt: rule.lastRunAt, result: "created", issueId: null, issueKey: null,
      manual: false, missedCount: 2, errorCode: null, details: { droppedAssignees: ["u1"] } }];
    await route.fulfill({ json: body, status: method === "POST" && path === "/projects/p1/recurring" ? 201 : 200 });
  });
  return { errors, writes, previews };
}
for (const theme of ["light", "dark"] as const) test(`recurring rules, form and history · ${theme}`, async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00Z"));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript(value => localStorage.setItem("taskira.theme", value), theme);
  const state = await mockApi(page); await page.goto("/p/TEST/settings/recurring");
  await expect(page.getByRole("heading", { name: "Повторяющиеся задачи", exact: true })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /^Месячный отчёт/ })).toBeVisible();
  await expect(page.getByText(/Пауза: у владельца/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`recurring-list-${theme}.png`), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  const add = page.getByRole("button", { name: "Добавить правило" }); await add.click();
  const dialog = page.getByRole("dialog", { name: "Добавить правило" });
  await expect(dialog.getByRole("textbox", { name: "Название правила" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Название правила" }).fill("Осмотр кабинета");
  await expect(dialog.locator("time")).toHaveCount(5);
  await dialog.getByRole("button", { name: "ср", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "ср", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.previews.at(-1)?.schedule).toEqual({ kind: "weekly", every: 1, weekdays: [1, 3] });
  await page.screenshot({ path: test.info().outputPath(`recurring-form-${theme}.png`), fullPage: true });
  await dialog.locator("time").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`recurring-preview-${theme}.png`), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(add).toBeFocused();
  expect(state.writes[0]).toMatchObject({ name: "Осмотр кабинета", schedule: { kind: "weekly", every: 1, weekdays: [1, 3] }, timeZone: "Asia/Tashkent", dueInDays: null });
  await page.getByRole("button", { name: "Действия: Еженедельная проверка", exact: true }).click();
  await page.getByRole("menuitem", { name: "История запусков" }).click();
  const panel = page.getByRole("dialog", { name: "История: Еженедельная проверка" });
  await expect(panel.getByText("Пропущено: 2")).toBeVisible(); await expect(panel.getByText("Выпавшие исполнители: Anna Admin")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("viewers only get history; operators can disable automatic runs", async ({ page }) => {
  await mockApi(page, true, false); await page.goto("/p/TEST/settings/recurring");
  await expect(page.getByText("RECURRING_ENABLED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить правило" })).toHaveCount(0);
  await page.getByRole("button", { name: "Действия: Еженедельная проверка" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1); await expect(page.getByRole("menuitem", { name: "История запусков" })).toBeVisible();
});
