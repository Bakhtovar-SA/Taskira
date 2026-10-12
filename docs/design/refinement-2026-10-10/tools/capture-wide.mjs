import {chromium, expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const root=process.cwd(), out=root+'/docs/design/refinement-2026-10-10';
const env=Object.fromEntries(readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch(), manifest=JSON.parse(readFileSync(out+'/screenshots.json','utf8')).filter(x=>!(['wide','ultrawide'].includes(x.size)&&x.stage==='polish')), errors=[];
for(const theme of ['light','dark'])for(const [size,viewport] of [['wide',{width:1920,height:1080}],['ultrawide',{width:3440,height:1440}]]) {
 const context=await browser.newContext({viewport,locale:'ru-RU',reducedMotion:'reduce'});
 await context.addInitScript(theme=>{localStorage.setItem('taskira.theme',theme);localStorage.setItem('taskira.lang','ru');},theme);
 const login=await context.request.post('http://localhost:3000/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}});expect(login.status()).toBe(200);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [screen,route,ready] of [['board','/p/UX/board','.board-card-open'],['issue-panel','/p/UX/board?issue=UX-7','.issue-title'],['list','/p/UX/list?group=status','.list-row']]) {
  await page.goto('http://localhost:3000'+route,{waitUntil:'networkidle'});await page.locator(ready).first().waitFor();await page.evaluate(()=>document.fonts.ready);
  const file=`screenshots/${theme}-${size}-${screen}-polish.png`;await page.screenshot({path:out+'/'+file,animations:'disabled',caret:'hide'});
  manifest.push({file,theme,size,screen,route,role:'admin',viewport,stage:'polish',sha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',workingTree:true,capturedAt:new Date().toISOString()});
 }
 await context.close();
}
writeFileSync(out+'/screenshots.json',JSON.stringify(manifest,null,2));writeFileSync(out+'/capture-errors.json',JSON.stringify(errors,null,2));await browser.close();console.log(JSON.stringify({screens:manifest.length,errors}));
