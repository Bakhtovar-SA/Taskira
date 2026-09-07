/** Приглашённые участники задачи (issue_collaborators, миграция 008).
 *
 *  Collaborator видит ОДНУ задачу и её комментарии и может комментировать —
 *  без членства в проекте (COLLAB_MIGRATION.md D1/D3). Enforcement — аддитивный
 *  fallback в middleware.requireIssuePerm (browse/comment). Здесь — только
 *  доменные операции над таблицей.
 */
import { one, q } from "../db.js";

export interface CollaboratorDto {
  userId: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
  addedAt: string;
}

interface Row {
  user_id: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
  added_at: Date;
}

const map = (r: Row): CollaboratorDto => ({
  userId: r.user_id,
  name: r.name,
  initials: r.initials,
  color: r.color,
  jobRole: r.job_role,
  addedAt: new Date(r.added_at).toISOString(),
});

/** Есть ли строка (issue, user). Дёшево — вызывается только когда ролевой
 *  can() уже не прошёл (участники/админы сюда не попадают). */
export async function isIssueCollaborator(userId: string, issueId: string): Promise<boolean> {
  const row = await one<{ one: number }>(
    `SELECT 1 AS one FROM issue_collaborators WHERE issue_id = $1 AND user_id = $2`,
    [issueId, userId],
  );
  return !!row;
}

export async function listCollaborators(issueId: string): Promise<CollaboratorDto[]> {
  const rows = await q<Row>(
    `SELECT ic.user_id, ic.added_at, u.name, u.initials, u.color, u.job_role
       FROM issue_collaborators ic
       JOIN users u ON u.id = ic.user_id
      WHERE ic.issue_id = $1
      ORDER BY u.name`,
    [issueId],
  );
  return rows.map(map);
}

/** Подключить пользователя к задаче (идемпотентно). Возвращает актуальную строку. */
export async function addCollaborator(issueId: string, userId: string, byId: string): Promise<CollaboratorDto> {
  await q(
    `INSERT INTO issue_collaborators (issue_id, user_id, added_by)
       VALUES ($1, $2, $3)
     ON CONFLICT (issue_id, user_id) DO NOTHING`,
    [issueId, userId, byId],
  );
  const row = await one<Row>(
    `SELECT ic.user_id, ic.added_at, u.name, u.initials, u.color, u.job_role
       FROM issue_collaborators ic
       JOIN users u ON u.id = ic.user_id
      WHERE ic.issue_id = $1 AND ic.user_id = $2`,
    [issueId, userId],
  );
  if (!row) throw new Error("collaborator insert did not persist");
  return map(row);
}

/** Отключить. true — строка была и удалена; false — её не было. */
export async function removeCollaborator(issueId: string, userId: string): Promise<boolean> {
  const rows = await q<{ user_id: string }>(
    `DELETE FROM issue_collaborators WHERE issue_id = $1 AND user_id = $2 RETURNING user_id`,
    [issueId, userId],
  );
  return rows.length > 0;
}
