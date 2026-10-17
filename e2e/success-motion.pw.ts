import { expect, test, type Page } from "@playwright/test";
import { issueFixture } from "./issue-fixture";
import { loadMotion, settle } from "./motion-helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({page}) => {
  const messages: string[] = []; errors.set(page, messages); page.on("pageerror", e => messages.push(e.message));
  await page.addInitScript(() => {
    const state = window as Window & { successFlashes: number; successCsp: string[] };
    state.successFlashes = 0; state.successCsp = [];
    document.addEventListener("securitypolicyviolation", e => state.successCsp.push(e.violatedDirective));
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(this: Element, ...args: Parameters<Element["animate"]>) {
      if (this.tagName === "SPAN" && this.textContent?.startsWith("Чек-лист") && JSON.stringify(args[0]).includes("backgroundColor")) state.successFlashes++;
      return animate.apply(this, args);
    };
  });
});
test.afterEach(async ({page}) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => (window as Window & { successCsp: string[] }).successCsp)).toEqual([]);
});

for (const mode of ["normal", "system", "personal"] as const) test(`success icon and acknowledged checklist completion (${mode})`, async ({page}) => {
  await page.setViewportSize({width: mode === "normal" ? 1460 : 390, height: 900});
  await page.emulateMedia({reducedMotion: mode === "system" ? "reduce" : "no-preference"});
  if (mode === "personal") await page.addInitScript(() => localStorage.setItem("taskira.reduceMotion", "1"));
  await issueFixture(page, "light");
  const loaded = mode === "normal" ? loadMotion(page) : null;
  await page.goto("/p/CORP/board");
  await expect(page.locator('.board-card[data-issue-id="i1"]')).toBeVisible();
  if (loaded) await loaded;
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/projects/p1/issues/i1" && r.request().method() === "GET");
  await page.locator('.board-card[data-issue-id="i1"]').click();
  const detail = await (await response).json();
  await page.route("**/api/projects/p1/issues/i1", route => route.fulfill({json: detail}));
  let release!: () => void, first = true, fail = false, requests = 0;
  await page.route("**/api/projects/p1/issues/i1/checklist/check1", async route => {
    expect(route.request().method()).toBe("PATCH"); requests++;
    if (first) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    if (fail) return route.fulfill({status:409,json:{error:{code:"CONFLICT",reason:"Checklist edit rejected"}}});
    detail.checklist[0].done = route.request().postDataJSON().done;
    await route.fulfill({json:{item:detail.checklist[0],checklist:detail.checklist}});
  });
  const dialog = page.getByRole("dialog");
  const checkbox = dialog.getByRole("checkbox", {name:"Проверить уведомления",exact:true});
  const flashes = () => page.evaluate(() => (window as Window & {successFlashes:number}).successFlashes);
  try {
    await expect(checkbox).toBeVisible(); await settle(page); expect(await flashes()).toBe(0);
    await checkbox.click(); await expect.poll(() => requests).toBe(1); await expect(checkbox).not.toBeChecked();
    await expect(dialog.getByText("Чек-лист 0 из 1", {exact:true})).toBeVisible(); expect(await flashes()).toBe(0);
    release(); await expect(dialog.getByText("Чек-лист 1 из 1", {exact:true})).toBeVisible(); await settle(page);
    expect(await flashes()).toBe(mode === "normal" ? 1 : 0);
    await checkbox.click(); await expect(dialog.getByText("Чек-лист 0 из 1", {exact:true})).toBeVisible();
    fail = true; await checkbox.click(); await expect.poll(() => requests).toBe(3); await settle(page);
    await expect(checkbox).not.toBeChecked(); expect(await flashes()).toBe(mode === "normal" ? 1 : 0);
    const errorToast = page.locator("[data-toast-id]").filter({hasText:"Checklist edit rejected"});
    await expect(errorToast).toBeVisible(); await expect(errorToast.locator(".success-check")).toHaveCount(0);
    fail = false; await checkbox.click(); await expect(dialog.getByText("Чек-лист 1 из 1", {exact:true})).toBeVisible(); await settle(page);
    expect(await flashes()).toBe(mode === "normal" ? 2 : 0);
    if (mode === "normal") await dialog.getByRole("button", {name:"Скопировать ссылку"}).first().click();
    else { await dialog.getByRole("button", {name:"Действия",exact:true}).click(); await page.getByRole("menuitem", {name:"Скопировать ссылку"}).click(); }
    const icon = page.locator("[data-toast-id] .success-check").last();
    await expect(icon).toBeVisible(); await expect(icon.locator("path")).toHaveAttribute("pathLength", "1");
    const duration = await icon.locator("path").evaluate(el => getComputedStyle(el).animationDuration);
    expect(duration).toBe(mode === "normal" ? "0.3s" : "0s");
    await page.screenshot({path:test.info().outputPath("success-"+mode+".png")});
    await page.keyboard.press("Escape"); await expect(page.locator(".issue-detail")).toHaveCount(0);
    await page.locator('.board-card[data-issue-id="i1"]').click();
    await expect(page.getByRole("dialog").getByText("Чек-лист 1 из 1", {exact:true})).toBeVisible(); await settle(page);
    expect(await flashes()).toBe(mode === "normal" ? 2 : 0);
  } finally { release?.(); }
});
