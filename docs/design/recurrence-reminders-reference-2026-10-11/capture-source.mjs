import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const root=process.cwd(),base='http://localhost:3000',out=root+'/docs/design/recurrence-reminders-reference-2026-10-11';
const env=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('taskira.theme','graphite'));
 expect((await context.request.post(base+'/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
 const projects=await (await context.request.get(base+'/api/projects')).json(),project=projects.find(p=>p.key==='UX');
 const tasks=(await (await context.request.get(base+'/api/projects/'+project.id+'/issues?limit=50')).json()).items;
 const task=tasks.find(i=>i.key==='UX-11')??tasks[0];
 const config=await (await context.request.get(base+'/api/recurring/config')).json();
 const page=await context.newPage();await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort());
 await page.goto(base+'/p/UX/board?issue='+task.key);await page.locator('.issue-detail').waitFor();await page.evaluate(()=>document.fonts.ready);
 const detail=await page.locator('.issue-detail').evaluate(el=>el.outerHTML);
 await page.locator('.issue-toolbar-actions').getByRole('button',{name:'Действия',exact:true}).click();
 const menu=await page.getByRole('menu',{name:'Действия',exact:true}).evaluate(el=>el.innerHTML);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.keyboard.press('c');await page.locator('#create-issue-title').waitFor();
 await page.locator('#create-issue-title').fill(task.title);await page.locator('#create-issue-description').fill('Каждую неделю фиксируем результаты проверки интерфейса и следующие шаги.');
 await page.getByRole('button',{name:/^Срок:/}).click();await page.getByRole('textbox',{name:'Срок',exact:true}).fill('16.10.2026');await page.getByRole('textbox',{name:'Срок',exact:true}).press('Enter');
 const create=await page.locator('.ds-dialog').filter({has:page.locator('.create-issue-form')}).evaluate(el=>{
  const clone=el.cloneNode(true),originals=el.querySelectorAll('input,textarea');
  clone.querySelectorAll('input,textarea').forEach((input,index)=>{if(input.tagName==='TEXTAREA')input.textContent=originals[index].value;else input.setAttribute('value',originals[index].value)});
  return clone.innerHTML;
 });
 const styles=await page.evaluate(()=>[...document.styleSheets].map(sheet=>{try{return[...sheet.cssRules].map(r=>r.cssText).join('\n')}catch{return''}}).join('\n'));
 const appearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,skin:document.documentElement.dataset.skin,brandPalette:document.documentElement.dataset.brandPalette,brandHue:getComputedStyle(document.documentElement).getPropertyValue('--brand-h').trim()}));
 fs.writeFileSync(out+'/source.json',JSON.stringify({detail,create,menu,styles,appearance,task:{key:task.key,title:task.title,dueDate:task.dueDate},project:{key:project.key,name:project.name},recurringConfig:config,sourceSha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',capturedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({captured:true,task:task.key,recurringConfig:config,apiWrites:false}));
}finally{await browser.close()}
