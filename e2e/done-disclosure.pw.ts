import { expect, test, type Page } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle, settleScroll } from "./motion-helpers";

const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 const list:string[]=[];errors.set(page,list);page.on("pageerror",e=>list.push(e.message));
 await page.addInitScript(()=>{
  const state=window as Window & {doneEntries:number;doneGrids:number;doneCsp:string[]};state.doneEntries=0;state.doneGrids=0;state.doneCsp=[];
  document.addEventListener("securitypolicyviolation",e=>state.doneCsp.push(e.violatedDirective));
  document.addEventListener("animationstart",e=>{if(e.animationName==="doneTailIn"&&getComputedStyle(e.target as Element).animationDuration!=="0s")state.doneGrids++;},true);
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(this:Element,...args:Parameters<Element["animate"]>){
   if(this.matches('[data-issue-id="i9"], [data-issue-id^="old-"]')&&JSON.stringify(args[0]).includes("translateY(8px)"))state.doneEntries++;
   return animate.apply(this,args);
  };
 });
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);expect(await page.evaluate(()=>(window as Window & {doneCsp:string[]}).doneCsp)).toEqual([]);});
async function setup(page:Page,mode:"normal"|"system"|"personal"="normal",oldCount=1){
 await page.setViewportSize({width:mode==="normal"?1460:390,height:900});
 await page.emulateMedia({reducedMotion:mode==="system"?"reduce":"no-preference"});
 if(mode==="personal")await page.addInitScript(()=>localStorage.setItem("taskira.reduceMotion","1"));
 const f=await boardFixture(page,"light");
 const source=f.issues.find(i=>i.id==="i9")!;
 for(let i=1;i<oldCount;i++)f.issues.push({...source,id:"old-"+i,key:"CORP-"+(90+i),title:"Старая задача "+i});
 const pages:{closed:string|null;status:string|null}[]=[];let hold=true,fail=false,release:()=>void=()=>{};
 await page.route("**/api/projects/p1/issues*",async route=>{
  const url=new URL(route.request().url()),p=url.searchParams;
  if(route.request().method()!=="GET"||!["/api/projects/p1/issues","/api/projects/p1/issues/counts"].includes(url.pathname))return route.fallback();
  const cutoff=Date.parse("2026-10-04T07:00:00Z")-14*86400000;
  const items=f.issues.filter(i=>{
   const old=i.statusId==="s4"&&i.doneAt!=null&&Date.parse(i.doneAt)<cutoff;
   return(!p.get("status")||i.statusId===p.get("status"))&&(!p.get("q")||i.title.toLowerCase().includes(p.get("q")!.toLowerCase()))&&
    (!p.get("assignee")||(p.get("assignee")==="none"?i.assigneeIds.length===0:i.assigneeIds.includes(p.get("assignee")!)))&&
    (p.get("closed")!=="older"||old)&&(p.get("closed")!=="recent"||!old)&&
    (!p.get("overdue")||i.statusId!=="s4"&&!!i.dueDate&&i.dueDate<"2026-10-04");
  });
  if(url.pathname.endsWith("/counts"))return route.fulfill({json:{total:items.length,byStatus:Object.fromEntries(f.statuses.map(s=>[s.id,items.filter(i=>i.statusId===s.id).length]))}});
  pages.push({closed:p.get("closed"),status:p.get("status")});
  if(p.get("closed")==="older"){
   if(hold)await new Promise<void>(resolve=>{release=resolve;});
   if(fail)return route.fulfill({status:409,json:{error:{code:"CONFLICT",reason:"Old page rejected"}}});
  }
  return route.fulfill({json:{items,hasMore:false,nextCursor:null}});
 });
 const loaded=mode==="normal"?loadMotion(page):null;await page.goto("/p/CORP/board");
 await expect(page.locator('.board-card[data-issue-id="i8"]')).toBeVisible();if(loaded)await loaded;await settle(page);
 return{pages,release:()=>release(),hold:(on:boolean)=>{hold=on;},fail:(on:boolean)=>{fail=on;}};
}
const motion=(page:Page)=>page.evaluate(()=>{const w=window as Window & {doneEntries:number;doneGrids:number};return{entries:w.doneEntries,grids:w.doneGrids};});
for(const mode of ["normal","system","personal"] as const)test(`older done disclosure preserves recent DOM and focus (${mode})`,async({page})=>{
 const f=await setup(page,mode),lane=page.getByRole("region",{name:"Готово",exact:true}),toggle=lane.locator("[data-done-disclosure]");
 const recent=page.locator('.board-card[data-issue-id="i8"]'),recentNode=await recent.elementHandle(),buttonNode=await toggle.elementHandle();
 const recentRequests=()=>f.pages.filter(p=>p.status==="s4"&&p.closed==="recent").length;
 expect(recentRequests()).toBe(1);expect(f.pages.filter(p=>p.closed==="older")).toHaveLength(0);
 try{
  // Focus can intentionally scroll the mobile lane; measure only after that native scroll settles.
  const scroll=mode==="normal"?lane.locator(".board-col-body"):page.locator(".board-scroll");
  await settleScroll(scroll,{trigger:()=>toggle.focus()});const initial=(await recent.boundingBox())!;
  await toggle.press("Enter");await expect(toggle).toHaveAttribute("aria-expanded","true");
  await expect.poll(()=>f.pages.filter(p=>p.closed==="older").length).toBe(1);
  await expect(lane.locator('[data-issue-id="i9"]')).toHaveCount(0);await expect(toggle).toBeFocused();
  expect(await recent.evaluate((el,original)=>el===original,recentNode)).toBe(true);
  f.hold(false);f.release();await expect(lane.locator('.board-card[data-issue-id="i9"]')).toBeVisible();await settle(page);
  expect(await motion(page)).toEqual(mode==="normal"?{entries:1,grids:1}:{entries:0,grids:0});
  await expect(lane.locator('.board-card[data-issue-id="i9"]')).toHaveCount(1);await expect(toggle).toBeFocused();
  expect(await toggle.evaluate((el,original)=>el===original,buttonNode)).toBe(true);expect(recentRequests()).toBe(1);
  const final=(await recent.boundingBox())!;for(const key of ["x","y","width","height"] as const)expect(final[key]).toBeCloseTo(initial[key],2);
  await lane.locator('.board-card[data-issue-id="i9"]').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath("done-disclosure-"+mode+".png")});
  await toggle.press("Enter");await expect(lane.locator("[data-done-tail]")).toHaveCount(0);await expect(toggle).toBeFocused();
  f.fail(true);await toggle.press("Enter");const retry=lane.locator("[data-done-tail] button").first();await expect(retry).toBeVisible();
  expect(await motion(page)).toEqual(mode==="normal"?{entries:1,grids:1}:{entries:0,grids:0});
  f.fail(false);await retry.focus();await retry.press("Enter");await expect(lane.locator('.board-card[data-issue-id="i9"]')).toBeVisible();await settle(page);
  await expect(toggle).toBeFocused();expect(await motion(page)).toEqual(mode==="normal"?{entries:2,grids:2}:{entries:0,grids:0});
  expect(recentRequests()).toBe(1);expect(await recent.evaluate((el,original)=>el===original,recentNode)).toBe(true);
  await page.goto("/p/CORP/board?done=1");await expect(page.locator('.board-card[data-issue-id="i9"]')).toBeVisible();await settle(page);
  expect(await motion(page)).toEqual({entries:0,grids:0});
 }finally{f.release();}
});
test("nine older cards use one disclosure and no overflowing row entrance queue",async({page})=>{
 const f=await setup(page,"normal",9);f.hold(false);await page.locator("[data-done-disclosure]").click();
 await expect(page.locator("[data-done-tail] .board-card")).toHaveCount(9);await settle(page);
 expect(await motion(page)).toEqual({entries:0,grids:1});await page.waitForTimeout(400);expect(await motion(page)).toEqual({entries:0,grids:1});
});
test("closing before the old page responds cannot resurrect its rows or motion",async({page})=>{
 const f=await setup(page);const toggle=page.locator("[data-done-disclosure]");
 await toggle.click();await expect.poll(()=>f.pages.filter(p=>p.closed==="older").length).toBe(1);
 await toggle.click();f.hold(false);f.release();await settle(page);await expect(page.locator("[data-done-tail]")).toHaveCount(0);
 expect(await motion(page)).toEqual({entries:0,grids:0});
});
