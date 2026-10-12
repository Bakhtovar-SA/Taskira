import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireIssuePerm,zbody} from "../middleware.js";
import {IssueRecurrenceBody,IssueReminderBody} from "../contract.js";
import {getIssueAutomation,configureIssueRecurrence} from "../services/issueAutomation.js";
import {setIssueReminder} from "../services/issueReminders.js";
import {q,withTransaction} from "../db.js";
import {auditFromRequest} from "../audit.js";
export async function issueAutomationRoutes(app:FastifyInstance):Promise<void>{
 app.get("/:id/automation",{preHandler:requireIssuePerm("browse")},req=>getIssueAutomation(req.project!.id,req.issueRef!.id,req.user.sub));
 app.put("/:id/recurrence",{preHandler:requireIssuePerm("manageRecurring"),preValidation:zbody(IssueRecurrenceBody)},async req=>{
  await configureIssueRecurrence(req.project!,req.issueRef!.id,req.body as z.infer<typeof IssueRecurrenceBody>,req.user.sub);
  await auditFromRequest(req,"recurring.issue.update","issue",req.issueRef!.id);
  return getIssueAutomation(req.project!.id,req.issueRef!.id,req.user.sub);
 });
 app.delete("/:id/recurrence",{preHandler:requireIssuePerm("manageRecurring")},async(req,reply)=>{
  await configureIssueRecurrence(req.project!,req.issueRef!.id,null,req.user.sub);await auditFromRequest(req,"recurring.issue.delete","issue",req.issueRef!.id);return reply.code(204).send();
 });
 app.put("/:id/reminder",{preHandler:requireIssuePerm("browse"),preValidation:zbody(IssueReminderBody)},async req=>{
  await withTransaction(client=>setIssueReminder(client,req.issueRef!.id,req.user.sub,(req.body as z.infer<typeof IssueReminderBody>).remindAt));
  await auditFromRequest(req,"issue.reminder.set","issue",req.issueRef!.id);
  return getIssueAutomation(req.project!.id,req.issueRef!.id,req.user.sub);
 });
 app.delete("/:id/reminder",{preHandler:requireIssuePerm("browse")},async(req,reply)=>{
  await q(`DELETE FROM issue_reminders WHERE issue_id=$1 AND user_id=$2`,[req.issueRef!.id,req.user.sub]);await auditFromRequest(req,"issue.reminder.delete","issue",req.issueRef!.id);return reply.code(204).send();
 });
}
