/** Contextual recurrence uses a private snapshot template and the existing recurring worker. */
import type { PoolClient } from "pg";
import { q, withTransaction } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { LIMITS, type IssueAutomationDto, type IssueRecurrenceBody } from "../contract.js";
import type { ProjectRow } from "./project.js";
import { issueRecurringRule, deleteRecurringRule } from "./recurring.js";
import { assertValidTiming, localDateOf, nextOccurrence } from "./recurrence.js";
import type { IssueRow } from "./issues.js";

export async function getIssueAutomation(projectId: string, issueId: string, userId: string): Promise<IssueAutomationDto> {
 const [recurrence, rows]=await Promise.all([issueRecurringRule(projectId,issueId),q<{remind_at:Date}>(
  `SELECT remind_at FROM issue_reminders WHERE issue_id=$1 AND user_id=$2 AND delivered_at IS NULL`,[issueId,userId])]);
 return {recurrence,remindAt:rows[0]?.remind_at.toISOString()??null};
}
export async function createIssueRecurrenceInTx(client: PoolClient, project: ProjectRow, issue: IssueRow, body: IssueRecurrenceBody, actorId: string): Promise<void> {
 assertValidTiming(body);
 await client.query(`SELECT id FROM projects WHERE id=$1 FOR UPDATE`,[project.id]);
 const count=(await client.query<{count:number}>(`SELECT count(*)::int AS count FROM recurring_rules WHERE project_id=$1`,[project.id])).rows[0].count;
 if(count>=LIMITS.recurring.perProject)throw new ApiHttpError(409,"RECURRING_LIMIT","В проекте достигнут лимит правил");
 const initial=(await client.query<{id:string}>(`SELECT id FROM workflow_statuses WHERE project_id=$1 AND category='todo' ORDER BY position LIMIT 1`,[project.id])).rows[0];
 if(!initial)throw badRequest("В проекте нет начального статуса");
 const assignees=(await client.query<{user_id:string}>(`SELECT user_id FROM issue_assignees WHERE issue_id=$1`,[issue.id])).rows.map(r=>r.user_id);
 const service=(await client.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) AND auth_source='service' LIMIT 1",[assignees])).rows[0];
 if(service)throw badRequest("Сервисная учётная запись не может быть исполнителем задачи");
 if(assignees.length>LIMITS.recurring.assignees)throw badRequest("Слишком много исполнителей для повторяющейся задачи");
 const checklist=(await client.query<{text:string}>(`SELECT text FROM checklist_items WHERE issue_id=$1 ORDER BY position,id`,[issue.id])).rows.map(r=>r.text);
 const name=(issue.key+' · '+issue.title).slice(0,LIMITS.recurring.name);
 const template=(await client.query<{id:string}>(`INSERT INTO issue_templates(project_id,name,type_id,priority_id,title,description,status_id,position,hidden)
 VALUES($1,$2,$3,$4,$5,$6,$7,0,true) RETURNING id`,[project.id,name,issue.type_id,issue.priority_id,issue.title,issue.description,initial.id])).rows[0];
 const due=issue.due_date?Math.max(0,Math.min(365,Math.round((Date.parse(String(issue.due_date).slice(0,10)+'T00:00:00Z')-Date.parse(localDateOf(new Date(),body.timeZone)+'T00:00:00Z'))/86400000))):null;
 const rule=(await client.query<{id:string}>(`INSERT INTO recurring_rules(project_id,template_id,name,title,schedule,time_of_day,time_zone,start_date,due_in_days,skip_if_open,owner_id,next_run_at,source_issue_id,source_snapshot)
 VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING id`,[project.id,template.id,name,issue.title,JSON.stringify(body.schedule),body.timeOfDay,body.timeZone,body.startDate,due,body.skipIfOpen,actorId,nextOccurrence(body,new Date()),issue.id,JSON.stringify({epicId:issue.epic_id,labels:issue.labels,complexity:issue.complexity,checklistItems:checklist})])).rows[0];
 if(assignees.length)await client.query(`INSERT INTO recurring_rule_assignees(rule_id,user_id) SELECT $1,unnest($2::uuid[])`,[rule.id,assignees]);
}
export async function configureIssueRecurrence(project: ProjectRow, issueId: string, body: IssueRecurrenceBody | null, actorId: string): Promise<void> {
 if(!body){const rule=await issueRecurringRule(project.id,issueId);if(rule)await deleteRecurringRule(project.id,rule.id);return;}
 await withTransaction(async client=>{
  await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project.id]);
  const issue=(await client.query<IssueRow>('SELECT * FROM issues WHERE id=$1 AND project_id=$2 FOR UPDATE',[issueId,project.id])).rows[0];
  if(!issue)throw notFound('Задача не найдена');
  const rule=(await client.query<{id:string;start_date:string}>(   'SELECT id,start_date FROM recurring_rules WHERE project_id=$1 AND (source_issue_id=$2 OR id IN (SELECT rule_id FROM recurring_runs WHERE issue_id=$2)) FOR UPDATE',[project.id,issueId])).rows[0];
  assertValidTiming(body,{checkStartWindow:!rule||rule.start_date!==body.startDate});
  if(rule)await client.query(   "UPDATE recurring_rules SET schedule=$2::jsonb,time_of_day=$3,time_zone=$4,start_date=$5,skip_if_open=$6,owner_id=$7,state='active',paused_reason=NULL,next_run_at=$8,updated_at=now() WHERE id=$1",   [rule.id,JSON.stringify(body.schedule),body.timeOfDay,body.timeZone,body.startDate,body.skipIfOpen,actorId,nextOccurrence(body,new Date())]);
  else await createIssueRecurrenceInTx(client,project,issue,body,actorId);
 });
}
