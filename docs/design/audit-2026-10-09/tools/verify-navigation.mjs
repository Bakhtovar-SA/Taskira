import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root='D:/CodexScratch/Taskira-UI-Audit-20261009';
const output=`${root}/docs/design/audit-2026-10-09/verification-navigation`;
const env=Object.fromEntries(readFileSync(`${root}/server/.env.audit`,'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const url=process.env.TASKIRA_CHECK_URL || 'http://localhost:3112';
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});const page=await context.newPage();const results=[];const errors=[];
page.on('pageerror', e=>errors.push({message:e.message,stack:e.stack}));
function check(name, condition, details){results.push({name,pass:!!condition,details});if(!condition)throw new Error(`${name}: ${JSON.stringify(details)}`);}
async function nav(route){await page.goto(url+route,{waitUntil:'networkidle'});await page.locator('.board-view, .home-view, .settings-layout').first().waitFor();}
mkdirSync(output,{recursive:true});
try {
 const login=await context.request.post(url+'/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}});check('real API login', login.status()===200,{status:login.status()});
 await nav('/p/UX/board');await page.locator('.board-card-open').first().waitFor();
 check('board h1',await page.locator('.board-view h1').count()===1,{text:await page.locator('.board-view h1').innerText()});
 check('card has native action',await page.locator('.board-card-open').first().evaluate(el=>el.tagName==='BUTTON'),{});
 check('no redundant article tab stop',await page.locator('.board-card[data-issue-id]').first().getAttribute('tabindex')===null,{});
 check('no no-op grouping',await page.getByRole('button',{name:'Группировка: нет',exact:true}).count()===0,{});
 await page.getByRole('button',{name:'Главная',exact:true}).click();await page.locator('.home-view').waitFor();
 const project=page.locator('.sidebar-project-row').filter({hasText:'Рабочие процессы'});
 await project.locator('.sidebar-project-link').click();await page.locator('.board-view').waitFor();check('same project reopens from home',new URL(page.url()).pathname==='/p/UX/board',{url:page.url()});
 await project.hover();check('project settings revealed on hover',await project.locator('.sidebar-project-settings').evaluate(el=>getComputedStyle(el).opacity==='1'),{});
 await project.locator('.sidebar-project-settings').click();await page.locator('.settings-layout').waitFor();check('direct project settings',new URL(page.url()).pathname.includes('/settings'),{url:page.url()});
 const scopeCount=await page.locator('.settings-nav-home').count();check('three distinct settings scopes',scopeCount===3,{scopeCount});await page.screenshot({path:output+'/settings-desktop.png'});
 const initialToggle=await page.locator('[data-sidebar-toggle]').boundingBox();await page.locator('[data-sidebar-toggle]').click();await page.locator('.sidebar-rail').waitFor();const railToggle=await page.locator('[data-sidebar-toggle]').boundingBox();check('toggle stays in bottom dock',Math.abs(initialToggle.y-railToggle.y)<4,{initialY:initialToggle.y,railY:railToggle.y});await page.locator('[data-sidebar-toggle]').click();await page.locator('.sidebar-project-row').first().waitFor();
 await nav('/p/UX/board');const card=page.locator('.board-card[data-issue-id]').first(),open=card.locator('.board-card-open');
 await open.click();await page.locator('dialog[open] .issue-title').waitFor();await page.locator('dialog[open]').getByRole('button',{name:'Закрыть',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'hidden'});
 const pointerFocus=await card.evaluate(el=>({outline:getComputedStyle(el).outlineWidth,input:el.closest('.board-view').getAttribute('data-board-input')}));check('mouse close has no card focus glow',pointerFocus.outline==='0px'&&pointerFocus.input==='pointer',pointerFocus);
 await page.keyboard.press('Tab');await open.focus();const keyboardFocus=await card.evaluate(el=>({outline:getComputedStyle(el).outlineWidth,input:el.closest('.board-view').getAttribute('data-board-input')}));check('keyboard focus remains visible',keyboardFocus.outline==='2px'&&keyboardFocus.input==='keyboard',keyboardFocus);
 await page.keyboard.press('Enter');await page.locator('dialog[open] .issue-title').waitFor();await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});check('keyboard close returns focus',await open.evaluate(el=>el===document.activeElement),{});
 await page.setViewportSize({width:390,height:844});await nav('/p/UX/board');const opener=page.getByRole('button',{name:'Меню',exact:true}).first();await opener.click();const drawer=page.getByRole('dialog',{name:'Меню',exact:true});await drawer.waitFor();
 check('drawer modal semantics',await drawer.getAttribute('aria-modal')==='true',{});
 for(let i=0;i<35;i++){await page.keyboard.press('Tab');check(`drawer contains tab ${i}`,await drawer.evaluate(el=>el.contains(document.activeElement)),{});}
 await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});check('drawer returns opener focus',await opener.evaluate(el=>el===document.activeElement),{});check('main no longer inert',await page.locator('main').evaluate(el=>!el.closest('[inert]')),{});
 await page.goto(url+'/settings/profile',{waitUntil:'networkidle'});await page.locator('.settings-layout').waitFor();check('mobile settings has scope switches',await page.locator('.settings-home-switch').isVisible(),{});await page.screenshot({path:output+'/settings-mobile.png'});
 check('no runtime page errors',errors.length===0,{errors});
} catch(error){results.push({name:'execution',pass:false,details:error.message});console.error(error.message);await page.screenshot({path:output+'/failure.png'}).catch(()=>{});writeFileSync(output+'/failure-text.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}finally{writeFileSync(output+'/checks.json',JSON.stringify({results,errors},null,2));await context.close();await browser.close();console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length}));}
