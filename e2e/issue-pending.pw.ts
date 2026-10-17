import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { issueFixture } from "./issue-fixture";

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { __pendingCsp: violations });
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective + ":" + event.blockedURI));
  });
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as Window & { __pendingCsp?: string[] }).__pendingCsp)).toEqual([]);
});
async function fixture(page: Page, reduce: "normal" | "system" | "personal" = "normal") {
  await issueFixture(page, "light");
  await page.emulateMedia({ reducedMotion: reduce === "system" ? "reduce" : "no-preference" });
  await page.addInitScript(personal => { if (personal) localStorage.setItem("taskira.reduceMotion", "1"); }, reduce === "personal");
  let release: () => void = () => undefined;
  const control = { fail: true, delay: 600, started: 0, finished: 0, release: () => release() };
  const checklist = [{ id: "check1", text: "Проверить уведомления", done: false, position: 0, createdAt: "2026-10-01T00:00:00Z" }];
  await page.route("**/api/projects/p1/issues/i1**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!["POST", "PATCH"].includes(request.method()) || !["/api/projects/p1/issues/i1", "/api/projects/p1/issues/i1/comments", "/api/projects/p1/issues/i1/checklist", "/api/projects/p1/issues/i1/checklist/check1"].includes(path)) return route.fallback();
    control.started++;
    const fail = control.fail;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // At least 600ms of actual network latency; release after assertions makes slow runners deterministic.
    await Promise.all([new Promise<void>(resolve => setTimeout(resolve, control.delay)), gate]);
    control.finished++;
    if (fail) return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", reason: "Не сохранено" } } });
    if (path.includes("/checklist")) {
      const body = request.postDataJSON();
      if (request.method() === "POST") checklist.push({ ...checklist[0], id: "check2", text: body.text });
      else checklist[0].done = body.done;
      return route.fulfill({ json: { item: checklist.at(-1), checklist } });
    }
    return route.fallback();
  });
  await page.goto("/p/CORP/board");
  await page.locator('.board-card[data-issue-id="i1"]').click();
  await expect(page.locator(".issue-detail")).toBeVisible();
  await expect(page.locator(".issue-feed")).toContainText("Проверил требования");
  return control;
}
async function scopeClean(page: Page) {
  await expect(page.locator(".issue-detail[data-pending], .issue-detail[aria-busy=true]")).toHaveCount(0);
}

