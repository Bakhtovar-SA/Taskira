import {expect,test,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {boardFixture} from "./board-fixture";
import {loadMotion,settle} from "./motion-helpers";

const pageErrors = new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 const errors:string[]=[];pageErrors.set(page,errors);page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const records:string[]=[];(window as unknown as {undoCsp:string[]}).undoCsp=records;
  document.addEventListener("securitypolicyviolation",event=>records.push(event.violatedDirective));
 });
});
test.afterEach(async({page})=>{expect(pageErrors.get(page)).toEqual([]);expect(await page.evaluate(()=>(window as unknown as {undoCsp:string[]}).undoCsp)).toEqual([])});

async function fixture(page:Page,mode:"normal"|"system"|"personal"="normal") {
 await page.emulateMedia({reducedMotion:mode==="system"?"reduce":"no-preference"});
 await page.addInitScript(personal=>{if(personal)localStorage.setItem("taskira.reduceMotion","1")},mode==="personal");
 const f=await boardFixture(page);
 await page.route("**/api/projects/p1/issues/epic1",route=>route.fulfill({json:{...f.issues[0],id:"epic1",key:"CORP-E1",title:"Корпоративная платформа",epicId:null,collaborators:[],participants:[],attachments:[],links:[],checklist:[],customFieldValues:[]}}));
 await page.route("**/api/projects/p1/issues/i1/automation",route=>route.fulfill({json:{recurrence:null,remindAt:null}}));
 const requests:any[]=[];let stamp=0,conflict=false,gate:Promise<void>|null=null,release=()=>{};
 const nextStamp=()=>new Date(Date.UTC(2026,9,16,10,0,0,++stamp)).toISOString();
 await page.route(/\/api\/projects\/p1\/issues\/i1\/(comments|activity|collaborators)$/,route=>route.fulfill({json:[]}));
 await page.route("**/api/projects/p1/issues/i1",async route=>{
  if(route.request().method()==="GET")return route.fulfill({json:{...f.issues[0],links:[],attachments:[],checklist:[],customFieldValues:[],collaborators:[],participants:[],watch:{watching:false,watchers:0}}});
  if(route.request().method()!=="PATCH")return route.fallback();
  const body=route.request().postDataJSON(),issue=f.issues[0];requests.push(body);
  if(body.expectedUpdatedAt && body.expectedUpdatedAt!==issue.updatedAt)return route.fulfill({status:409,json:{error:{code:"CONFLICT",reason:"changed"}}});
  const previous=[...issue.labels];if(body.labels)issue.labels=body.labels;issue.updatedAt=nextStamp();
  return route.fulfill({json:{...issue,...(!body.expectedUpdatedAt&&previous.some(label=>!issue.labels.includes(label))?{undo:{issueId:issue.id,labels:previous,updatedAt:issue.updatedAt}}:{})}});
 });
 await page.route("**/api/projects/p1/issues/i1/transition",async route=>{
  const body=route.request().postDataJSON();requests.push(body);const issue=f.issues[0];
  if(body.expectedUpdatedAt){
   if(gate)await gate;
   if(conflict){issue.statusId="s3";issue.updatedAt=nextStamp();issue.title="Чужое изменение";return route.fulfill({status:409,json:{error:{code:"CONFLICT",reason:"Задача изменилась"}}});}
   if(body.expectedUpdatedAt!==issue.updatedAt)return route.fulfill({status:409,json:{error:{code:"CONFLICT",reason:"Задача изменилась"}}});
  }
  const previous=issue.statusId;issue.statusId=body.to;issue.updatedAt=nextStamp();
  return route.fulfill({json:{...issue,undo:{issueId:issue.id,statusId:previous,updatedAt:issue.updatedAt}}});
 });
 const loaded=mode==="normal"?loadMotion(page):Promise.resolve();await page.goto("/p/CORP/board");
 await expect(page.locator('article[data-issue-id="i1"]')).toBeVisible();await loaded;await settle(page);
 return {...f,requests,setConflict:()=>{conflict=true},hold:()=>{gate=new Promise<void>(resolve=>{release=resolve})},release:()=>release()};
}
async function move(page:Page){
 const card=page.locator('article[data-issue-id="i1"]');await card.locator(".board-card-open").focus();
 await page.keyboard.press("m");await page.getByRole("menuitem",{name:"В работе",exact:true}).click();
 await expect(page.getByRole("region",{name:"В работе",exact:true}).locator('article[data-issue-id="i1"]')).toBeVisible();await settle(page);
 return page.locator('[data-toast-id]').filter({has:page.getByRole("button",{name:"Отменить",exact:true})}).getByRole("button",{name:"Отменить",exact:true});
}
for(const mode of ["normal","system","personal"] as const)test("D-07: confirmed status undo and focus ("+mode+")",async({page})=>{
 const f=await fixture(page,mode),undo=await move(page);await undo.focus();
 if(mode==="normal"){
  await page.waitForTimeout(4400);await expect(undo).toBeVisible();await expect(undo).toBeFocused();
  expect((await new AxeBuilder({page}).include("[data-toast-id]").analyze()).violations).toEqual([]);
  await page.screenshot({path:"test-results/undo-focused.png"});
 }
 const expected=f.issues[0].updatedAt;f.hold();await undo.click();await expect(undo).toHaveAttribute("aria-busy","true");
 expect(f.issues[0].statusId).toBe("s2");f.release();
 await expect(page.getByRole("region",{name:"К выполнению",exact:true}).locator('article[data-issue-id="i1"]')).toBeVisible();
 await expect(page.locator('article[data-issue-id="i1"] .board-card-open')).toBeFocused();await settle(page);
 expect(f.requests[1]).toMatchObject({to:"s1",expectedUpdatedAt:expected});await expect(undo).toHaveCount(0);
});
test("D-07: conflicting server change is not overwritten",async({page})=>{
 const f=await fixture(page),undo=await move(page);f.setConflict();await undo.click();
 await expect(page.locator('[data-toast-id]').filter({hasText:"Изменённые или недоступные"})).toBeVisible();
 await expect(page.getByRole("region",{name:f.statuses.find(status=>status.id==="s3")!.name,exact:true}).locator('article[data-issue-id="i1"]')).toBeVisible();
 expect(f.issues[0].statusId).toBe("s3");expect(f.requests).toHaveLength(2);
});
test("D-07: deliberate focus during delayed undo is preserved",async({page})=>{
 const f=await fixture(page),undo=await move(page);f.hold();await undo.click();
 const search=page.locator('.global-topbar').getByRole('button',{name:/Поиск и команды/});await search.focus();f.release();
 await expect(page.getByRole("region",{name:"К выполнению",exact:true}).locator('article[data-issue-id="i1"]')).toBeVisible();
 await settle(page);await expect(search).toBeFocused();
});


