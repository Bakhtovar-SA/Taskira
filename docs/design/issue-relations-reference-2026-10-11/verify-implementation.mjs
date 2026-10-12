import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const root=process.cwd(),base='http://localhost:3000',out=root+'/docs/design/issue-relations-reference-2026-10-11';
const env=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('taskira.theme','dark'));
 expect((await context.request.post(base+'/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/p/UX/board?issue=UX-3');await page.locator('.issue-detail').waitFor();
 const card=page.getByRole('dialog').filter({has:page.locator('.issue-detail')});
 await expect(card.getByText('Родительская задача',{exact:true})).toHaveCount(0);
 await expect(card.getByText('Связи',{exact:true})).toHaveCount(0);
 await card.screenshot({path:out+'/implemented-plain.png'});
 await card.getByRole('button',{name:'Действия',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'Сделать подзадачей',exact:true})).toBeVisible();
 await page.screenshot({path:out+'/implemented-actions-desktop.png'});
 await page.getByRole('menuitem',{name:'Сделать подзадачей',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'Сделать подзадачей',exact:true});
 await expect(parent).toBeVisible();await expect(parent.getByRole('combobox',{name:'Поиск родительской задачи'})).toBeFocused();
 await parent.screenshot({path:out+'/implemented-parent-picker.png'});
 await page.keyboard.press('Escape');await expect(parent).toHaveCount(0);await expect(card).toBeVisible();
 await expect(card.getByRole('button',{name:'Действия',exact:true})).toBeFocused();
 await card.getByRole('button',{name:'Действия',exact:true}).click();await page.getByRole('menuitem',{name:'Добавить связь',exact:true}).click();
 const link=page.getByRole('dialog',{name:'Добавить связь',exact:true});await expect(link).toBeVisible();await expect(link.getByRole('button',{name:'связана с',exact:true})).toBeFocused();
 await link.screenshot({path:out+'/implemented-link-picker.png'});await page.keyboard.press('Escape');
 expect(errors).toEqual([]);console.log(JSON.stringify({smoke:'pass',screenshots:4,pageErrors:errors}));
}finally{await browser.close()}
