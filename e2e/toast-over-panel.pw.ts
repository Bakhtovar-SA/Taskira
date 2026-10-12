import {test,expect} from '@playwright/test';
import {boardFixture} from './board-fixture';

test.use({permissions:['clipboard-read','clipboard-write']});

test('toast «Ссылка скопирована» is visible above the open issue panel',async({page})=>{
 const {issues,project,users,statuses}=await boardFixture(page,'light');
 users[0].globalRole='member';
 const detail:any={...issues[0],attachments:[],links:[],checklist:[],customFieldValues:[],collaboratorIds:[],watch:{watching:false,watchers:0},subtasksSummary:{total:0,done:0},parentId:null,epicId:null};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
  if(path==='/api/projects/p1')return route.fulfill({json:{project,users,members:users.map(u=>({userId:u.id,role:'admin'})),workflow:{statuses,transitions:[]},issueTemplates:[],customFields:[],sprints:[]}});
  if(path==='/api/auth/me')return route.fulfill({json:{...users[0],globalRole:'member',onboarding:{hidden:true}}});
  if(path==='/api/projects/p1/issues'&&url.searchParams.has('parentId'))return route.fulfill({json:{items:[],hasMore:false,nextCursor:null}});
  if(path==='/api/issues/resolve')return route.fulfill({json:{projectId:'p1',id:'i1',projectKey:'CORP'}});
  if(path.match(/\/issues\/[^/]+\/(comments|activity|collaborators)$/)&&method==='GET')return route.fulfill({json:[]});
  if(path==='/api/projects/p1/issues/i1'&&method==='GET')return route.fulfill({json:detail});
  return route.fallback();
 });
 await page.goto('/p/CORP/board?issue=CORP-1');
 await expect(page.locator('.issue-detail')).toBeVisible();
 await page.getByRole('button',{name:'Скопировать ссылку'}).first().click();
 const toast=page.getByText(/Ссылка на CORP-1 скопирована/);
 await expect(toast).toBeVisible();
 // z-index не перебивает верхний слой <dialog>: контейнер уведомлений должен быть открытым popover (он поверх окон)
 expect(await toast.evaluate(el=>!!el.closest("[popover]")?.matches(":popover-open"))).toBe(true);
});
