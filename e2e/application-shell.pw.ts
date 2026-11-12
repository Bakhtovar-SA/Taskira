import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ApplicationsDto, ApplicationEnabled } from "../server/src/applicationContract";

async function json(request: APIRequestContext, method: string, url: string, data?: object) {
  const response = await request.fetch(url, { method, data });
  expect(response.ok(), `${method} ${url}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
const login = (request: APIRequestContext, username = "admin") =>
  json(request, "POST", "/api/auth/login", { username, password: "password123" });
async function install(request: APIRequestContext, enabled: ApplicationEnabled) {
  const catalog: ApplicationsDto = await json(request, "GET", "/api/applications");
  return json(request, "PATCH", "/api/applications", { revision: catalog.revision, enabled });
}
async function project(request: APIRequestContext) {
  return (await json(request, "GET", "/api/projects")).find((item: { key: string }) => item.key === "CORP") as { id: string; key: string };
}
async function switchApplication(page: Page, name: "Работа" | "Знания" | "Объекты") {
  await page.getByRole("button", { name: "Переключить приложение", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}
const tabs = (page: Page) => page.locator(".project-view-tabs");
const allEnabled = { work: true, knowledge: true, objects: true };

test.beforeEach(async ({ page }) => {
  await login(page.request);
  await install(page.request, allEnabled);
  const projects = await json(page.request, "GET", "/api/projects");
  for (const item of projects) await json(page.request, "PATCH", `/api/projects/${item.id}/workspace/modules`, {
    documents: true, objects: true, processes: true, planning: true,
  });
});
test.afterEach(async ({ page }) => {
  await login(page.request);
  await install(page.request, allEnabled);
});

test("Work-only installation retains the original task navigation and keeps the editor lazy", async ({ page }) => {
  await install(page.request, { work: true, knowledge: false, objects: false });
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/p/CORP/board");
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Список", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toHaveCount(0);
  await expect(tabs(page).getByRole("link", { name: "Объекты", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Переключить приложение", exact: true })).toHaveCount(0);
  expect(requested.some((url) => /DocumentEditor-[^/]+\.js/.test(url))).toBe(false);
  await page.reload();
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toBeVisible();
});

test("switching applications isolates project menus; direct links, refresh and history restore context", async ({ page }) => {
  await page.goto("/p/CORP/board");
  await switchApplication(page, "Знания");
  await expect(page).toHaveURL(/\/p\/[^/]+\/documents/);
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toHaveCount(0);
  await expect(tabs(page).getByRole("link", { name: "Объекты", exact: true })).toHaveCount(0);
  await switchApplication(page, "Объекты");
  await expect(page).toHaveURL(/\/p\/[^/]+\/objects/);
  await expect(tabs(page).getByRole("link", { name: "Объекты", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/documents/);
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/objects/);
  await page.reload();
  await expect(tabs(page).getByRole("link", { name: "Объекты", exact: true })).toBeVisible();
  // An explicit existing URL wins over the last selected Objects preference.
  await page.goto("/p/CORP/documents");
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toBeVisible();
  await page.goto("/p/CORP/board");
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toBeVisible();
});

test("the Work application home opens the selected project", async ({ page }) => {
  await page.goto("/apps/work");
  await page.locator(".home-project").first().click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/board/);
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toBeVisible();
});

test("Knowledge-only installation opens documents without task navigation and preserves disabled material reading", async ({ page }) => {
  const p = await project(page.request);
  const doc = await json(page.request, "POST", `/api/projects/${p.id}/documents`, { title: "Application reading proof" });
  await install(page.request, { work: false, knowledge: true, objects: false });
  await page.goto(`/p/CORP/documents?document=${doc.id}`);
  await expect(page.locator(".tiptap[contenteditable=true]")).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toHaveCount(0);
  const denied = await page.request.post(`/api/projects/${p.id}/issues`, { data: { title: "Must not be created", typeId: "task", priorityId: "medium", epicId: null, complexity: null } });
  expect(denied.status(), await denied.text()).toBe(409);
  await install(page.request, { work: true, knowledge: false, objects: false });
  // Returning to an already-open tab refreshes availability without losing its readable source.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Знания · Чтение и экспорт.", { exact: true })).toBeVisible();
  await expect(page.locator(".tiptap[contenteditable=true]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Знания · Чтение и экспорт.", { exact: true })).toBeVisible();
  await expect(page.locator(".tiptap[contenteditable=true]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Новый документ", exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/projects/${p.id}/documents/${doc.id}`)).ok()).toBe(true);
  expect((await page.request.get(`/api/projects/${p.id}/documents/${doc.id}/export`)).ok()).toBe(true);
});

test("the global administrator changes app installation with Taskira switches", async ({ page }) => {
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { name: "Приложения", exact: true })).toBeVisible();
  const knowledge = page.getByRole("switch", { name: /^Знания/ });
  await expect(knowledge).toHaveAttribute("aria-checked", "true");
  await knowledge.click();
  await expect.poll(async () => {
    const catalog: ApplicationsDto = await json(page.request, "GET", "/api/applications");
    return catalog.applications.find((item) => item.id === "knowledge")?.enabled;
  }).toBe(false);
  await expect(page.getByText("Настройки приложений сохранены", { exact: true })).toBeVisible();
  await page.reload();
  await expect(knowledge).toHaveAttribute("aria-checked", "false");
  await knowledge.click();
  await expect(knowledge).toHaveAttribute("aria-checked", "true");
});

test("remembered application choices are isolated when another account signs in", async ({ page }) => {
  await page.goto("/p/CORP/board");
  await switchApplication(page, "Знания");
  await expect(page).toHaveURL(/\/documents/);
  await page.request.post("/api/auth/logout");
  await login(page.request, "mgr1");
  await page.goto("/");
  await expect(tabs(page).getByRole("link", { name: "Доска", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toHaveCount(0);
  await switchApplication(page, "Объекты");
  await expect(page).toHaveURL(/\/objects/);
  await page.request.post("/api/auth/logout");
  await login(page.request);
  await page.goto("/");
  await expect(tabs(page).getByRole("link", { name: "Документы", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Объекты", exact: true })).toHaveCount(0);
});

test("app home, keyboard switcher and Help work in both themes on a narrow screen", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/apps/knowledge");
  await expect(page.getByRole("heading", { name: "Знания", exact: true })).toBeVisible();
  const switcher = page.getByRole("button", { name: "Переключить приложение", exact: true });
  await switcher.focus();
  await switcher.press("Enter");
  await expect(page.getByRole("menuitem", { name: /^Объекты/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(switcher).toBeFocused();
  await page.goto("/help#applications");
  await expect(page.locator("#doc-applications")).toBeInViewport();
  await expect(page.locator("#doc-applications tbody tr")).toHaveCount(3);
  await page.evaluate(() => { localStorage.setItem("taskira.lang", "en"); localStorage.setItem("taskira.theme", "dark"); });
  await page.goto("/apps/knowledge");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("knowledge-mobile-dark.png"), fullPage: true, animations: "disabled" });
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(audit.violations).toEqual([]);
  expect(errors).toEqual([]);
});
