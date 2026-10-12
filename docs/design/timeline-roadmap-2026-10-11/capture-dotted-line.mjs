import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const root=process.cwd(),out=root+'/docs/design/timeline-roadmap-2026-10-11',base='http://localhost:3000';
const env=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('taskira.theme','graphite'));
 expect((await context.request.post(base+'/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
 const checks=[];
 for(const [width,height]of [[1920,1080],[3440,1440]]){
  await page.setViewportSize({width,height});await page.goto(base+'/roadmap');await expect(page.locator('.roadmap-project-row')).toHaveCount(2);await page.evaluate(()=>document.fonts.ready);
  const handle=page.locator('.roadmap-connect').first();await handle.focus();
  await expect(handle).toHaveCSS('cursor','default');
  const a=await handle.boundingBox(),pane=await page.locator('.roadmap-timeline').boundingBox(),rows=await page.locator('.roadmap-timeline > div > .roadmap-rows').boundingBox();
  const px=Math.min(a.x+a.width/2+260,pane.x+pane.width-48),py=Math.min(rows.y+rows.height+120,pane.y+pane.height-36);
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(px,py,{steps:12});await expect(page.locator('.roadmap-connection-preview')).toBeVisible();
  const svg=await page.locator('.roadmap-dependencies').boundingBox(),path=await page.locator('.roadmap-connection-preview').evaluate(e=>e.getBoundingClientRect().toJSON());
  expect(svg.y+svg.height).toBeGreaterThan(py+1);expect(Math.abs(path.bottom-py)).toBeLessThan(.1);
  await page.screenshot({path:out+'/implemented-dotted-line-'+width+'.png',clip:{x:Math.floor(pane.x),y:Math.floor(pane.y),width:Math.min(720,Math.floor(pane.width)),height:Math.ceil(py-pane.y+24)}});
  await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.roadmap-connection-preview')).toHaveCount(0);
  checks.push({width,svgCoversEmptyArea:true,endpointAtPointer:true,cursor:'default'});
 }
 expect(errors).toEqual([]);fs.writeFileSync(out+'/dotted-line-checks.json',JSON.stringify({checks,pageErrors:errors,apiWrites:false},null,2));console.log(JSON.stringify({checks,pageErrors:errors,apiWrites:false}));
}finally{await browser.close()}
