import { q, withTransaction } from "../db.js";
import { loadConfig } from "../config.js";
import { pushToUser } from "./wsHub.js";

/** Shared by enqueue and mail revalidation. Read access is checked from current DB rows. */
const ELIGIBLE = `u.is_active AND i.archived_at IS NULL AND s.category <> 'done'
  AND EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = i.id AND a.user_id = u.id)
  AND (u.global_role = 'admin' OR p.is_shared
    OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id)
    OR EXISTS (SELECT 1 FROM department_members m WHERE m.department_id = p.department_id AND m.user_id = u.id)
    OR EXISTS (SELECT 1 FROM issue_collaborators c WHERE c.issue_id = i.id AND c.user_id = u.id))`;

export function reminderClock(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

/** A bounded batch; marks and notifications commit together, never through best-effort emit(). */
export async function runDueRemindersOnce(now = new Date()): Promise<number> {
  const cfg = loadConfig();
  const clock = reminderClock(now, cfg.reminders.timeZone);
  if (!cfg.reminders.enabled || clock.hour < cfg.reminders.hour) return 0;
  const rows = await withTransaction(async client => {
    // Hold the lock on the transaction's connection: no second pool slot is reserved for locking.
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('taskira:job:due-reminders')) AS ok");
    if (!lock.rows[0].ok) return [];

    const result = await client.query<{ user_id: string }>(`
      WITH candidates AS (
        SELECT i.id AS issue_id, u.id AS user_id, i.due_date, (i.due_date - $1::date) AS lead_days
        FROM issues i JOIN projects p ON p.id = i.project_id
        JOIN workflow_statuses s ON s.id = i.status_id
        JOIN issue_assignees a ON a.issue_id = i.id JOIN users u ON u.id = a.user_id
        WHERE ${ELIGIBLE} AND i.due_date BETWEEN $1::date AND $1::date + 7
          AND (i.due_date - $1::date) IN (SELECT value::int FROM jsonb_array_elements_text(COALESCE(u.notify_prefs->'dueReminderDays', '[1,0]'::jsonb)))
          AND NOT EXISTS (SELECT 1 FROM due_reminder_deliveries d WHERE d.issue_id = i.id AND d.user_id = u.id AND d.due_date = i.due_date AND d.lead_days = i.due_date - $1::date)
        ORDER BY i.due_date, i.id, u.id LIMIT 500
      ), marked AS (
        INSERT INTO due_reminder_deliveries (issue_id, user_id, due_date, lead_days)
        SELECT issue_id, user_id, due_date, lead_days FROM candidates ON CONFLICT DO NOTHING RETURNING *
      )
      INSERT INTO notifications (user_id, type, actor_id, project_id, issue_id, payload, email_state)
      SELECT d.user_id, 'issue.dueSoon', NULL, i.project_id, i.id,
        jsonb_build_object('key', i.key, 'dueDate', d.due_date::text, 'leadDays', d.lead_days::text),
        CASE WHEN $2::boolean AND u.email IS NOT NULL AND COALESCE(u.notify_prefs->>'email', 'instant') <> 'off' THEN 'pending' ELSE 'skipped' END
      FROM marked d JOIN issues i ON i.id = d.issue_id JOIN users u ON u.id = d.user_id RETURNING user_id
    `, [clock.date, cfg.notify.emailEnabled]);
    return result.rows;
  });
  for (const userId of new Set(rows.map(r => r.user_id))) {
    try { pushToUser(userId, { type: "notify", ts: now.getTime() }); }
    catch (error) { console.error("[due-reminders] push failed", error); }
  }
  return rows.length;
}

/** Only whitelisted deadline metadata is returned to the mail renderer, never issue text. */
export async function validDueReminderIds(ids: string[], now = new Date()): Promise<Set<string>> {
  const date = reminderClock(now, loadConfig().reminders.timeZone).date;
  const rows = await q<{ id: string }>(`SELECT n.id FROM notifications n
    JOIN issues i ON i.id = n.issue_id JOIN projects p ON p.id = i.project_id
    JOIN workflow_statuses s ON s.id = i.status_id JOIN users u ON u.id = n.user_id
    WHERE n.id = ANY($1::uuid[]) AND ${ELIGIBLE}
      AND i.due_date >= $2::date AND i.due_date::text = n.payload->>'dueDate'
      AND n.payload->>'leadDays' IN (SELECT value FROM jsonb_array_elements_text(COALESCE(u.notify_prefs->'dueReminderDays', '[1,0]'::jsonb)))`, [ids, date]);
  return new Set(rows.map(r => r.id));
}

export async function runDueRemindersTick(now = new Date()): Promise<number> {
  return runDueRemindersOnce(now);
}

let timer: NodeJS.Timeout | null = null;
let running = false;
export function startDueReminders(): void {
  if (timer || !loadConfig().reminders.enabled) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runDueRemindersTick(); }
    catch (error) { console.error("[due-reminders] tick failed", error); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
}
export function stopDueReminders(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
