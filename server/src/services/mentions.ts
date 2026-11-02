/** Разбор @-упоминаний (NOTIFICATIONS_MIGRATION.md D5).
 *  Парсит сервер; резолвит только среди тех, кто видит задачу — чужие @-токены
 *  игнорируются молча (не подтверждаем существование логина, не даём пинговать).
 */
import { escLike, q } from "../db.js";
import type { MentionCandidateDto } from "../contract.js";

// Shared by search and delivery: never offer a person who cannot receive the mention.
const VISIBLE_RECIPIENT = `(u.global_role = 'admin'
  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = u.id)
  OR EXISTS (SELECT 1 FROM issue_collaborators ic WHERE ic.issue_id = $3 AND ic.user_id = u.id))`;

// A sender invited only to this issue (req.isCollaborator, COLLAB_MIGRATION D3) sees the
// issue, not the project directory: limit both suggestions and delivery to people already
// on the issue, so neither an empty query nor a guessed @login reaches other members.
const ON_ISSUE = `(u.id = (SELECT reporter_id FROM issues WHERE id = $3)
  OR EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = $3 AND a.user_id = u.id)
  OR EXISTS (SELECT 1 FROM issue_collaborators ic WHERE ic.issue_id = $3 AND ic.user_id = u.id))`;
const scope = (issueOnly: boolean) => issueOnly ? ` AND ${ON_ISSUE}` : "";

export async function listMentionCandidates(
  projectId: string, issueId: string, actorId: string, term: string, issueOnly: boolean,
): Promise<MentionCandidateDto[]> {
  const rows = await q<{
    id: string; username: string; name: string; initials: string; color: string; job_role: string;
  }>(`SELECT u.id, u.username, u.name, u.initials, u.color, u.job_role FROM users u
    WHERE u.is_active AND u.auth_source <> 'service' AND u.id <> $4
      AND u.username ~* '^[a-z0-9._-]{3,32}$' AND ${VISIBLE_RECIPIENT}${scope(issueOnly)}
      AND (u.name ILIKE $1 OR u.username ILIKE $1)
    ORDER BY EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = $3 AND a.user_id = u.id) DESC,
      lower(u.name), u.id LIMIT 20`, [`%${escLike(term)}%`, projectId, issueId, actorId]);
  return rows.map(row => ({ id: row.id, username: row.username, name: row.name, initials: row.initials,
    color: row.color, jobRole: row.job_role }));
}

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
 *  задачу, но mention ему не шлётся. issueOnly — отправитель лишь приглашён
 *  к задаче: адресаты только из уже видимых в ней людей. */
export async function resolveVisibleMentions(
  projectId: string, issueId: string, logins: string[], issueOnly = false,
): Promise<string[]> {
  if (logins.length === 0) return [];
  const rows = await q<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE lower(u.username) = ANY($1) AND u.is_active AND u.auth_source <> 'service'
        AND ${VISIBLE_RECIPIENT}${scope(issueOnly)}`,
    [logins, projectId, issueId],
  );
  return rows.map((r) => r.id);
}
