import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { shellFixture } from "./shell-fixture";

async function ready(page: Page, width = 1920, theme = "dark") {
  await shellFixture(page, theme);
  await page.addInitScript(() => {
    localStorage.setItem("taskira.sidebar.collapsed", "0");
    // Old collapsed teams must not hide the newly approved project hierarchy.
    if (!localStorage.getItem("taskira.sidebar.open")) localStorage.setItem("taskira.sidebar.open", JSON.stringify({"s:projects": false, "d:d1": false, "d:d2": false}));
  });
  await page.setViewportSize({ width, height: width === 3440 ? 1440 : 1080 });
  await page.goto("/p/CORP/board");
  await expect(page.locator(".sidebar-team")).toHaveCount(2);
}
const widthOf = async (page: Page) => (await page.locator("aside").boundingBox())!.width;
async function dragBy(page: Page, delta: number) {
  const box = (await page.getByRole("separator", {name: "Изменить ширину панели"}).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + delta, box.y + 80, {steps: 8}); await page.mouse.up();
}
for (const theme of ["dark", "light"]) for (const width of [1920, 3440]) {
  test(`sidebar drag, persistence, collapse and accessibility (${theme}, ${width})`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await ready(page, width, theme);
    const zoom = width === 3440 ? 1.1 : 1, initial = (width === 3440 ? 304 : 248) * zoom;
    expect(await widthOf(page)).toBeCloseTo(initial, 0);
    await expect(page.locator(".sidebar-projects-toggle").first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".sidebar-projects-list").last()).toBeVisible();
    expect(await page.locator(".sidebar-team-heading button").count()).toBe(0);
    const surface = await page.locator(".sidebar-projects-header").first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(surface).toBe("rgba(0, 0, 0, 0)");
    await dragBy(page, 88);
    const resized = await widthOf(page); expect(Math.abs(resized - initial - 88)).toBeLessThanOrEqual(1);
    const stored = await page.evaluate(() => Number(localStorage.getItem("taskira.sidebar.width")));
    expect(resized).toBeCloseTo(stored * zoom, 0);
    await page.reload(); await expect(page.locator(".sidebar-team")).toHaveCount(2);
    await expect.poll(() => widthOf(page)).toBeCloseTo(resized, 0);
    await page.locator("[data-sidebar-toggle]").click(); await expect(page.locator(".sidebar-rail")).toBeVisible();
    await expect(page.getByRole("separator")).toHaveCount(0);
    await page.locator("[data-sidebar-toggle]").click();
    await expect.poll(() => widthOf(page)).toBeCloseTo(resized, 0);
    const axe = await new AxeBuilder({ page }).include("aside").analyze(); expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}
test("sidebar keyboard bounds, reset and cancelling a drag", async ({page}) => {
  await ready(page);
  const separator = page.getByRole("separator", {name:"Изменить ширину панели"}); await separator.focus();
  await page.keyboard.press("End"); expect(await widthOf(page)).toBe(420);
  await page.keyboard.press("ArrowRight"); expect(await widthOf(page)).toBe(420);
  await page.keyboard.press("Home"); expect(await widthOf(page)).toBe(220);
  await page.keyboard.press("Shift+ArrowRight"); expect(await widthOf(page)).toBe(244);
  await page.keyboard.press("Enter"); await expect.poll(() => widthOf(page)).toBe(248);
  expect(await page.evaluate(() => localStorage.getItem("taskira.sidebar.width"))).toBeNull();
  const box=(await separator.boundingBox())!; await page.mouse.move(box.x+4,box.y+80); await page.mouse.down(); await page.mouse.move(box.x+90,box.y+80);
  const dragAppearance=await separator.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow,lineWidth:getComputedStyle(el,'::after').width}));
  expect(dragAppearance).toEqual({outline:"none",shadow:"none",lineWidth:"2px"});
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect.poll(() => widthOf(page)).toBe(248);
  expect(await page.evaluate(() => document.body.classList.contains("sidebar-resizing"))).toBe(false);
  await dragBy(page,70); await separator.dblclick(); await expect.poll(() => widthOf(page)).toBe(248);
  expect(await page.evaluate(() => localStorage.getItem("taskira.sidebar.width"))).toBeNull();
});
test("project groups remain independent, persist and create in the selected team", async ({page}) => {
  await ready(page); const groups=page.locator(".sidebar-team");
  await groups.first().getByRole("button",{name:/Проекты/}).click();
  await expect(groups.first().locator(".sidebar-projects-list")).toBeHidden(); await expect(groups.last().locator(".sidebar-projects-list")).toBeVisible();
  await page.reload(); await expect(groups.first().locator(".sidebar-projects-list")).toBeHidden();
  await page.evaluate(() => window.addEventListener("taskira:project-wizard", e => { (window as unknown as {wizardDepartment:string}).wizardDepartment=(e as CustomEvent).detail.departmentId; },{once:true}));
  await groups.last().locator(".sidebar-projects-add").click();
  expect(await page.evaluate(() => (window as unknown as {wizardDepartment:string}).wizardDepartment)).toBe("d2");
});
test("desktop preference leaves the mobile drawer usable", async ({page}) => {
  await ready(page); await dragBy(page,100); await page.setViewportSize({width:390,height:844});
  await page.locator(".global-topbar").getByRole("button",{name:"Меню",exact:true}).click();
  const drawer=page.getByRole("dialog",{name:"Меню",exact:true}); await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())!.width).toBe(304); await expect(page.getByRole("separator")).toHaveCount(0);
  await expect(drawer.locator(".sidebar-projects-list").last()).toBeVisible(); await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0);
  await page.setViewportSize({width:1920,height:1080}); await expect.poll(() => widthOf(page)).toBe(348);
});
test("drag past the minimum collapses and preserves the previous width", async ({page}) => {
  await ready(page); await dragBy(page,80); expect(await widthOf(page)).toBe(328);
  await dragBy(page,-200); await expect(page.locator(".sidebar-rail")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("taskira.sidebar.width"))).toBe("328");
  await page.locator("[data-sidebar-toggle]").click(); await expect.poll(() => widthOf(page)).toBe(328);
  await dragBy(page,16);
  const separator=page.getByRole("separator",{name:"Изменить ширину панели"});
  expect(await separator.evaluate(el=>document.activeElement===el)).toBe(false);
  const appearance=await separator.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,line:getComputedStyle(el,'::after').backgroundColor}));
  expect(appearance).toEqual({outline:"none",line:"rgba(0, 0, 0, 0)"});
});
