/** Избранные проекты пользователя (user_favorite_projects, миграция 024).
 *  Чистое множество project_id — toggle-семантика, без чтения-изменения-записи. */
import { q } from "../db.js";

export async function listFavoriteProjectIds(userId: string): Promise<string[]> {
  const rows = await q<{ project_id: string }>(
    `SELECT project_id FROM user_favorite_projects WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map((r) => r.project_id);
}

export async function addFavoriteProject(userId: string, projectId: string): Promise<void> {
  await q(
    `INSERT INTO user_favorite_projects (user_id, project_id) VALUES ($1, $2)
     ON CONFLICT (user_id, project_id) DO NOTHING`,
    [userId, projectId],
  );
}

export async function removeFavoriteProject(userId: string, projectId: string): Promise<void> {
  await q(`DELETE FROM user_favorite_projects WHERE user_id = $1 AND project_id = $2`, [userId, projectId]);
}
