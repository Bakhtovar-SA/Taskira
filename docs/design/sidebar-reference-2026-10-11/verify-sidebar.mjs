import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const root=process.cwd(),out=root+'/docs/design/sidebar-reference-2026-10-11';
const env=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch(),checks=[],errors=[];
try {
 for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
  await context.addInitScript(theme=>localStorage.setItem('taskira.theme',theme),theme);
  expect((await context.request.post('http://localhost:3000/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000/p/UX/board',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.sidebar-team-heading')).toHaveText(['Продуктовая команда','Разработка']);
  const sep=page.getByRole('separator',{name:'Изменить ширину панели'}),aside=page.locator('aside');
  const box=await sep.boundingBox();await page.mouse.move(box.x+4,box.y+60);await page.mouse.down();await page.mouse.move(box.x+68,box.y+60,{steps:5});
  const line=await sep.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow,width:getComputedStyle(el,'::after').width}));expect(line).toEqual({outline:'none',shadow:'none',width:'2px'});
  await page.screenshot({path:out+'/resize-line-'+theme+'.png',clip:{x:(await aside.boundingBox()).x+(await aside.boundingBox()).width-14,y:40,width:24,height:400}});
  await page.mouse.up();expect(await sep.evaluate(el=>getComputedStyle(el,'::after').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const resized=(await aside.boundingBox()).width;await page.reload({waitUntil:'networkidle'});expect((await aside.boundingBox()).width).toBe(resized);
  const b=await sep.boundingBox();await page.mouse.move(b.x+4,b.y+60);await page.mouse.down();await page.mouse.move(b.x-200,b.y+60,{steps:5});await page.mouse.up();await expect(page.locator('.sidebar-rail')).toBeVisible();
  await page.locator('[data-sidebar-toggle]').click();expect((await aside.boundingBox()).width).toBe(resized);
  await sep.focus();await page.keyboard.press('Enter');await page.mouse.move(600,600);
  for(const width of [1920,3440]) {
   await page.setViewportSize({width,height:width===3440?1440:1080});await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:out+'/implemented-'+theme+'-'+width+'.png'});
   await aside.screenshot({path:out+'/implemented-sidebar-'+theme+'-'+width+'.png'});
   await page.locator('.sidebar-teams').screenshot({path:out+'/implemented-hierarchy-'+theme+'-'+width+'.png'});
   const axe=await new AxeBuilder({page}).include('aside').analyze();expect(axe.violations).toEqual([]);
   checks.push({theme,width,sidebarWidth:(await aside.boundingBox()).width,route:'/p/UX/board',role:'admin',axeViolations:0});
  }
  await page.setViewportSize({width:390,height:844});await page.locator('.global-topbar').getByRole('button',{name:'Меню',exact:true}).click();await page.screenshot({path:out+'/implemented-drawer-'+theme+'-390.png'});await page.keyboard.press('Escape');
  await context.close();
 }
 expect(errors).toEqual([]);
 fs.writeFileSync(out+'/implemented-checks.json',JSON.stringify({date:new Date().toISOString(),baseSha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',workingTree:true,realApi:true,checks,pageErrors:errors,resizeSingleLine:true,releaseHidesLine:true,collapseRestoresWidth:true},null,2));
 console.log(JSON.stringify({captures:16,checks,pageErrors:errors}));
} finally {await browser.close();}
