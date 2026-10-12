import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const root=process.cwd(),base='http://localhost:3000',out=root+'/docs/design/issue-relations-reference-2026-10-11';
const env=Object.fromEntries(fs.readFileSync(root+'/server/.env.audit','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const browser=await chromium.launch(),created=[],checks=[],screenshots=[],axe=[],errors=[];
let context,pid;
try{
 context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('taskira.theme','dark'));
 expect((await context.request.post(base+'/api/auth/login',{data:{username:'audit_admin',password:env.AUDIT_USER_PASSWORD}})).status()).toBe(200);
 const projects=await (await context.request.get(base+'/api/projects')).json();pid=projects.find(p=>p.key==='UX').id;
 const api=base+'/api/projects/'+pid+'/issues';
 async function create(title){const res=await context.request.post(api,{data:{title,typeId:'task',priorityId:'medium',epicId:null,complexity:null,description:'Временная задача для проверки интерфейса. После проверки удаляется.'}});expect(res.status()).toBe(201);const i=await res.json();created.push(i);return i;}
 const parent=await create('План релиза · проверка иерархии'),child=await create('Подготовить материалы к релизу · проверка интерфейса'),target=await create('Согласовать требования · проверка связи');
 const detail=async()=>await (await context.request.get(api+'/'+child.id)).json();
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const card=page.getByRole('dialog').filter({has:page.locator('.issue-detail')});
 const go=async()=>{await page.goto(base+'/p/UX/board?issue='+child.key);await expect(card).toBeVisible();};await go();
 const action=async name=>{await card.getByRole('button',{name:'Действия',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
 const pick=async(label,key)=>{const search=page.getByRole('combobox',{name:label,exact:true});await search.fill(key);await page.getByRole('option',{name:new RegExp(key+'\\b')}).click();};
 await action('Сделать подзадачей');await pick('Поиск родительской задачи',parent.key);await expect(card.locator('.issue-parent-link')).toContainText(parent.key);expect((await detail()).parentId).toBe(parent.id);checks.push('parent assignment via UI and actual API');
 await page.reload();await expect(card.locator('.issue-parent-link')).toContainText(parent.key);checks.push('parent persisted after reload');
 for(const type of ['relates','blocks','blocked_by']){
  await action('Добавить связь');const name={relates:'связана с',blocks:'блокирует',blocked_by:'заблокирована'}[type];await page.getByRole('dialog',{name:'Добавить связь',exact:true}).getByRole('button',{name,exact:true}).click();await pick('Добавить связь',target.key);
  await expect(card.locator('.issue-linked-task')).toContainText(name);expect((await detail()).links[0].dir).toBe(type);await page.reload();await expect(card.locator('.issue-linked-task')).toContainText(target.key);checks.push(type+' UI, API and reload');
  if(type==='blocked_by'){
   const inverse=await (await context.request.get(api+'/'+target.id)).json();expect(inverse.links[0].dir).toBe('blocks');checks.push('inverse blocked_by/blocks');
   const status=(await detail()).statusId;expect(status).toBe(child.statusId);checks.push('link does not change workflow status');
   for(const [name,width,height,theme] of [['desktop',1920,1080,'dark'],['ultrawide',3440,1440,'dark'],['mobile',390,844,'dark'],['mobile-light',390,844,'light']]){
    await page.setViewportSize({width,height});await page.evaluate(theme=>localStorage.setItem('taskira.theme',theme),theme);await page.reload();await expect(card).toBeVisible();
    if(width<900)await card.getByRole('button',{name:'Остальные свойства',exact:true}).click();await expect(card.locator('.issue-linked-task')).toBeVisible();
    expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const shot='implemented-relations-'+name+'.png';await page.screenshot({path:out+'/'+shot});screenshots.push({file:shot,route:'/p/UX/board?issue='+child.key,viewport:{width,height},theme,role:'admin',temporaryTestData:true});
    const violations=(await new AxeBuilder({page}).include('.issue-detail').analyze()).violations;expect(violations).toEqual([]);axe.push({viewport:{width,height},theme,violations:violations.length});
   }
   await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>localStorage.setItem('taskira.theme','dark'));await page.reload();
   await action('Изменить родителя');await page.keyboard.press('Escape');await expect(card.getByRole('button',{name:'Действия',exact:true})).toBeFocused();checks.push('Escape preserves card and returns focus');
   await card.getByRole('button',{name:'Действия',exact:true}).click();await page.getByRole('menu',{name:'Действия',exact:true}).screenshot({path:out+'/implemented-actions-menu.png'});await page.keyboard.press('Escape');
  }
  await card.locator('.issue-linked-task').getByRole('button').filter({hasText:target.key}).click();await expect(page.locator('[data-issue-details="'+target.id+'"]')).toBeVisible();await go();checks.push(type+' linked task navigation');
  await card.getByRole('button',{name:'Убрать связь: '+target.key,exact:true}).click();await expect(card.locator('.issue-linked-task')).toHaveCount(0);expect((await detail()).links).toHaveLength(0);checks.push(type+' removal hides empty field');
 }
 const cycle=await context.request.patch(api+'/'+parent.id,{data:{parentId:child.id}});expect([400,409,422]).toContain(cycle.status());checks.push('actual API rejects invalid parent nesting');
 await action('Изменить родителя');await pick('Поиск родительской задачи',target.key);await expect(card.locator('.issue-parent-link')).toContainText(target.key);expect((await detail()).parentId).toBe(target.id);checks.push('change parent');
 await action('Изменить родителя');await page.getByRole('button',{name:'Сделать самостоятельной',exact:true}).click();await expect(card.locator('.issue-parent-link')).toHaveCount(0);await page.reload();await expect(card.locator('.issue-parent-link')).toHaveCount(0);expect((await detail()).parentId).toBeNull();checks.push('detach parent and reload');
 expect(errors).toEqual([]);
}finally{
 if(context&&pid)for(const issue of [...created].reverse()){const res=await context.request.delete(base+'/api/projects/'+pid+'/issues/'+issue.id);expect(res.ok()).toBe(true);}
 await browser.close();
 fs.writeFileSync(out+'/real-api-checks.json',JSON.stringify({date:new Date().toISOString(),baseSha:'da85515e04f6f5e07baa39cee4bbbdb3a9f95140',workingTree:true,checks,screenshots,axe,pageErrors:errors,temporaryTasksCreated:created.length,temporaryTasksDeleted:created.length},null,2));
}
console.log(JSON.stringify({checks:checks.length,axeCaptures:axe.length,pageErrors:errors.length,temporaryTasksRemoved:created.length,screenshots:screenshots.length}));
