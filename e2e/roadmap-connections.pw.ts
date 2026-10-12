import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {roadmapFixture} from './roadmap-fixture';
async function setup(page:import('@playwright/test').Page){
 const rm=await roadmapFixture(page,'dark'),writes:{method:string;path:string;body:unknown}[]=[];let fail=false;
 await page.route('**/api/projects/*/dependencies**',async route=>{const req=route.request(),path=new URL(req.url()).pathname,method=req.method();writes.push({method,path,body:method==='POST'?req.postDataJSON():null});if(fail)return route.fulfill({status:409,json:{error:{code:'DEPENDENCY_CYCLE',reason:'Получится цикл'}}});const id=path.split('/')[3];if(method==='POST'){const source=req.postDataJSON().sourceProjectId;rm.dependencies.push({sourceId:source,dependentId:id});return route.fulfill({status:201,json:{sourceId:source,dependentId:id}})}rm.dependencies=rm.dependencies.filter(d=>!(d.dependentId===id&&d.sourceId===path.split('/').at(-1)));return route.fulfill({status:204});});
 await page.goto('/roadmap');await expect(page.locator('.roadmap-project-row')).toHaveCount(5);return{rm,writes,setFail:()=>fail=true};
}
test('roadmap connections: keyboard add/remove and server failure',async({page})=>{
 const f=await setup(page),handle=page.getByRole('button',{name:'Связать проекты после «Интеграция сервисов»',exact:true});await handle.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Корпоративная платформа',exact:true}).click();await expect.poll(()=>f.rm.dependencies.some(d=>d.sourceId==='p3'&&d.dependentId==='p1')).toBe(true);await expect(page.locator('.roadmap-dependencies > path')).toHaveCount(4);
 expect(f.writes[0]).toEqual({method:'POST',path:'/api/projects/p1/dependencies',body:{sourceProjectId:'p3'}});
 await handle.focus();await page.keyboard.press('Enter');await expect(page.getByRole('menuitem',{name:'Веб-портал',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Юридические вопросы и согласование договоров',exact:true})).toHaveCount(0);await page.getByRole('menuitem',{name:'Корпоративная платформа',exact:true}).click();await expect(page.locator('.roadmap-dependencies > path')).toHaveCount(3);
 f.setFail();await handle.click();await page.getByRole('menuitem',{name:'Корпоративная платформа',exact:true}).click();await expect(page.getByText(/Получится цикл/).first()).toBeVisible();await expect(page.locator('.roadmap-dependencies > path')).toHaveCount(3);
});
for(const width of [1280,1920,3440])test(`roadmap connections: pointer preview, cancellation and persisted add at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===3440?1440:1080});
 const f=await setup(page),source=page.locator('.roadmap-timeline-row[data-project-id=p1]'),target=page.locator('.roadmap-timeline-row[data-project-id=p3]');
 // The initial horizontal scroll can place the source outside the viewport on CI.
 await source.locator('.roadmap-connect, .roadmap-return').first().waitFor({state:'attached'});
 if(await source.locator('.roadmap-return').count()) await source.locator('.roadmap-return').click();
 // Hover the handle itself: centering the month-wide row can scroll its source off-screen.
 await expect(source.locator('.roadmap-connect')).toBeVisible();
 await source.locator('.roadmap-connect').hover();let a=(await source.locator('.roadmap-connect').boundingBox())!,b=(await target.locator('.roadmap-bar').boundingBox())!;
 await expect(source.locator('.roadmap-connect')).toHaveCSS('cursor','default');
 const pane=(await page.locator('.roadmap-timeline').boundingBox())!,rows=(await page.locator('.roadmap-timeline > div > .roadmap-rows').boundingBox())!,emptyY=Math.min(pane.y+pane.height-24,rows.y+rows.height+96),emptyX=a.x+a.width/2+120;
 expect(emptyY).toBeGreaterThan(rows.y+rows.height+12);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(emptyX,emptyY,{steps:12});
 await expect(page.locator('.roadmap-connection-preview')).toBeVisible();await expect(target.locator('.roadmap-bar')).toHaveCSS('cursor','default');
 const layer=(await page.locator('.roadmap-dependencies').boundingBox())!,line=await page.locator('.roadmap-connection-preview').evaluate(el=>el.getBoundingClientRect().toJSON());
 expect(layer.y+layer.height).toBeGreaterThan(emptyY+1);expect(Math.abs(line.bottom-emptyY)).toBeLessThan(.1);
 await page.screenshot({path:`docs/design/timeline-roadmap-2026-10-11/dependency-empty-area-${width}.png`,clip:{x:Math.floor(pane.x),y:Math.floor(pane.y),width:Math.min(720,Math.floor(pane.width)),height:Math.ceil(emptyY-pane.y+24)}});
 await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.roadmap-connection-preview')).toHaveCount(0);expect(f.writes).toHaveLength(0);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+8,b.y+b.height/2,{steps:12});await expect(page.locator('.roadmap-connection-preview')).toBeVisible();await expect(page.locator('.roadmap-dependencies > rect')).toHaveCount(1);const highlight=(await page.locator('.roadmap-dependencies > rect').evaluate(el=>el.getBoundingClientRect().toJSON())),track=(await target.locator('.roadmap-bar-track').boundingBox())!;expect(Math.abs(highlight.x-track.x)).toBeLessThan(.1);expect(Math.abs(highlight.y-track.y)).toBeLessThan(.1);expect(Math.abs(highlight.width-track.width)).toBeLessThan(.1);await page.keyboard.press('Escape');await page.mouse.up();expect(f.writes).toHaveLength(0);
 await source.locator('.roadmap-connect').hover();a=(await source.locator('.roadmap-connect').boundingBox())!;await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+8,b.y+b.height/2,{steps:12});await page.screenshot({path:`docs/design/timeline-roadmap-2026-10-11/dependency-drag-${width}.png`});await page.mouse.up();await expect(page.locator('.roadmap-dependencies > path')).toHaveCount(4);expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toEqual({sourceProjectId:'p1'});
});
test('roadmap return: hidden bar returns without navigating and joins are continuous',async({page})=>{
 await setup(page);const pane=page.locator('.roadmap-timeline');await pane.evaluate(el=>el.scrollLeft=el.scrollWidth);const back=page.getByRole('button',{name:'Вернуться к проекту «Корпоративная платформа»',exact:true});await expect(back).toBeVisible();await page.screenshot({path:'docs/design/timeline-roadmap-2026-10-11/return-to-project.png'});await back.click();await expect.poll(()=>page.locator('.roadmap-timeline-row[data-project-id=p1] .roadmap-bar').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.roadmap-timeline')!.getBoundingClientRect();return r.right>p.left&&r.left<p.right})).toBe(true);await expect(page).toHaveURL(/\/roadmap$/);
 const metrics=await page.locator('.roadmap-timeline-row[data-project-id=p1] .roadmap-bar-track').evaluate(el=>{const rest=el.querySelector('.roadmap-bar-remaining')!,done=el.querySelector('.roadmap-bar-done')!,a=el.getBoundingClientRect(),b=rest.getBoundingClientRect();return{track:a.width,rest:b.width,corner:getComputedStyle(done).borderTopRightRadius}});expect(metrics.rest).toBeCloseTo(metrics.track,2);expect(metrics.corner).toBe('0px');
});
for(const width of [1920,3440,390,320])test(`roadmap profile ${width}: zoom, fitting and accessibility`,async({page})=>{
 await page.setViewportSize({width,height:width===3440?1440:width>1000?1080:844});await setup(page);await expect(page.locator('.roadmap-view')).toHaveCSS('zoom',width===1920?'0.9':'1');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const r=(await page.locator('.roadmap-view').boundingBox())!;expect(r.y+r.height).toBeLessThanOrEqual(width===3440?1441:width>1000?1081:845);
 const a=await new AxeBuilder({page}).include('.roadmap-view').analyze();expect(a.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);await page.screenshot({path:`docs/design/timeline-roadmap-2026-10-11/roadmap-${width}.png`});
});
