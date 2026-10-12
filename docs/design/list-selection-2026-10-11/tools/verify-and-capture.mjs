import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
const root=process.cwd(),out=root+'/docs/design/list-selection-2026-10-11',base='http://localhost:3000';
const env=Object.fromEntries(readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const fixture=JSON.parse(readFileSync(root+'-runtime/fixture.json','utf8')),project=fixture.projects.find(p=>p.key==='UX');
const browser=await chromium.launch(),checks=[],shots=[],errors=[];
const login=async(ctx,role='admin')=>expect((await ctx.request.post(base+'/api/auth/login',{data:{username:'audit_'+role,password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
const save=()=>{writeFileSync(out+'/real-api-checks.json',JSON.stringify({checks,errors},null,2));writeFileSync(out+'/screenshots.json',JSON.stringify(shots,null,2));};
async function shot(page,file,details){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:out+'/screenshots/'+file,animations:'disabled',caret:'hide'});shots.push({file:'screenshots/'+file,route:new URL(page.url()).pathname+new URL(page.url()).search,role:'admin',viewport:page.viewportSize(),sha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',workingTree:true,capturedAt:new Date().toISOString(),...details});save();}
try{
 if(!process.env.API_ONLY) for(const theme of ['dark','light'])for(const width of [1920,3440,390]){
  const ctx=await browser.newContext({viewport:{width,height:width===3440?1440:width===1920?1080:844},locale:'ru-RU',hasTouch:width===390,reducedMotion:'reduce'});
  await ctx.addInitScript(theme=>{localStorage.setItem('taskira.theme',theme);localStorage.setItem('taskira.lang','ru');},theme);await login(ctx);const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/p/UX/list?group=status',{waitUntil:'networkidle'});await page.locator('.list-row').first().waitFor();await page.mouse.move(0,0);
  await shot(page,`${theme}-${width}-calm.png`,{state:'calm'});
  if(width>390){await page.locator('.list-row').first().hover();await shot(page,`${theme}-${width}-hover.png`,{state:'hover'});}
  for(let i=0;i<2;i++)await page.locator('.list-row').nth(i).locator('.ds-check').click();
  const dock=page.locator('.list-selection-dock');await expect(dock).toBeVisible();await shot(page,`${theme}-${width}-selected.png`,{state:'selected'});
  await dock.getByRole('button',{name:'Действия',exact:true}).click();await shot(page,`${theme}-${width}-actions.png`,{state:'actions'}); if(theme==='dark'&&width===1920)await page.locator('.bulk-action-menu').screenshot({path:out+'/screenshots/actions-menu.png'});
  const axe=await new AxeBuilder({page}).include('.list-view').analyze();checks.push({name:`selection axe ${theme} ${width}`,pass:!axe.violations.some(v=>['serious','critical'].includes(v.impact)),details:axe.violations.map(v=>({id:v.id,impact:v.impact}))});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(dock).toHaveCount(0);
  await page.getByRole('button',{name:'Фильтры',exact:true}).click();await shot(page,`${theme}-${width}-filters.png`,{state:'filters'}); if(theme==='dark'&&width===1920)await page.locator('.workspace-pop').screenshot({path:out+'/screenshots/filters-menu.png'});
  const filtersAxe=await new AxeBuilder({page}).include('.workspace-pop').analyze();checks.push({name:`filters axe ${theme} ${width}`,pass:!filtersAxe.violations.some(v=>['serious','critical'].includes(v.impact)),details:filtersAxe.violations.map(v=>({id:v.id,impact:v.impact}))});
  await page.locator('.workspace-panel[data-panel="filters"]').getByRole('button',{name:'Статус',exact:true}).click();
  const valueMenu=page.locator('.workspace-select-menu');await expect(valueMenu).toBeVisible();await shot(page,`${theme}-${width}-status-menu.png`,{state:'status-menu'});
  if(theme==='dark'&&width===1920)await valueMenu.screenshot({path:out+'/screenshots/status-menu.png'});
  const valueAxe=await new AxeBuilder({page}).include('.workspace-select-menu').analyze();checks.push({name:`value menu axe ${theme} ${width}`,pass:!valueAxe.violations.length,details:valueAxe.violations.map(v=>({id:v.id,impact:v.impact}))});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Настройки вида',exact:true}).click();await shot(page,`${theme}-${width}-view.png`,{state:'view'}); if(theme==='dark'&&width===1920)await page.locator('.workspace-pop').screenshot({path:out+'/screenshots/view-menu.png'});
  if(width>390){await page.goto(base+'/p/UX/calendar',{waitUntil:'networkidle'});await page.locator('.calendar-day').first().waitFor();await shot(page,`${theme}-${width}-calendar.png`,{state:'calendar'});
    const boxes=await page.locator('.calendar-more').evaluateAll(elements=>elements.map(el=>{const a=el.getBoundingClientRect(),b=el.closest('.calendar-day').getBoundingClientRect();return{bottom:a.bottom,cellBottom:b.bottom};}));checks.push({name:`calendar overflow ${theme} ${width}`,pass:boxes.every(b=>b.bottom<=b.cellBottom),details:boxes});}
  await page.goto(base+'/p/UX/board',{waitUntil:'networkidle'});await page.locator('.board-card').first().waitFor();await page.mouse.move(0,0);
  await shot(page,`${theme}-${width}-board.png`,{state:'board'});
  const empty=page.locator('.board-card .ds-av-empty').first();await expect(empty).toBeVisible();
  expect(await empty.evaluate(el=>getComputedStyle(el).borderWidth)).toBe('0px');
  checks.push({name:`single unassigned contour ${theme} ${width}`,pass:true});
  if(theme==='dark'&&width===1920)await empty.locator('xpath=..').screenshot({path:out+'/screenshots/unassigned.png'});
  const avatar=page.locator('.board-card-assignees button').first();if(width===390)await avatar.click();else await avatar.hover();
  const preview=page.locator('.user-preview');await expect(preview).toBeVisible();await shot(page,`${theme}-${width}-user-preview.png`,{state:width===390?'profile-click':'profile-hover'});
  if(theme==='dark'&&width===1920)await preview.screenshot({path:out+'/screenshots/user-preview.png'});
  const previewAxe=await new AxeBuilder({page}).include('.user-preview').analyze();checks.push({name:`profile axe ${theme} ${width}`,pass:!previewAxe.violations.length,details:previewAxe.violations.map(v=>({id:v.id,impact:v.impact}))});
  await page.keyboard.press('Escape');await ctx.close();
 }
 if(!process.env.CAPTURE_ONLY){ const ctx=await browser.newContext({viewport:{width:1920,height:1080}});await login(ctx);const page=await ctx.newPage();page.setDefaultTimeout(15000);let created=[];
 try{
  const boot=await (await ctx.request.get(base+'/api/projects/'+project.id)).json();const status=boot.workflow.statuses.find(s=>s.category==='todo');const prefix='Проверка выделения '+Date.now();
  for(let i=1;i<=2;i++){const response=await ctx.request.post(base+`/api/projects/${project.id}/issues`,{data:{title:prefix+' '+i,typeId:'task',statusId:status.id,priorityId:'medium',epicId:null,complexity:null}});expect(response.status()).toBe(201);created.push(await response.json());}
  await page.goto(base+'/p/UX/list?group=none&q='+encodeURIComponent(prefix),{waitUntil:'networkidle'});await expect(page.locator('.list-row')).toHaveCount(2);
  for(const issue of created)await page.locator(`[data-issue-id="${issue.id}"] .ds-check`).click();
  const dock=page.locator('.list-selection-dock');await dock.getByRole('button',{name:'Действия',exact:true}).click();await dock.getByRole('button',{name:'Приоритет',exact:true}).click();const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/issues/bulk'));await page.getByRole('menuitem',{name:'Высокий',exact:true}).click();const result=await (await response).json();expect(result.succeeded.sort()).toEqual(created.map(i=>i.id).sort());await expect(dock).toHaveCount(0);await page.reload({waitUntil:'networkidle'});
  for(const issue of created){const persisted=await (await ctx.request.get(base+`/api/projects/${project.id}/issues/${issue.id}`)).json();expect(persisted.priorityId).toBe('high');}
  checks.push({name:'real API bulk priority and reload persistence',pass:true,details:{tasks:2,status:200,reload:true}});
  const viewer=await browser.newContext();try{await login(viewer,'viewer');const vp=await viewer.newPage();await vp.goto(base+'/p/UX/list?q='+encodeURIComponent(prefix));await expect(vp.locator('.list-row')).toHaveCount(2);await expect(vp.locator('.list-select')).toHaveCount(0);const result=await viewer.request.patch(base+`/api/projects/${project.id}/issues/bulk`,{data:{action:'priority',issueIds:created.map(i=>i.id),priorityId:'low'}});expect(result.status()).toBe(200);const body=await result.json();expect(body.succeeded).toEqual([]);expect(body.failed).toHaveLength(2);checks.push({name:'viewer controls hidden and server denies forged bulk request',pass:true,details:{denied:2}});}finally{await viewer.close();}
 }finally{for(const issue of created){const r=await ctx.request.delete(base+`/api/projects/${project.id}/issues/${issue.id}`);checks.push({name:'cleanup disposable task',pass:r.ok(),details:{key:issue.key,status:r.status()}});}await ctx.close();}
}
}catch(e){checks.push({name:'capture and real API verification',pass:false,error:e.message});}finally{save();await browser.close();console.log(JSON.stringify({screenshots:shots.length,checks:checks.length,failed:checks.filter(c=>!c.pass),errors}));process.exitCode=checks.some(c=>!c.pass)||errors.length?1:0;}
