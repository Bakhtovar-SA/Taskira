import { chromium } from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const root='D:/CodexScratch/Taskira-UI-Audit-20261009';const out=`${root}/docs/design/audit-2026-10-09`;const runtime=`${root}-runtime`;
const env=Object.fromEntries(readFileSync(`${root}/server/.env.audit`,'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const fixtures=JSON.parse(readFileSync(`${runtime}/fixture.json`));const longIssue=fixtures.issues.find(i=>i.key==='UX-7');
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));page.on('console',m=>{if(m.type()==='error')errors.push({message:m.text()});});
const login=await context.request.post('http://localhost:3000/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}});if(login.status()!==200)throw new Error(`Login ${login.status()}`);
mkdirSync(`${out}/screenshots`,{recursive:true});const shots=[];const inventory=[];
async function nav(route){await page.goto(`http://localhost:3000${route}`,{waitUntil:'networkidle',timeout:60000});await page.waitForTimeout(350);}
async function shot(name,state='default'){
 await page.mouse.move(0,0);const filename=`${name}.png`;await page.screenshot({path:`${out}/screenshots/${filename}`,animations:'disabled',caret:'hide'});
 const item={file:`screenshots/${filename}`,route:new URL(page.url()).pathname+new URL(page.url()).search,role:'admin',viewport:page.viewportSize(),theme:await page.locator('html').getAttribute('data-theme'),state,sha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',capturedAt:new Date().toISOString()};shots.push(item);writeFileSync(`${out}/screenshots.json`,JSON.stringify(shots,null,2));console.log(filename);
}
try {
 for(const theme of ['light','dark'])for(const [device,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  await page.setViewportSize({width,height});await nav('/');await page.evaluate(t=>localStorage.setItem('taskira.theme',t),theme);await page.reload({waitUntil:'networkidle'});
  const prefix=`${theme}-${device}`;await shot(`${prefix}-home`);
  await nav('/p/UX/board');await page.locator('[data-issue-id]').first().waitFor();await shot(`${prefix}-board`);
  if(device==='desktop'){await page.getByRole('button',{name:/^Просрочено/}).click();await shot(`${prefix}-board-overdue`,'overdue filter');await nav('/p/UX/board');}
  await page.locator(`[data-issue-id="${longIssue.id}"]`).click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').locator('.issue-title').waitFor();await shot(`${prefix}-issue-panel`,'long title and multiple assignees');await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
  await page.keyboard.press('c');await page.getByRole('dialog').waitFor();await shot(`${prefix}-create`,'create issue form');inventory.push({view:'create',prefix,text:await page.getByRole('dialog').innerText(),inputs:await page.locator('input,textarea').evaluateAll(ns=>ns.map(n=>({tag:n.tagName,placeholder:n.getAttribute('placeholder'),aria:n.getAttribute('aria-label')})))});await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
  await nav('/p/UX/list');await page.getByRole('table').waitFor();await shot(`${prefix}-list`);
  if(device==='desktop'){await page.getByRole('button',{name:/^(Вид|Настройки вида)$/}).click();await shot(`${prefix}-list-view-menu`,'view menu');await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});}
  await nav('/p/UX/issue/UX-7');await shot(`${prefix}-issue-page`,'long title and multiple assignees');
 }
 await page.setViewportSize({width:1440,height:900});await nav('/p/UX/board');await page.evaluate(()=>localStorage.setItem('taskira.theme','light'));await page.reload({waitUntil:'networkidle'});
 for(const [width,height,label]of [[320,844,'narrow'],[768,1024,'tablet'],[3840,2160,'4k'],[720,450,'zoom200-css-equivalent']]){await page.setViewportSize({width,height});await nav('/p/UX/board');await shot(`light-${label}-board`);await nav('/p/UX/list');await shot(`light-${label}-list`);}
 writeFileSync(`${out}/capture-errors.json`,JSON.stringify(errors,null,2));writeFileSync(`${out}/browser-inventory.json`,JSON.stringify(inventory,null,2));console.log(JSON.stringify({shots:shots.length,errors:errors.length}));
}finally{await context.close();await browser.close();}
