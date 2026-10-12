import { writeFileSync } from 'node:fs';
import { initPool, migrate, q, one, closePool } from 'file:///D:/CodexScratch/Taskira-UI-Audit-20261009/server/src/db.ts';
import { initConfig } from 'file:///D:/CodexScratch/Taskira-UI-Audit-20261009/server/src/config.ts';
import { runStartupSeeds } from 'file:///D:/CodexScratch/Taskira-UI-Audit-20261009/server/src/seedStartup.ts';
import { hashPassword } from 'file:///D:/CodexScratch/Taskira-UI-Audit-20261009/server/src/services/passwordHash.ts';
import { seedProjectWorkflow } from 'file:///D:/CodexScratch/Taskira-UI-Audit-20261009/server/src/services/workflow.ts';
const url = new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/taskira_ui_audit')throw new Error('Unsafe seed target');
const cfg=initConfig();initPool(cfg.databaseUrl);
try {
 await migrate(); await runStartupSeeds();
 const admin=await one(`SELECT id FROM users WHERE username='audit_admin'`);
 const passwordHash=await hashPassword(process.env.AUDIT_USER_PASSWORD);
 const userSpecs=[['audit_manager','Илья Ковалёв','ИК','manager'],['audit_employee','Мария Волкова','МВ','employee'],['audit_viewer','Олег Петров','ОП','viewer']];
 const users={admin:admin.id};
 for(const [username,name,initials,role] of userSpecs){
  const row=await one(`INSERT INTO users(username,password_hash,name,initials,color,job_role,global_role,is_active) VALUES($1,$2,$3,$4,'#0B5FD9',$5,'member',true) ON CONFLICT(username) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[username,passwordHash,name,initials,role]);users[role]=row.id;
 }
 const department=await one(`INSERT INTO departments(name) VALUES('Разработка') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
 const second=await one(`INSERT INTO projects(key,name,description,department_id) VALUES('DEV','Разработка продукта','Тестовые данные для аудита интерфейса',$1) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[department.id]);
 if(!(await one('SELECT id FROM workflow_statuses WHERE project_id=$1 LIMIT 1',[second.id])))await seedProjectWorkflow(second.id);
 const projects=(await q(`SELECT id,key FROM projects WHERE key IN ('UX','DEV') ORDER BY key`));
 for(const p of projects)for(const [,, ,role] of userSpecs)await q(`INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO NOTHING`,[p.id,users[role],role]);
 const titles=[
 'Подготовить план запуска новой версии',
 'Проверить сценарии согласования заявки',
 'Исправить отображение сроков в списке задач',
 'Согласовать требования к уведомлениям',
 'Обновить инструкции для сотрудников',
 'Проверить сохранение изменений после перезагрузки',
 'Задача с длинным названием: согласование процесса обработки обращений между продуктовой командой, разработкой и службой поддержки с несколькими исполнителями',
 'Настроить доступ наблюдателя к проекту',
 'Проверить фильтры по исполнителю и приоритету',
 'Собрать обратную связь по рабочим процессам',
 'Подготовить отчёт о проверке мобильного интерфейса',
 'Проверить клавиатурную навигацию и фокус',
 ];
 const record=[];
 for(const p of projects){
  const statuses=(await q('SELECT id,sid FROM workflow_statuses WHERE project_id=$1',[p.id]));const bySid=Object.fromEntries(statuses.map(s=>[s.sid,s.id]));
  const count=p.key==='UX'?12:5;
  for(let n=1;n<=count;n++){
   const sid=['todo','inprogress','review','done'][(n-1)%4];const assignees=n%5===0?[]:n===7?[users.employee,users.manager]:[n%2?users.employee:users.manager];
   if(p.key==='UX' && [1,3,6].includes(n))assignees.push(users.admin);
   const reporter=n%3===0?users.manager:users.employee;
   const row=await one(`INSERT INTO issues(project_id,num,key,title,description,type_id,status_id,priority_id,reporter_id,labels,rank,due_date,done_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,current_date+$12::int,CASE WHEN $13::boolean THEN now() ELSE NULL END) ON CONFLICT(key) DO UPDATE SET title=EXCLUDED.title RETURNING id`,[p.id,n,`${p.key}-${n}`,titles[n-1],'Тестовая задача для проверки текущего интерфейса.\n\nКритерии готовности:\n- изменения сохраняются;\n- права учитываются;\n- основной сценарий доступен с клавиатуры.',n%3===0?'bug':'task',bySid[sid],['high','medium','critical','low'][(n-1)%4],reporter,n%2?['аудит','запуск']:['аудит'],n,n%3===0?-2:n===1?0:7,sid==='done']);
   for(const uid of assignees)await q('INSERT INTO issue_assignees(issue_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,uid,admin.id]);
   if(n===1 && !(await one('SELECT id FROM comments WHERE issue_id=$1',[row.id])))await q('INSERT INTO comments(issue_id,author_id,body) VALUES($1,$2,$3)',[row.id,users.manager,'Проверил требования. Можно брать в работу.']);
   record.push({id:row.id,key:`${p.key}-${n}`,projectId:p.id,status:sid,assignees});
  }
  await q('INSERT INTO project_counters(project_id,next_num) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET next_num=GREATEST(project_counters.next_num,EXCLUDED.next_num)',[p.id,count+1]);
 }
 await q('UPDATE instance SET setup_completed_at=COALESCE(setup_completed_at,now()) WHERE id=1');
 for(const uid of Object.values(users))await q('INSERT INTO user_onboarding(user_id,hidden,done,hints) VALUES($1,true,$2,$3) ON CONFLICT(user_id) DO NOTHING',[uid,['theme','project','issue','assign','move','comment'],['board.create','board.drag','issue.edit','home.steps']]);
 writeFileSync('D:/CodexScratch/Taskira-UI-Audit-20261009-runtime/fixture.json',JSON.stringify({users,projects,issues:record},null,2));
 console.log(JSON.stringify({projects:projects.map(p=>p.key),users:Object.keys(users),issues:record.length}));
}finally{await closePool();}
