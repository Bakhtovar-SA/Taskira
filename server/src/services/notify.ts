/** Событийный слой уведомлений (NOTIFICATIONS_MIGRATION.md D2/D8).
 *
 *  `emit(ev)` вычисляет получателей, отбрасывает актора и деактивированных,
 *  пишет строки `notifications`. Как `audit()` — НИКОГДА не бросает в запрос.
 *
 *  Email-канал: строке проставляется `email_state='pending'`, только если
 *  NOTIFY_EMAIL_ENABLED и у получателя есть `email` и `notify_prefs.email != 'off'`;
 *  иначе `'skipped'`. Саму рассылку делает воркер (Фаза 3).
 */
import { q } from "../db.js";
import { loadConfig } from "../config.js";
import type { NotifyPrefs, NotifyType } from "../contract.js";

export interface NotifyEvent {
  type: NotifyType;
  /** Кто вызвал событие — ему уведомление не создаётся. */
  actorId: string;
  projectId: string | null;
  issueId: string | null;
  /** Денормализованные поля для in-app-ленты (ключ/заголовок задачи, отрывок…).
   *  НАРУЖУ НЕ УХОДИТ — email-шаблон payload не читает (D9). */
  payload?: Record<string, unknown>;
  /** Явные получатели: для issue.assigned / issue.collaborator / project.member —
   *  один; для issue.mention — список. Для issue.comment / issue.status не
   *  задаётся: получатели = watchers ∪ assignee ∪ reporter (∪ collaborators). */
  recipientIds?: string[];
}

async function resolveRecipients(ev: NotifyEvent): Promise<string[]> {
  if (ev.recipientIds) return ev.recipientIds;
  if (!ev.issueId) return [];
  const withCollab = ev.type === "issue.comment";
  const rows = await q<{ id: string }>(
    `SELECT user_id AS id FROM issue_watchers WHERE issue_id = $1
     UNION SELECT assignee_id FROM issues WHERE id = $1 AND assignee_id IS NOT NULL
     UNION SELECT reporter_id FROM issues WHERE id = $1
     ${withCollab ? "UNION SELECT user_id FROM issue_collaborators WHERE issue_id = $1" : ""}`,
    [ev.issueId],
  );
  return rows.map((r) => r.id);
}

export async function emit(ev: NotifyEvent): Promise<void> {
  try {
    const rawIds = [...new Set(await resolveRecipients(ev))].filter((id) => id && id !== ev.actorId);
    if (rawIds.length === 0) return;

    const users = await q<{ id: string; is_active: boolean; email: string | null; notify_prefs: NotifyPrefs | null }>(
      `SELECT id, is_active, email, notify_prefs FROM users WHERE id = ANY($1)`,
      [rawIds],
    );
    const emailEnabled = loadConfig().notify.emailEnabled;

    const ids: string[] = [];
    const states: string[] = [];
    for (const u of users) {
      if (!u.is_active) continue; // D8: деактивированным — ничего
      const mode = u.notify_prefs?.email ?? (u.email ? "instant" : "off");
      ids.push(u.id);
      states.push(emailEnabled && u.email && mode !== "off" ? "pending" : "skipped");
    }
    if (ids.length === 0) return;

    await q(
      `INSERT INTO notifications (user_id, type, actor_id, project_id, issue_id, payload, email_state)
       SELECT r.uid, $2, $3, $4, $5, $6::jsonb, r.est
         FROM unnest($1::uuid[], $7::text[]) AS r(uid, est)`,
      [ids, ev.type, ev.actorId, ev.projectId, ev.issueId, JSON.stringify(ev.payload ?? {}), states],
    );
  } catch (e) {
    console.error("[notify] emit не удалось", e);
  }
}

/** Авто-подписка актора на задачу (notify_prefs.selfWatch, деф. true). Не бросает. */
export async function autoWatch(issueId: string, userId: string): Promise<void> {
  try {
    const rows = await q<{ notify_prefs: NotifyPrefs | null }>(`SELECT notify_prefs FROM users WHERE id = $1`, [userId]);
    if (rows[0]?.notify_prefs?.selfWatch === false) return;
    await q(`INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issueId, userId]);
  } catch (e) {
    console.error("[notify] autoWatch не удалось", e);
  }
}
