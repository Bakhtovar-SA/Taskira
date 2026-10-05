/** Событие наступления срока в часовом поясе инсталляции; повторные проходы не создают дублей. */
import { q } from "../db.js";
import { loadConfig } from "../config.js";
import { reminderClock } from "./dueReminders.js";

export async function runDueEventsOnce(now = new Date()): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.webhooks.enabled) return 0;
  const date = reminderClock(now, cfg.reminders.timeZone).date;
  let total = 0;
  for (;;) {
    const rows = await q<{ id: string }>(`INSERT INTO integration_events (type, project_id, issue_id, issue_key, dedupe_key, data)
      SELECT 'issue.due', i.project_id, i.id, i.key, 'due:' || i.id || ':' || $1, jsonb_build_object('dueDate', $1::text)
        FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
       WHERE i.due_date = $1::date AND i.archived_at IS NULL AND s.category <> 'done'
         AND EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = i.project_id AND w.state = 'active' AND 'issue.due' = ANY(w.events))
         AND NOT EXISTS (SELECT 1 FROM integration_events e WHERE e.dedupe_key = 'due:' || i.id || ':' || $1)
       ORDER BY i.id LIMIT 1000
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [date]);
    total += rows.length;
    if (rows.length < 1000) return total;
  }
}
