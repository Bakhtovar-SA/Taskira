/** Personal reminders: the recipient is always the authenticated reader, never a body parameter. */
import type { PoolClient } from "pg";
import { q, withTransaction } from "../db.js";
import { badRequest } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { loadConfig } from "../config.js";
import { pushToUser } from "./wsHub.js";

export function validateReminder(at: string, now = new Date()): void {
 const time = Date.parse(at);
 if (!Number.isFinite(time) || time <= now.getTime() || time > now.getTime() + 5 * 366 * 86400000)
  throw badRequest("Выберите время в будущем, не дальше пяти лет");
}
export async function setIssueReminder(client: PoolClient, issueId: string, userId: string, at: string): Promise<void> {
 validateReminder(at);
 // The worker never delivers for archived issues, so refuse instead of storing a reminder that silently never fires.
 const archived=(await client.query(`SELECT 1 FROM issues WHERE id=$1 AND archived_at IS NOT NULL`,[issueId])).rows.length>0;
 if(archived)throw new ApiHttpError(409,"CONFLICT","Задача в архиве — напоминание не будет доставлено");
 await client.query(`INSERT INTO issue_reminders(issue_id,user_id,remind_at) VALUES($1,$2,$3)
  ON CONFLICT(issue_id,user_id) DO UPDATE SET remind_at=EXCLUDED.remind_at,delivered_at=NULL`,[issueId,userId,at]);
}
const ACCESS = `u.is_active AND u.auth_source <> 'service' AND i.archived_at IS NULL AND
 (u.global_role='admin' OR p.is_shared OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=u.id)
 OR EXISTS(SELECT 1 FROM department_members m WHERE m.department_id=p.department_id AND m.user_id=u.id)
 OR EXISTS(SELECT 1 FROM issue_collaborators c WHERE c.issue_id=i.id AND c.user_id=u.id))`;
export async function runPersonalRemindersOnce(now = new Date()): Promise<number> {
 const rows = await withTransaction(async client => (await client.query<{user_id:string}>(`
  WITH ready AS (
   SELECT r.issue_id,r.user_id,r.remind_at,(${ACCESS}) AS eligible
   FROM issue_reminders r JOIN issues i ON i.id=r.issue_id JOIN projects p ON p.id=i.project_id JOIN users u ON u.id=r.user_id
   WHERE r.delivered_at IS NULL AND r.remind_at <= $1 ORDER BY r.remind_at LIMIT 500 FOR UPDATE OF r SKIP LOCKED
  ), marked AS (
   UPDATE issue_reminders r SET delivered_at=$1 FROM ready d WHERE r.issue_id=d.issue_id AND r.user_id=d.user_id
   RETURNING r.issue_id,r.user_id,r.remind_at
  )
  INSERT INTO notifications(user_id,type,actor_id,project_id,issue_id,payload,email_state)
  SELECT d.user_id,'issue.reminder',NULL,i.project_id,i.id,jsonb_build_object('key',i.key,'remindAt',d.remind_at),
   CASE WHEN $2::boolean AND u.email IS NOT NULL AND COALESCE(u.notify_prefs->>'email','instant')<>'off' THEN 'pending' ELSE 'skipped' END
  FROM marked d JOIN ready r USING(issue_id,user_id) JOIN issues i ON i.id=d.issue_id JOIN users u ON u.id=d.user_id
  WHERE r.eligible RETURNING user_id
 `,[now,loadConfig().notify.emailEnabled])).rows);
 for (const userId of new Set(rows.map(r=>r.user_id))) {
  try { pushToUser(userId,{type:"notify",ts:now.getTime()}); } catch(e) { console.error("[personal-reminders] push failed",e); }
 }
 return rows.length;
}
export async function validPersonalReminderIds(ids: string[]): Promise<Set<string>> {
 const rows=await q<{id:string}>(`SELECT n.id FROM notifications n JOIN issues i ON i.id=n.issue_id
  JOIN projects p ON p.id=i.project_id JOIN users u ON u.id=n.user_id WHERE n.id=ANY($1::uuid[]) AND ${ACCESS}`,[ids]);
 return new Set(rows.map(r=>r.id));
}
