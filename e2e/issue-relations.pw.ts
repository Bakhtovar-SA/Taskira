import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {boardFixture} from './board-fixture';
import {loadMotion, settle} from './motion-helpers';

async function fixture(page:Page, opts:{role?:string;parent?:boolean;children?:boolean;linked?:boolean;theme?:string;error?:boolean}={}) {
 const {issues,project,users,statuses}=await boardFixture(page,opts.theme??'dark');
 users[0].globalRole='member';
 const detail:any={...issues[0],attachments:[],links:[],checklist:[],customFieldValues:[],collaboratorIds:[],watch:{watching:false,watchers:0},subtasksSummary:{total:opts.children?1:0,done:0},parentId:opts.parent?'i2':null};
 const related=(id:string)=>{const i=issues.find(i=>i.id===id)!;return {id:i.id,key:i.key,title:i.title,statusCategory:statuses.find(s=>s.id===i.statusId)!.category};};
 if(opts.linked)detail.links=[{id:'link1',dir:'blocks',issue:related('i3')}];
 const writes:any[]=[];
 const childItems:any[]=opts.children?[{...issues[1],parentId:'i1'}]:[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
  if(path==='/api/projects/p1')return route.fulfill({json:{project,users,members:users.map(u=>({userId:u.id,role:opts.role??'admin'})),workflow:{statuses,transitions:[]},issueTemplates:[],customFields:[],sprints:[]}});
  if(path==='/api/auth/me')return route.fulfill({json:{...users[0],globalRole:'member',onboarding:{hidden:true}}});
  if(path==='/api/projects/p1/issues'&&url.searchParams.has('parentId'))return route.fulfill({json:{items:childItems,hasMore:false,nextCursor:null}});
  if(path==='/api/projects/p1/issues'&&method==='POST'){const body=route.request().postDataJSON();const child={...issues[2],...body,id:'child-new',key:'CORP-NEW'};childItems.push(child);detail.subtasksSummary.total++;writes.push({path,method,body});return route.fulfill({json:child});}
  if(path==='/api/issues/resolve')return route.fulfill({json:{projectId:'p1',id:'i1',projectKey:'CORP'}});
  if(path.match(/\/issues\/[^/]+\/(comments|activity|collaborators)$/)&&method==='GET')return route.fulfill({json:[]});
  const match=path.match(/^\/api\/projects\/p1\/issues\/([^/]+)$/);
  if(match&&method==='GET'&&(match[1]==='epic1'||issues.some(i=>i.id===match[1])))return route.fulfill({json:match[1]==='i1'?detail:{...(match[1]==='epic1'?{...issues[0],id:'epic1',key:'CORP-E1',epicId:null,title:'Корпоративная платформа'}:issues.find(i=>i.id===match[1])),links:[],attachments:[],checklist:[]}});
  if(path.startsWith('/api/projects/p1/issues/i1')&&method!=='GET'){
   const body=method==='DELETE'?null:route.request().postDataJSON();writes.push({path,method,body});
   if(opts.error)return route.fulfill({status:409,json:{error:{code:'CONFLICT',reason:method==='PATCH'?'Родитель недоступен':'Связь не сохранена'}}});
   if(method==='PATCH'){Object.assign(detail,body);return route.fulfill({json:detail});}
   if(path.endsWith('/links')&&method==='POST'){const id='link'+(detail.links.length+1);detail.links.push({id,dir:body.type,issue:related(body.linkedIssueId)});return route.fulfill({json:{id,links:detail.links}});}
   if(path.includes('/links/')&&method==='DELETE'){detail.links=[];return route.fulfill({json:{links:[]}});}
  }
  return route.fallback();
 });
 await page.goto('/p/CORP/board?issue=CORP-1');
 await expect(page.locator('.issue-detail')).toBeVisible();
 return {detail,writes,card:page.getByRole('dialog').filter({has:page.locator('.issue-detail')})};
}
async function action(page:Page,name:string){await page.locator('.issue-toolbar-actions').getByRole('button',{name:'Действия',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();}

 test('parent: assign, change, reload and detach through Actions',async({page})=>{
 const {card,writes}=await fixture(page);
 await expect(card.getByText('Родительская задача',{exact:true})).toHaveCount(0);await expect(card.getByText('Связи',{exact:true})).toHaveCount(0);
 await action(page,'Сделать подзадачей');await page.getByRole('option',{name:/CORP-2/}).click();
 await expect(card.locator('.issue-parent-link')).toContainText('CORP-2');expect(writes.at(-1).body).toEqual({parentId:'i2'});
 await page.reload();await expect(page.locator('.issue-parent-link')).toContainText('CORP-2');
 await expect(card.locator('.issue-tile').filter({hasText:'Подзадачи'}).getByRole('button',{name:/Добавить/})).toHaveCount(0);
 await action(page,'Изменить родителя');await page.getByRole('option',{name:/CORP-3/}).click();await expect(page.locator('.issue-parent-link')).toContainText('CORP-3');
 await action(page,'Изменить родителя');await page.getByRole('button',{name:'Сделать самостоятельной',exact:true}).click();await expect(page.locator('.issue-parent-link')).toHaveCount(0);
 expect(writes.at(-1).body).toEqual({parentId:null});
 });
for(const type of ['relates','blocks','blocked_by'])test(`links: ${type} persists and hides after removal`,async({page})=>{
 const {card,writes}=await fixture(page);
 await action(page,'Добавить связь');const picker=page.getByRole('dialog',{name:'Добавить связь',exact:true});
 const names:any={relates:'связана с',blocks:'блокирует',blocked_by:'заблокирована'};
 await picker.getByRole('button',{name:names[type],exact:true}).click();await picker.getByRole('option',{name:/CORP-3/}).click();
 await expect(card.getByText('Связи',{exact:true})).toBeVisible();expect(writes.at(-1).body).toEqual({linkedIssueId:'i3',type});
 await page.reload();await expect(card.locator('.issue-linked-task')).toContainText(names[type]);
 await card.getByRole('button',{name:'Убрать связь: CORP-3',exact:true}).click();await expect(card.getByText('Связи',{exact:true})).toHaveCount(0);
 expect(writes.at(-1).method).toBe('DELETE');await page.reload();await expect(card.locator('.issue-linked-task')).toHaveCount(0);
 });
test('viewer sees parent and links while relationship edits are absent',async({page})=>{
 const {card,writes}=await fixture(page,{role:'viewer',parent:true,linked:true});
 await expect(card.locator('.issue-parent-link')).toContainText('CORP-2');await expect(card.locator('.issue-linked-task')).toContainText('CORP-3');
 await card.getByRole('button',{name:'Действия',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Изменить родителя',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Добавить связь',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(card.getByRole('button',{name:'Убрать связь: CORP-3',exact:true})).toHaveCount(0);expect(writes).toEqual([]);
});
test('task with children cannot become a subtask; direction remains',async({page})=>{
 const {card}=await fixture(page,{children:true});await expect(card.getByText('Направление',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Действия',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Сделать подзадачей',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Добавить связь',exact:true})).toBeVisible();
});
test('Escape and click outside close only the picker and preserve keyboard focus',async({page})=>{
 const {card,writes}=await fixture(page);await action(page,'Сделать подзадачей');
 const picker=page.getByRole('dialog',{name:'Сделать подзадачей',exact:true});await expect(picker.getByRole('combobox')).toBeFocused();
 await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);await expect(card).toBeVisible();await expect(card.getByRole('button',{name:'Действия',exact:true})).toBeFocused();
 await action(page,'Добавить связь');await card.locator('.issue-title').click();await expect(page.getByRole('dialog',{name:'Добавить связь',exact:true})).toHaveCount(0);await expect(card).toBeVisible();expect(writes).toEqual([]);
});
for(const theme of ['dark','light'])test(`mobile ${theme}: parent title and links fit; picker axe`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const {card}=await fixture(page,{parent:true,linked:true,theme});
 await expect(card.locator('.issue-parent-link')).toContainText('CORP-2');await card.getByRole('button',{name:'Остальные свойства',exact:true}).click();await expect(card.locator('.issue-linked-task')).toBeVisible();
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await action(page,'Добавить связь');const picker=page.getByRole('dialog',{name:'Добавить связь',exact:true});const box=(await picker.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);
 const violations=(await new AxeBuilder({page}).include('.issue-relation-picker').analyze()).violations;expect(violations).toEqual([]);
});
test('failed relationship mutation keeps existing issue state and reports error',async({page})=>{
 const {card}=await fixture(page,{error:true});await action(page,'Добавить связь');await page.getByRole('option',{name:/CORP-3/}).click();
 await expect(page.locator('[data-toast-id]').filter({hasText:'Связь не сохранена'})).toBeVisible();await expect(card.locator('.issue-linked-task')).toHaveCount(0);
 await action(page,'Сделать подзадачей');await page.getByRole('option',{name:/CORP-2/}).click();await expect(page.locator('[data-toast-id]').filter({hasText:'Родитель недоступен'})).toBeVisible();await expect(card.locator('.issue-parent-link')).toHaveCount(0);
});

for (const mode of ['normal', 'system', 'personal'] as const) {
 test('D-02: only appended relations enter (' + mode + ')', async ({page}) => {
  await page.emulateMedia({reducedMotion:mode==='system'?'reduce':'no-preference'});
  await page.addInitScript(personal => {
   if(personal)localStorage.setItem('taskira.reduceMotion','1');
   const calls:string[]=[];(window as any).__relationEnters=calls;
   const animate=HTMLElement.prototype.animate;
   HTMLElement.prototype.animate=function(...args:Parameters<typeof animate>){
    // Motion mini creates one WAAPI animation per property: count transform entries, not opacity too.
    if(this.matches('.issue-linked-task[data-enter-id], button[data-enter-id]') && args[0] && 'transform' in args[0])calls.push(this.dataset.enterId!);
    return animate.apply(this,args);
   };
  }, mode==='personal');
  const loaded=mode==='normal'?loadMotion(page):Promise.resolve();
  const {card,writes}=await fixture(page,{linked:true,children:true});await loaded;
  await expect(card.locator('[data-enter-id="i2"]')).toBeVisible();
  await settle(page);expect(await page.evaluate(()=>(window as any).__relationEnters)).toEqual([]);
  await action(page,'Добавить связь');await page.getByRole('option',{name:/CORP-2/}).click();
  await expect(card.locator('.issue-linked-task')).toHaveCount(2);await settle(page);
  expect(await page.evaluate(()=>(window as any).__relationEnters)).toEqual(mode==='normal'?['link2']:[]);
  await card.locator('.issue-tile').filter({hasText:'Подзадачи'}).getByRole('button',{name:'+ Добавить',exact:true}).click();
  const create=page.getByRole('dialog').filter({has:page.locator('#create-issue-title')});
  await create.getByLabel('Название *',{exact:true}).fill('Вторая подзадача');
  await create.getByRole('button',{name:'Создать задачу',exact:true}).click();
  await expect(create).toHaveCount(0);await expect(card.locator('[data-enter-id="child-new"]')).toBeVisible();await settle(page);
  expect(writes.at(-1).body.parentId).toBe('i1');
  expect(await page.evaluate(()=>(window as any).__relationEnters)).toEqual(mode==='normal'?['link2','child-new']:[]);
  const before=await card.locator('.issue-linked-task').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  await settle(page);expect(await card.locator('.issue-linked-task').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})))).toEqual(before);
 });
}