test("comment: delayed local draft is separate from server comments, errors keep text and retry replaces draft", async ({ page }) => {
  const control = await fixture(page);
  const input = page.locator(".issue-comment-composer textarea"), send = page.locator(".issue-comment-send");
  const draft = page.locator(".issue-pending-comment"), body = "Черновик для повторной отправки";
  const comments = page.locator('.issue-feed [data-enter-id^="c-"]');
  await expect(comments).toHaveCount(1);
  await input.fill(body); await send.click();
  await expect(draft).toBeVisible(); await expect(draft).toHaveAttribute("data-pending", "");
  await expect(draft).toContainText(body); await expect(comments).toHaveCount(1);
  await expect(input).toHaveAttribute("aria-busy", "true"); await expect(send).toHaveAttribute("aria-busy", "true"); await scopeClean(page);
  expect((await new AxeBuilder({ page }).include(".issue-pending-comment").withRules(["aria-allowed-attr", "aria-prohibited-attr", "aria-valid-attr", "aria-valid-attr-value"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("comment-pending.png") }); control.release();
  await expect(draft).toHaveCount(0); await expect(input).toHaveValue(body); await expect(input).not.toHaveAttribute("aria-busy", "true");
  control.fail = false; await send.click(); await expect(draft).toBeVisible(); control.release();
  await expect(input).toHaveValue(""); await expect(draft).toHaveCount(0); await expect(comments).toHaveCount(2);
  await expect(page.locator(".issue-feed")).toContainText(body); await expect(page.locator(".issue-comment-composer [data-pending]")).toHaveCount(0);
});

test("checklist: add error retains the input; successful add and check wait for the server", async ({ page }) => {
  const control = await fixture(page);
  await page.getByRole("button", { name: "+ Пункт", exact: true }).click();
  const input = page.getByRole("textbox", { name: "+ добавить пункт", exact: true });
  await input.fill("Новый пункт"); await input.press("Enter"); await expect(input).toHaveAttribute("data-pending", ""); await scopeClean(page); control.release();
  await expect.poll(() => control.finished).toBe(1); await expect(input).not.toHaveAttribute("data-pending", ""); await expect(input).toHaveValue("Новый пункт");
  control.fail = false; await input.press("Enter"); await expect(input).toHaveAttribute("data-pending", ""); control.release();
  await expect(page.locator('.issue-related [data-enter-id="check2"]')).toContainText("Новый пункт"); await expect(input).toHaveValue("");
  const row = page.locator('.issue-related [data-enter-id="check1"]'), check = row.getByRole("checkbox");
  await check.click(); await expect(row).toHaveAttribute("data-pending", ""); await expect(check).not.toBeChecked(); await scopeClean(page); control.release();
  await expect(check).toBeChecked(); await expect(row).not.toHaveAttribute("data-pending", "");
});

test("assignee: only the avatar is pending, an error preserves selection and retry commits it", async ({ page }) => {
  const control = await fixture(page);
  const field = page.locator(".issue-field").filter({ has: page.locator(".issue-field-label").getByText("Исполнители", { exact: true }) });
  await field.locator('button[aria-haspopup="dialog"]').click();
  const choice = page.getByRole("dialog", { name: "Исполнители", exact: true }).getByRole("button", { name: /Игорь Петров/ });
  const before = await choice.getAttribute("aria-pressed");
  await choice.click(); await expect(field.locator("[data-pending]")).toHaveCount(1); await scopeClean(page); control.release();
  await expect.poll(() => control.finished).toBe(1); await expect(field.locator("[data-pending]")).toHaveCount(0); await expect(choice).toHaveAttribute("aria-pressed", before!);
  control.fail = false; await choice.click(); await expect(field.locator("[data-pending]")).toHaveCount(1); control.release();
  await expect(choice).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true"); await expect(field.locator("[data-pending]")).toHaveCount(0);
});

test("labels: under system reduce the input and chip still acknowledge slow requests, with no optimistic commit", async ({ page }) => {
  const control = await fixture(page, "system");
  const input = page.getByRole("textbox", { name: "Метки", exact: true }), chip = page.locator('.issue-labels [data-label="проверка"]');
  await input.fill("проверка"); await input.press("Enter"); await expect(input).toHaveAttribute("data-pending", ""); await expect(chip).toHaveCount(0); await scopeClean(page); control.release();
  await expect.poll(() => control.finished).toBe(1); await expect(input).not.toHaveAttribute("data-pending", ""); await expect(input).toHaveValue("проверка");
  control.fail = false; await input.press("Enter"); await expect(input).toHaveAttribute("data-pending", ""); control.release(); await expect(chip).toBeVisible(); await expect(input).toHaveValue("");
  await chip.getByRole("button", { name: "Убрать: проверка", exact: true }).click(); await expect(chip).toHaveAttribute("data-pending", ""); control.release();
  await expect(chip).toHaveCount(0); await expect(page.locator(".issue-labels [data-pending]")).toHaveCount(0);
});

test("personal reduce: closing a pending comment cancels marks; a late response never clears a new editor draft", async ({ page }) => {
  const control = await fixture(page, "personal"); control.fail = false; control.delay = 1200;
  const input = page.locator(".issue-comment-composer textarea");
  await input.fill("В пути"); await page.locator(".issue-comment-send").click(); await expect(page.locator(".issue-pending-comment")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator(".issue-pending-comment[data-pending]")).toHaveCount(0);
  await page.locator('.board-card[data-issue-id="i1"]').click(); await expect(input).toBeVisible(); await input.fill("Новый текст"); control.release();
  await expect.poll(() => control.finished).toBe(1); await expect(input).toHaveValue("Новый текст"); await expect(page.locator(".issue-pending-comment")).toHaveCount(0);
});