for(const fallback of [false,true])test("D-07: label removal Undo is keyboard reachable inside the task dialog ("+(fallback?"append":"atomic")+")",async({page})=>{
 if(fallback)await page.addInitScript(()=>Object.defineProperty(Element.prototype,"moveBefore",{configurable:true,value:undefined}));
 const f=await fixture(page);
 await page.locator('article[data-issue-id="i1"] .board-card-open').click();
 const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 await dialog.getByRole("button",{name:"Убрать: internal-label",exact:true}).click();
 await expect(dialog.locator(".issue-labels").getByText("internal-label",{exact:true})).toHaveCount(0);
 const undo=page.getByRole("button",{name:"Отменить",exact:true});await expect(undo).toBeVisible();
 // Walk the actual native tab order: editor -> focusable aria-disabled Send -> Undo.
 await dialog.getByRole("textbox",{name:"Комментарии",exact:true}).focus();await page.keyboard.press("Tab");
 await expect(dialog.getByRole("button",{name:"Отправить",exact:true})).toBeFocused();await page.keyboard.press("Tab");
 await expect(undo).toBeFocused();
 if(fallback){await expect(page.locator("[data-toast-id][data-toast-relocated]")).toHaveCount(1);expect(await undo.evaluate(el=>el.closest("[data-toast-id]")!.getAnimations().length)).toBe(0);}
 await page.keyboard.press("Enter");
 await expect(dialog.locator(".issue-labels").getByText("internal-label",{exact:true})).toBeVisible();
 expect(f.issues[0].labels).toEqual(["internal-label"]);expect(f.requests).toHaveLength(2);
});
