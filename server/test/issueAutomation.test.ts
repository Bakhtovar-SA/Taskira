import type {FastifyInstance} from 'fastify';
import {beforeAll,beforeEach,afterAll,expect,test} from 'vitest';
import {auth,getApp,login,q,resetDb,seedFixture,stopApp,type Fixture} from './helpers.js';
import {loadConfig} from '../src/config.js';
import {runRecurringOnce} from '../src/services/recurring.js';
import {runPersonalRemindersOnce,validPersonalReminderIds} from '../src/services/issueReminders.js';
let app:FastifyInstance,fx:Fixture,manager:string,employee:string,viewer:string;
const timing=()=>({schedule:{kind:'daily',every:1},timeOfDay:'09:00',timeZone:'Asia/Tashkent',startDate:new Date(Date.now()-86400000).toISOString().slice(0,10),skipIfOpen:false});
const future=()=>new Date(Date.now()+3600000).toISOString();
const url=(issue=fx.issues.p1issue,project=fx.projects.p1)=>`/api/projects/${project}/issues/${issue}`;
const call=(method:'GET'|'POST'|'PUT'|'DELETE',path:string,token=manager,payload?:unknown)=>app.inject({method,url:path,headers:auth(token),...(payload===undefined?{}:{payload})});
beforeAll(async()=>{app=await getApp()});afterAll(stopApp);
beforeEach(async()=>{await resetDb();fx=await seedFixture();loadConfig().recurring.enabled=true;manager=await login(app,'mgr1');employee=await login(app,'emp1');viewer=await login(app,'viw1')});
const configure=async(overrides={})=>{const response=await call('PUT',url()+'/recurrence',manager,{...timing(),...overrides});expect(response.statusCode,response.body).toBe(200);return response.json().recurrence};
test('create saves issue, private repeat snapshot and personal reminder atomically',async()=>{
 const response=await call('POST',`/api/projects/${fx.projects.p1}/issues`,manager,{title:'Automation report',description:'Keep this',epicId:null,complexity:null,typeId:'task',priorityId:'high',assigneeIds:[fx.users.emp1],checklistItems:['Review'],recurrence:timing(),remindAt:future()});expect(response.statusCode,response.body).toBe(201);
 const state=(await call('GET',url(response.json().id)+'/automation')).json();expect(state.recurrence.sourceIssueId).toBe(response.json().id);expect(state.remindAt).toBeTruthy();
 const templates=await call('GET',`/api/projects/${fx.projects.p1}/issue-templates`);expect(templates.statusCode).toBe(200);expect(templates.json()).toEqual([]);
});
test('invalid reminder or forbidden recurrence leaves no new issue or snapshot',async()=>{
 const before=(await q<{count:number}>('SELECT count(*)::int AS count FROM issues'))[0].count;
 const body={title:'Invalid',epicId:null,complexity:null,typeId:'task',priorityId:'medium'};
 expect((await call('POST',`/api/projects/${fx.projects.p1}/issues`,manager,{...body,recurrence:timing(),remindAt:new Date(Date.now()-1000).toISOString()})).statusCode).toBe(400);
 expect((await call('POST',`/api/projects/${fx.projects.p1}/issues`,employee,{...body,recurrence:timing()})).statusCode).toBe(403);
 expect((await q<{count:number}>('SELECT count(*)::int AS count FROM issues'))[0].count).toBe(before);expect(await q('SELECT id FROM issue_templates')).toHaveLength(0);
});
test('personal reminders belong to the session and are private to other viewers',async()=>{
 expect((await call('PUT',url()+'/reminder',employee,{remindAt:future(),userId:fx.users.mgr1})).statusCode).toBe(200);
 expect((await call('GET',url()+'/automation',manager)).json().remindAt).toBeNull();expect((await call('GET',url()+'/automation',employee)).json().remindAt).toBeTruthy();
 expect((await call('PUT',url()+'/reminder',viewer,{remindAt:future()})).statusCode).toBe(200);
 expect((await call('DELETE',url()+'/reminder',viewer)).statusCode).toBe(204);expect((await call('GET',url()+'/automation',employee)).json().remindAt).toBeTruthy();
});
test('recurrence is manager-only and issue endpoints enforce project ownership',async()=>{
 expect((await call('PUT',url()+'/recurrence',employee,timing())).statusCode).toBe(403);
 const admin=await login(app,'admin');for(const [method,suffix,payload]of [['GET','automation',undefined],['PUT','reminder',{remindAt:future()}],['PUT','recurrence',timing()]] as const)expect((await call(method,url(fx.issues.p2issue) + '/'+suffix,admin,payload)).statusCode).toBe(404);
});
const standaloneOccurrence=async()=>{
 const templateId=(await q<{id:string}>(`INSERT INTO issue_templates(project_id,name,type_id,priority_id,title,description,position) VALUES($1,'Weekly','task','high','Report','',0) RETURNING id`,[fx.projects.p1]))[0].id;
 const created=await call('POST',`/api/projects/${fx.projects.p1}/recurring`,manager,{name:'Weekly',templateId,...timing(),assigneeIds:[fx.users.emp1],dueInDays:2});expect(created.statusCode,created.body).toBe(201);
 const rule=created.json();await q('UPDATE recurring_rules SET next_run_at=$2 WHERE id=$1',[rule.id,new Date(new Date(Date.now()-86400000).toISOString().slice(0,10)+'T04:00:00Z')]);expect((await runRecurringOnce()).created).toBe(1);
 const run=(await q<{issue_id:string}>('SELECT issue_id FROM recurring_runs WHERE rule_id=$1',[rule.id]))[0];return {rule,issue:run.issue_id,templateId};
};
test('an occurrence of a standalone rule cannot edit or delete that rule',async()=>{
 const {rule,issue,templateId}=await standaloneOccurrence();const before=(await q('SELECT schedule,owner_id,state,time_zone FROM recurring_rules WHERE id=$1',[rule.id]))[0];
 expect((await call('GET',url(issue)+'/automation')).json().recurrence.id).toBe(rule.id);
 expect((await call('PUT',url(issue)+'/recurrence',manager,{...timing(),schedule:{kind:'daily',every:3},timeZone:'UTC'})).statusCode).toBe(409);
 expect((await call('DELETE',url(issue)+'/recurrence')).statusCode).toBe(409);
 expect((await q('SELECT schedule,owner_id,state,time_zone FROM recurring_rules WHERE id=$1',[rule.id]))[0]).toEqual(before);expect(await q('SELECT id FROM issue_templates WHERE id=$1',[templateId])).toHaveLength(1);
});
test('applying a repeat never resumes a rule paused by the system',async()=>{
 await configure();const rule=(await q<{id:string}>('SELECT id FROM recurring_rules'))[0];
 await q("UPDATE recurring_rules SET state='paused',paused_reason='owner_lost_access',next_run_at=NULL WHERE id=$1",[rule.id]);
 expect((await configure({schedule:{kind:'daily',every:2}})).state).toBe('paused');
 expect((await q<{state:string;paused_reason:string;next_run_at:Date|null}>('SELECT state,paused_reason,next_run_at FROM recurring_rules WHERE id=$1',[rule.id]))[0]).toMatchObject({state:'paused',paused_reason:'owner_lost_access',next_run_at:null});
});
test('reminders are refused on archived issues and set/delete are audited',async()=>{
 expect((await call('PUT',url()+'/reminder',employee,{remindAt:future()})).statusCode).toBe(200);expect((await call('DELETE',url()+'/reminder',employee)).statusCode).toBe(204);
 await q('UPDATE issues SET archived_at=now() WHERE id=$1',[fx.issues.p1issue]);expect((await call('PUT',url()+'/reminder',employee,{remindAt:future()})).statusCode).toBe(409);
 await new Promise(r=>setTimeout(r,100));expect((await q<{action:string}>("SELECT action FROM audit_log WHERE action LIKE 'issue.reminder.%' ORDER BY action")).map(r=>r.action)).toEqual(['issue.reminder.delete','issue.reminder.set']);
});
test('concurrent apply creates one rule and one hidden snapshot, a manual pause stays paused',async()=>{
 const responses=await Promise.all([call('PUT',url()+'/recurrence',manager,timing()),call('PUT',url()+'/recurrence',manager,timing())]);responses.forEach(r=>expect(r.statusCode,r.body).toBe(200));
 expect(await q('SELECT id FROM recurring_rules')).toHaveLength(1);expect(await q('SELECT id FROM issue_templates WHERE hidden')).toHaveLength(1);
 const rule=responses[0].json().recurrence;await q("UPDATE recurring_rules SET state='paused',paused_reason='manual',next_run_at=NULL WHERE id=$1",[rule.id]);expect((await configure()).state).toBe('paused');
});
test('next occurrence copies issue properties and checklist, retaining a valid parent',async()=>{
 const response=await call('POST',`/api/projects/${fx.projects.p1}/issues`,manager,{title:'Parent',epicId:null,complexity:null,typeId:'task',priorityId:'medium'});expect(response.statusCode,response.body).toBe(201);const parent=response.json();
 await q("UPDATE issues SET title='Report',description='Original description',parent_id=$2,labels=ARRAY['qa'],complexity='hard' WHERE id=$1",[fx.issues.p1issue,parent.id]);await q("INSERT INTO checklist_items(issue_id,text,position) VALUES($1,'Check report',0)",[fx.issues.p1issue]);
 const rule=await configure();await q('UPDATE recurring_rules SET next_run_at=$2 WHERE id=$1',[rule.id,new Date(new Date(Date.now()-86400000).toISOString().slice(0,10)+'T04:00:00Z')]);const result=await runRecurringOnce();expect(result.created).toBe(1);
 const run=(await q<{issue_id:string}>('SELECT issue_id FROM recurring_runs WHERE rule_id=$1',[rule.id]))[0];const created=(await call('GET',url(run.issue_id))).json();expect(created).toMatchObject({title:'Report',description:'Original description',parentId:parent.id,labels:['qa'],complexity:'hard',statusId:fx.p1status.todo,assigneeIds:[fx.users.emp1]});
 expect(await q('SELECT text FROM checklist_items WHERE issue_id=$1',[run.issue_id])).toEqual([{text:'Check report'}]);expect((await call('GET',url(run.issue_id)+'/automation')).json().recurrence.id).toBe(rule.id);
});
test('skip-open includes the original issue and stopping removes the private snapshot',async()=>{
 const rule=await configure({skipIfOpen:true});await q('UPDATE recurring_rules SET next_run_at=$2 WHERE id=$1',[rule.id,new Date(new Date(Date.now()-86400000).toISOString().slice(0,10)+'T04:00:00Z')]);expect((await runRecurringOnce()).skippedOpen).toBe(1);
 expect((await call('DELETE',url()+'/recurrence')).statusCode).toBe(204);expect(await q('SELECT id FROM recurring_rules')).toHaveLength(0);expect(await q('SELECT id FROM issue_templates WHERE hidden')).toHaveLength(0);
});
test('reminder worker emits once under concurrent ticks and only to its owner',async()=>{
 await call('PUT',url()+'/reminder',employee,{remindAt:future()});const now=new Date(Date.now()+7200000);const counts=await Promise.all([runPersonalRemindersOnce(now),runPersonalRemindersOnce(now)]);expect(counts.reduce((a,b)=>a+b,0)).toBe(1);expect(await runPersonalRemindersOnce(now)).toBe(0);
 expect(await q("SELECT user_id,type FROM notifications WHERE type='issue.reminder'")).toEqual([{user_id:fx.users.emp1,type:'issue.reminder'}]);expect((await call('GET',url()+'/automation',employee)).json().remindAt).toBeNull();
});
test('cancel and lost access suppress future delivery, lost access suppresses pending mail',async()=>{
 await call('PUT',url()+'/reminder',employee,{remindAt:future()});await call('DELETE',url()+'/reminder',employee);expect(await runPersonalRemindersOnce(new Date(Date.now()+7200000))).toBe(0);
 await call('PUT',url()+'/reminder',viewer,{remindAt:future()});await q('DELETE FROM project_members WHERE user_id=$1',[fx.users.viw1]);expect(await runPersonalRemindersOnce(new Date(Date.now()+7200000))).toBe(0);
 await call('PUT',url()+'/reminder',employee,{remindAt:future()});await runPersonalRemindersOnce(new Date(Date.now()+7200000));const notifications=await q<{id:string}>("SELECT id FROM notifications WHERE type='issue.reminder'");expect((await validPersonalReminderIds(notifications.map(n=>n.id))).size).toBe(1);await q('UPDATE users SET is_active=false WHERE id=$1',[fx.users.emp1]);expect((await validPersonalReminderIds(notifications.map(n=>n.id))).size).toBe(0);
});
test('deleting the original issue cascades rule and reminder without later occurrences',async()=>{
 await configure();await call('PUT',url()+'/reminder',manager,{remindAt:future()});expect((await call('DELETE',url())).statusCode).toBe(204);expect(await q('SELECT id FROM recurring_rules')).toHaveLength(0);expect(await q('SELECT issue_id FROM issue_reminders')).toHaveLength(0);expect(await q('SELECT id FROM issue_templates WHERE hidden')).toHaveLength(0);
});
