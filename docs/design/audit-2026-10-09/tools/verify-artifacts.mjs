import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const root='D:/CodexScratch/Taskira-UI-Audit-20261009',out=root+'/docs/design/audit-2026-10-09';
const manifest=JSON.parse(fs.readFileSync(out+'/screenshots.json','utf8'));
for(const s of manifest)if(!fs.existsSync(out+'/'+s.file))throw new Error('Missing '+s.file);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const result={manifest:manifest.length,checks:[]};
try{
 const health=await context.request.get('http://localhost:3000/api/health');if(health.status()!==200)throw new Error('Health '+health.status());result.readiness=await health.json();
 await page.goto('http://localhost:3000/docs/design/audit-2026-10-09/index.html',{waitUntil:'networkidle'});
 if(await page.locator('figure').count()!==36)throw new Error('Gallery count');
 await page.locator('img').evaluateAll(async images=>{for(const image of images){image.loading='eager';await image.decode();}});
 result.checks.push({name:'all-screenshot-files-and-images',passed:true,count:36});
 await page.screenshot({path:out+'/evidence/album-desktop.png',animations:'disabled'});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.locator('#theme').selectOption('dark');await page.locator('#screen').selectOption('create');await page.locator('#device').selectOption('mobile');
  const count=await page.locator('figure').count();if(count!==1)throw new Error('Filter count');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Album overflow');
  const axe=await new AxeBuilder({page}).analyze();if(axe.violations.length)throw new Error(JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
  result.checks.push({name:'album-filters-layout-axe',viewport,passed:true,count,violations:0});
 }
 await page.screenshot({path:out+'/evidence/album-mobile.png',animations:'disabled'});
 const config=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
 const login=await context.request.post('http://localhost:3000/api/auth/login',{data:{username:'audit_admin',password:config.AUDIT_USER_PASSWORD}});if(login.status()!==200)throw new Error('Login '+login.status());
 await page.goto('http://localhost:3000/p/UX/board',{waitUntil:'networkidle'});await page.locator('[data-issue-id]').first().waitFor();const cards=await page.locator('[data-issue-id]').count();if(cards!==12)throw new Error('Expected restored12, found'+cards);result.checks.push({name:'stand-after-stop-start',passed:true,login:login.status(),cards});
 result.errors=errors;if(errors.length)throw new Error('Console errors '+JSON.stringify(errors));
 fs.writeFileSync(out+'/artifact-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,checks:result.checks.length,errors:errors.length,readiness:health.status()}));
}finally{await context.close();await browser.close();}