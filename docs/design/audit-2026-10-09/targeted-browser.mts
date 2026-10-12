
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "../../../e2e/board-fixture";
import { shellFixture } from "../../../e2e/shell-fixture";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const output: any = {};
try {
  const context = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, reducedMotion:"reduce" });
  const page = await context.newPage(); await boardFixture(page);
  await page.goto("http://127.0.0.1:3111/p/CORP/board");
  const card = page.locator('[data-issue-id="i1"]');
  await card.waitFor(); await card.scrollIntoViewIfNeeded(); await expect.poll(async () => (await card.locator("button").first().boundingBox())?.width ?? 0).toBeGreaterThan(0);
  output.cardAriaSnapshot = await card.ariaSnapshot();
  output.cardMarkup = await card.evaluate(el=>({tag:el.tagName,role:el.getAttribute("role"),tabIndex:el.getAttribute("tabindex"),label:el.getAttribute("aria-label")}));
  output.cardButtons = await card.locator("button").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(); return {label:el.getAttribute("aria-label"),width:r.width,height:r.height,x:r.x,y:r.y,ariaHasPopup:el.getAttribute("aria-haspopup")};}));
  await card.focus(); await page.keyboard.press("Enter");
  output.keyboardOpenDialog = await page.getByRole("dialog").count();
  await page.keyboard.press("Escape");
  await page.locator(".global-topbar").getByRole("button",{name:"Меню",exact:true}).click();
  const aside = page.locator("aside"); await expect.poll(() => aside.evaluate(el => el.getBoundingClientRect().x)).toBeGreaterThanOrEqual(0); await page.waitForTimeout(250);
  output.drawer = await aside.evaluate(el=>({role:el.getAttribute("role"),ariaModal:el.getAttribute("aria-modal"),activeInside:el.contains(document.activeElement)}));
  for (let n=0;n<30;n++) {
    await page.keyboard.press("Tab");
    if (!(await aside.evaluate(el=>el.contains(document.activeElement)))) {
      output.drawer.firstEscapeTab=n+1;
      output.drawer.focusOutside=await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label"),text:document.activeElement?.textContent?.slice(0,100)}));
      break;
    }
  }
  await page.keyboard.press("Escape");
  output.drawer.escapeFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label"),text:document.activeElement?.textContent?.slice(0,100)}));
  output.fullPageAxe = (await new AxeBuilder({page}).analyze()).violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
  await page.close();
} finally {await browser.close();}
await writeFile("docs/design/audit-2026-10-09/targeted-browser.json",JSON.stringify(output,null,2));
