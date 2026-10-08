import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { homeFixture } from "./home-fixture";
test.setTimeout(60_000);
test("home refresh: shared shell, dimensions, summary and real project totals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await homeFixture(page); await page.goto("/");
  await expect(page.locator(".home-task")).toHaveCount(5);
  await expect(page.locator(".project-topbar")).toHaveCount(0);
  await expect(page.locator("aside [aria-current=page]")).toHaveText("Главная");
  await expect(page.locator(".home-summary")).toHaveText("1 задача просрочена, 1 со сроком на этой неделе, 2 ждут вашего ревью.");
  expect((await page.locator(".home-task").first().boundingBox())!.height).toBe(44);
  expect((await page.locator(".home-activity").first().boundingBox())!.height).toBe(38);
  expect((await page.locator(".home-card-head").first().boundingBox())!.height).toBe(48);
  const style = await page.locator(".home-content").evaluate(e => ({ padding: getComputedStyle(e).padding, font: getComputedStyle(e.querySelector("h1")!).fontSize }));
  expect(style).toEqual({ padding: "28px 32px", font: "30px" });
  await expect(page.locator(".home-project-count").first()).toContainText("моих 5");
  await expect(page.getByText("открыто 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Готовность проекта «Корпоративные задачи»" })).toHaveAttribute("aria-valuenow", String(7 / 12 * 100));
  await expect(page.locator(".home-steps")).toContainText("2 из 4");
  await expect(page.locator(".home-task-group[data-urgency=other]")).toContainText("Подготовить план запуска");
  await expect(page.getByText(/Теперь при входе/)).toHaveCount(0);
});
test("home refresh: all my issues, return home and personal navigation", async ({ page }) => {
  await homeFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Все мои задачи", exact: true }).click(); await expect(page).toHaveURL(/\/my-issues$/);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect(page.locator("aside [aria-current=page]")).toHaveText("Главная");
  await page.getByRole("button", { name: /^Входящие/ }).click(); await expect(page).toHaveURL(/\/inbox$/);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Роадмап", exact: true }).click(); await expect(page).toHaveURL(/\/roadmap$/);
});
test("home refresh: real issue links open the full issue page", async ({ page }) => {
  await homeFixture(page); await page.goto("/");
  const row = page.locator(".home-task").first();
  await expect(row).toHaveAttribute("href", "/p/CORP/issue/CORP-1");
  await row.click(); await expect(page).toHaveURL(/\/p\/CORP\/issue\/CORP-1$/);
  await expect(page.locator(".issue-title").first()).toContainText("Единая авторизация для корпоративных сервисов");
});
test("home refresh: global creation chooses a project and records successful creation", async ({ page }) => {
  await homeFixture(page);
  await page.addInitScript(() => localStorage.setItem("taskira.home.steps.u1", JSON.stringify({ profile: true })));
  // The global header can receive the click before the lazy Home view has installed its listener.
  let releaseHome!: () => void;
  const homeReady = new Promise<void>(resolve => { releaseHome = resolve; });
  await page.route(/\/(?:src\/components\/HomeView\.tsx|assets\/HomeView-[^/]+\.js)(?:\?.*)?$/, async route => { await homeReady; await route.continue(); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".global-topbar .project-create")).toBeVisible();
  await expect(page.locator(".home-view")).toHaveCount(0);
  await page.locator(".global-topbar .project-create").click(); releaseHome();
  const choose = page.getByRole("dialog", { name: "В каком проекте создать задачу?" });
  await expect(choose).toBeVisible();
  await choose.getByRole("button", { name: "Корпоративные задачи", exact: true }).click();
  const create = page.getByRole("dialog", { name: /Новая задача/ });
  await create.getByRole("textbox", { name: /Название/ }).fill("Проверка создания с Главной");
  await create.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("taskira.home.steps.u1")!).create)).toBe(true);
});
test("home refresh: shortcuts, dismissal and completed steps persist", async ({ page }) => {
  await homeFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Изучить горячие клавиши", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  await expect(page.locator(".home-steps")).toContainText("3 из 4");
  await page.reload(); await expect(page.locator(".home-steps")).toContainText("3 из 4");
  await page.getByRole("button", { name: "Скрыть первые шаги" }).click();
  await page.reload(); await expect(page.locator(".home-steps")).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("taskira.home.steps.u1", JSON.stringify({ profile: true, create: true, invite: true, shortcuts: true })));
  await page.reload(); await expect(page.locator(".home-steps")).toHaveCount(0);
});
test("home refresh: employee rework and read-only invitation", async ({ page }) => {
  await homeFixture(page, "light", "ru", true); await page.goto("/");
  await expect(page.locator("[data-urgency=rework]")).toContainText("Проверить документы перед запуском");
  await expect(page.locator("[data-urgency=review]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Пригласить коллегу в проект", exact: true })).toBeDisabled();
});
test("home refresh: empty activity, truncated counts and failed totals remain honest", async ({ page }) => {
  await homeFixture(page);
  await page.route("**/api/notifications", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/roadmap", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.route("**/api/issues/assigned-to-me", route => route.fulfill({ json: { items: [], truncated: true, limit: 100 } }));
  await page.goto("/");
  await expect(page.getByText("Недавняя активность", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Открытых задач на вас нет", { exact: true })).toBeVisible();
  await expect(page.getByText("Не удалось загрузить счётчики проектов.")).toBeVisible();
  await expect(page.getByText("открыто —", { exact: true })).toHaveCount(2);
  await page.route("**/api/roadmap", route => route.fulfill({ json: { projects: [{ id: "p1", total: 4, done: 1 }], dependencies: [] } }));
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("открыто 3", { exact: true })).toBeVisible();
});
test("home refresh: English summary and labels", async ({ page }) => {
  await homeFixture(page, "light", "en"); await page.goto("/");
  await expect(page.locator(".home-summary")).toHaveText("1 issue overdue, 1 due this week, 2 awaiting your review.");
  await expect(page.getByRole("button", { name: "All my issues", exact: true })).toBeVisible();
  await expect(page.locator(".home-task-group[data-urgency=review]")).toContainText("Awaiting your review");
});
for (const width of [320, 390]) test("home refresh: mobile " + width + " navigation, targets and axe", async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await homeFixture(page); await page.goto("/");
  await expect(page.locator(".home-task")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect((await page.locator(".home-task").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.locator(".home-menu").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const axe = await new AxeBuilder({ page }).include(".home-view").analyze();
  expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.screenshot({ path: "shots/home-mobile-" + width + ".png" });
  await page.locator(".global-topbar").getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("button", { name: /^Мои задачи/ }).click(); await expect(page).toHaveURL(/\/my-issues$/);
});
test("home refresh: production CSP allows progress without violations", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", e => { document.documentElement.dataset.homeCspViolation = e.violatedDirective; }));
  await homeFixture(page); await page.goto("/");
  await expect(page.getByRole("progressbar", { name: "Первые шаги" })).toHaveAttribute("aria-valuenow", "50");
  expect(await page.evaluate(() => document.documentElement.dataset.homeCspViolation)).toBeUndefined();
});


test("home refresh: C and palette navigation are available before choosing a project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await homeFixture(page); await page.goto("/");
  await expect(page.locator(".home-task")).toHaveCount(5);
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "В каком проекте создать задачу?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "В каком проекте создать задачу?" })).toBeHidden();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Мои задачи");
  await palette.getByRole("option", { name: /Мои задачи/ }).click();
  await expect(page).toHaveURL(/\/my-issues$/);
  expect(errors).toEqual([]);
});
test("home refresh: invitations complete only after confirmed membership", async ({ page }) => {
  const fixture = await homeFixture(page);
  await page.route("**/api/users/pickable**", route => route.fulfill({ json: [{ ...fixture.users[1], id: "u3", name: "Ольга Иванова", authSource: "local" }] }));
  let fail = true;
  await page.route("**/api/projects/p1/members/u3", route => fail
    ? route.fulfill({ status: 503, json: { error: "unavailable" } })
    : route.fulfill({ json: { userId: "u3", role: "employee" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Пригласить коллегу в проект", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/CORP\/settings\/access$/);
  const pick = page.getByRole("combobox", { name: "Добавить участника", exact: true });
  await pick.fill("Оль");
  await page.getByRole("option", { name: /Ольга Иванова/ }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".anim-toast")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("taskira.home.steps.u1")!).invite)).toBeUndefined();
  fail = false; await pick.fill("Оль");
  await page.getByRole("option", { name: /Ольга Иванова/ }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("taskira.home.steps.u1")!).invite)).toBe(true);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect(page.locator(".home-steps")).toContainText("3 из 4");
});
