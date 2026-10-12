import {chromium} from '@playwright/test';
import fs from 'node:fs';
const root='D:/CodexScratch/Taskira-UI-Audit-20261009',out=root+'/docs/design/audit-2026-10-09';
const config=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'}),page=await context.newPage();
try{
 await page.goto('http://localhost:3000/',{waitUntil:'networkidle'});
 await page.getByLabel('Логин',{exact:true}).fill('audit_admin');
 await page.getByLabel('Пароль',{exact:true}).fill(config.AUDIT_USER_PASSWORD);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 const login=await response;if(login.status()!==200)throw new Error('UI login '+login.status());
 await page.getByLabel('Логин',{exact:true}).waitFor({state:'hidden'});
 await page.getByRole('heading').first().waitFor();await page.waitForTimeout(500);
 if((await page.locator('body').innerText()).includes('Неверный логин'))throw new Error('Login error visible');
 await page.screenshot({path:out+'/evidence/login-after-reset.png',animations:'disabled'});
 const statuses=[];
 for(const username of ['audit_admin','audit_manager','audit_employee','audit_viewer']){
  const r=await context.request.post('http://localhost:3000/api/auth/login',{data:{username,password:config.AUDIT_USER_PASSWORD}});
  statuses.push({username,status:r.status()});if(r.status()!==200)throw new Error('Role login '+username+' '+r.status());
 }
 fs.writeFileSync(out+'/login-verification.json',JSON.stringify({uiLogin:{username:'audit_admin',status:login.status(),formClosed:true},roleLogins:statuses,capturedAt:new Date().toISOString(),note:'Only isolated local audit credentials changed; no product code changed.'},null,2));
 console.log(JSON.stringify({uiLogin:login.status(),roleLogins:statuses}));
}finally{await context.close();await browser.close();}