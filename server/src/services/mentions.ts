/** Разбор @-упоминаний (NOTIFICATIONS_MIGRATION.md D5).
 *  Парсит сервер; резолвит только среди тех, кто видит задачу — чужие @-токены
 *  игнорируются молча (не подтверждаем существование логина, не даём пинговать).
 */
import { q } from "../db.js";

// @login: 3–32 символов [a-z0-9._-], перед @ — начало строки или не-словесный
// символ (чтобы не ловить адрес e-mail вида user@host).
const MENTION_RE = /(?:^|[^\w@])@([a-z0-9._-]{3,32})/gi;

export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(MENTION_RE)) out.add(m[1].toLowerCase());
  return [...out];
}

/** Логины → user_id активных пользователей, имеющих доступ к задаче:
 *  участник проекта ∪ приглашённый к задаче ∪ глобальный admin.
 *  Неявный viewer (департамент / is_shared) в MVP не упоминаем — он видит
 *  задачу, но mention ему не шлётся. */
export async function resolveVisibleMentions(projectId: string, issueId: string, logins: string[]): Promise<string[]> {
  if (logins.length === 0) return [];
  const rows = await q<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE lower(u.username) = ANY($1) AND u.is_active
        AND ( u.global_role = 'admin'
              OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = u.id)
              OR EXISTS (SELECT 1 FROM issue_collaborators ic WHERE ic.issue_id = $3 AND ic.user_id = u.id) )`,
    [logins, projectId, issueId],
  );
  return rows.map((r) => r.id);
}
