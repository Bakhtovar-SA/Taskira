import {expect,test} from "@playwright/test";
import {boardFixture} from "./board-fixture";
import {settle} from "./motion-helpers";

for (const mode of ["normal","system","personal","no-vt"] as const) {
 test("D-17: lost keyboard focus follows the view, deliberate focus stays ("+mode+")", async ({page}) => {
  const csp:string[]=[];await page.exposeFunction("reportFocusCsp",(v:string)=>csp.push(v));
  await page.addInitScript(()=>document.addEventListener("securitypolicyviolation",e=>(window as unknown as {reportFocusCsp:(v:string)=>void}).reportFocusCsp(e.violatedDirective)));
  await page.emulateMedia({reducedMotion:mode==="system"?"reduce":"no-preference"});
  await page.addInitScript(mode => {
   if(mode==="personal")localStorage.setItem("taskira.reduceMotion","1");
   if(mode==="no-vt")Object.defineProperty(document,"startViewTransition",{value:undefined,configurable:true});
  },mode);
  await boardFixture(page);await page.goto("/p/CORP/board");
  const card=page.locator(".board-card-open").first();await expect(card).toBeVisible();await settle(page);
  await card.focus();await page.keyboard.press("2");
  const backlog=page.locator("main h1[data-view-heading]");await expect(backlog).toHaveText("Список");await expect(backlog).toBeFocused();
  await page.keyboard.press("1");await expect(page.locator("main h1")).toBeFocused();
  const tab=page.locator(".project-view-tabs a").filter({hasText:"Список"});await tab.click();
  await expect(page).toHaveURL(/\/list/);await settle(page);await expect(tab).toBeFocused();
  // Returning by a keyboard shortcut from the route itself keeps scroll stable.
  await backlog.focus();const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));
  await page.keyboard.press("1");await expect(page.locator("main h1")).toBeFocused();
  expect(await page.evaluate(()=>({x:scrollX,y:scrollY}))).toEqual(scroll);
  await page.keyboard.press("g");await page.keyboard.press("h");
  await expect(page.locator("main h1")).toBeFocused();
  expect(csp).toEqual([]);
 });
}
