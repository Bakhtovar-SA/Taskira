import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const project = { id: "p1",key: "TEST",name: "Integration project",description: "",departmentId: null,isShared: false,sprintsEnabled: false,
  defaultView: null,suggestedLabels: [],icon: null,color: null,background: null,backgroundPhoto: null,isDemo: false };
const user = { id: "u1",username: "admin",name: "Test Admin",initials: "TA",color: "",jobRole: "",globalRole: "admin",isActive: true,
  authSource: "local",favoriteProjectIds: [],notifyPrefs: {},onboarding: { hidden: true } };
const hook = { id: "h1",projectId: "p1",name: "CRM",urlDisplay: "https://crm.example/events",events: ["issue.created","issue.statusChanged"],
  state: "active",disabledReason: null,failureStreak: 0,lastSuccessAt: "2026-10-05T11:00:00Z",lastFailureAt: null,secretRotatedUntil: null,
  createdAt: "2026-10-04T12:00:00Z",updatedAt: "2026-10-04T12:00:00Z" };
const delivery = { id: "d1",eventId: "e1",eventType: "issue.created",issueKey: "TEST-1",state: "failed",attempts: 8,lastStatus: 503,lastError: "http_status",
  lastDurationMs: 85,manual: false,nextAttemptAt: "2026-10-05T10:00:00Z",createdAt: "2026-10-05T10:00:00Z",updatedAt: "2026-10-05T10:00:00Z" };
async function mockApi(page: Page,enabled = true) {
  const errors: string[] = []; page.on("pageerror",error => { errors.push(error.message); console.error("pageerror:",error.message); });
  const hooks = [hook,{ ...hook,id: "h2",name: "Data warehouse",urlDisplay: "https://data.example/events",state: "disabled",disabledReason: "failing",failureStreak: 20 }];
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**",async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const path = pathname.slice(4),method = route.request().method(); let body: unknown = [];
    if (path === "/auth/me") body = user;
    else if (path === "/auth/config") body = { authMode: "local" };
    else if (path === "/projects") body = [project];
    else if (path === "/projects/p1") body = { project,users: [user],members: [{ userId: "u1",role: "manager" }],workflow: { statuses: [{ id: "s1",sid: "todo",name: "Todo",category: "todo",position: 0 }],transitions: [] },issueTemplates: [],customFields: [],sprints: [] };
    else if (path === "/projects/p1/issues") body = { items: [],hasMore: false,nextCursor: null };
    else if (path === "/projects/p1/issues/counts") body = { total: 0,byStatus: {},byPriority: {},overdue: 0 };
    else if (path === "/issues/assigned-to-me") body = { items: [],truncated: false,limit: 100 };
    else if (path === "/issues/search") body = { items: [],truncated: false };
    else if (path.endsWith("/issues/epics") || path.endsWith("/issues/assignees")) body = { items: [],truncated: false,limit: 200 };
    else if (path === "/instance/brand") body = { name: null,hue: null,logoUpdatedAt: null,transparencyDefault: "auto" };
    else if (path === "/me/onboarding") body = { done: [],hints: [],hidden: true };
    else if (path === "/admin/setup") body = { completed: true };
    else if (path === "/notifications") body = { items: [],nextCursor: null };
    else if (path === "/notifications/unread-count") body = { count: 0 };
    else if (path === "/integrations/config") body = { webhooksEnabled: enabled,allowHttp: false,allowedTargets: ["crm.example:443","data.example:443"] };
    else if (path === "/projects/p1/webhooks" && method === "POST") {
      const input = route.request().postDataJSON(); writes.push({ path,body: input });
      const created = { ...hook,...input,id: "h3",urlDisplay: "https://crm.example/new" }; hooks.push(created);
      body = { webhook: created,secret: "whsec_dummy_visual_fixture_only" };
    } else if (path === "/projects/p1/webhooks") body = hooks;
    else if (path.endsWith("/deliveries/d1")) body = { ...delivery,payload: { version: 1,type: "issue.created",issue: { key: "TEST-1" } },headers: {},responseExcerpt: "Service unavailable. Try again later." };
    else if (path.endsWith("/deliveries")) body = { items: [delivery],nextCursor: null };
    await route.fulfill({ json: body,status: method === "POST" && path === "/projects/p1/webhooks" ? 201 : 200 });
  });
  return { errors,writes };
}
for (const theme of ["light","dark"] as const) test(`project integrations and delivery journal · ${theme}`,async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.emulateMedia({ colorScheme: theme,reducedMotion: "reduce" });
  await page.addInitScript(value => localStorage.setItem("taskira.theme",value),theme);
  const state = await mockApi(page); await page.goto("/p/TEST/settings/integrations");
  await expect(page.getByRole("heading",{ name: "Интеграции",exact: true })).toBeVisible();
  await expect(page.getByText("Data warehouse",{ exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`integrations-${theme}.png`),fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  await page.getByRole("button",{ name: "Добавить вебхук" }).click();
  await page.getByRole("textbox",{ name: "Название",exact: true }).fill("New CRM");
  await page.getByRole("textbox",{ name: "URL получателя" }).fill("https://crm.example/new?token=dummy");
  await page.getByRole("button",{ name: "Сохранить",exact: true }).click();
  const secret = page.getByRole("dialog",{ name: "Сохраните секрет" }); await expect(secret).toBeVisible();
  await expect(secret.getByRole("textbox",{ name: "Секрет",exact: true })).toHaveValue("whsec_dummy_visual_fixture_only");
  await secret.getByRole("textbox",{ name: "Секрет",exact: true }).press("Escape"); await expect(secret).toBeVisible();
  await secret.getByRole("button",{ name: "Закрыть",exact: true }).click(); await expect(secret).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  await secret.getByRole("checkbox",{ name: "Я сохранил(а) секрет" }).check(); await secret.getByRole("button",{ name: "Готово" }).click();
  await expect(secret).not.toBeVisible(); await expect(page.getByRole("button",{ name: "Добавить вебхук" })).toBeFocused();
  expect(state.writes[0].body).toEqual({ name: "New CRM",url: "https://crm.example/new?token=dummy",events: ["issue.created"] });
  await page.getByRole("button",{ name: "Действия: CRM",exact: true }).click(); await page.getByRole("menuitem",{ name: "Журнал доставок" }).click();
  const panel = page.getByRole("dialog",{ name: "Доставки: CRM" }); await expect(panel.getByRole("table")).toBeVisible();
  await panel.getByRole("table").getByRole("button").first().click(); await expect(panel.getByText("Service unavailable. Try again later.")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`deliveries-${theme}.png`),fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("disabled integrations expose environment instructions without a create form",async ({ page }) => {
  await mockApi(page,false); await page.goto("/p/TEST/settings/integrations");
  await expect(page.getByText(/WEBHOOKS_ENABLED/)).toBeVisible();
  await expect(page.getByRole("button",{ name: "Добавить вебхук" })).toHaveCount(0);
});
