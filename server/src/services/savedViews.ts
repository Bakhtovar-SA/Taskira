/** Сохранённые вьюхи (saved_views, миграция 20260922T1100, ТЗ 3.2 план v2 Трек 3).
 *  Личные — user_id — а не общие для проекта, в отличие от issue_templates/
 *  custom_fields/workflow: два человека в одном проекте не видят вьюхи друг друга.
 *  По образцу services/issueTemplates.ts (тот же CRUD-шаблон), но с user_id в
 *  каждом запросе и без position/CHECK-полей. */
import { one, q, withTransaction } from "../db.js";
import type { SavedViewDto, SavedViewFilter } from "../contract.js";
export type { SavedViewDto };

interface Row {
  id: string;
  name: string;
  filter_json: SavedViewFilter;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const toDto = (r: Row): SavedViewDto => ({
  id: r.id,
  name: r.name,
  filter: r.filter_json,
  isDefault: r.is_default,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listSavedViews(userId: string, projectId: string): Promise<SavedViewDto[]> {
  const rows = await q<Row>(
    `SELECT id, name, filter_json, is_default, created_at, updated_at
       FROM saved_views WHERE user_id = $1 AND project_id = $2 ORDER BY created_at`,
    [userId, projectId],
  );
  return rows.map(toDto);
}

export async function countSavedViews(userId: string, projectId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM saved_views WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId],
  );
  return Number(row!.n);
}

export interface SavedViewInput {
  name: string;
  filter: SavedViewFilter;
  isDefault: boolean;
}

/** `is_default` — не более одной вьюхи по умолчанию на (user, project)
 *  (uq_saved_views_one_default_per_user_project, частичный уникальный индекс,
 *  миграция 20260922T1100): выставление новой снимает флаг со старой в ОДНОЙ
 *  транзакции с записью новой строки — иначе окно между UPDATE и INSERT ловит
 *  уникальный индекс на конкурентном запросе того же пользователя (тот же класс
 *  гонки, что и спринты — миграция 023 — one active per project). */
export async function createSavedView(userId: string, projectId: string, args: SavedViewInput): Promise<SavedViewDto> {
  return withTransaction(async (client) => {
    if (args.isDefault) {
      await client.query(`UPDATE saved_views SET is_default = false WHERE user_id = $1 AND project_id = $2 AND is_default`, [userId, projectId]);
    }
    const res = await client.query<Row>(
      `INSERT INTO saved_views (user_id, project_id, name, filter_json, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, filter_json, is_default, created_at, updated_at`,
      [userId, projectId, args.name, JSON.stringify(args.filter), args.isDefault],
    );
    return toDto(res.rows[0]);
  });
}

export async function getSavedViewForUser(userId: string, projectId: string, viewId: string): Promise<{ id: string; name: string } | null> {
  return one<{ id: string; name: string }>(
    `SELECT id, name FROM saved_views WHERE id = $1 AND user_id = $2 AND project_id = $3`,
    [viewId, userId, projectId],
  );
}

export async function updateSavedView(
  userId: string,
  projectId: string,
  viewId: string,
  args: SavedViewInput,
): Promise<SavedViewDto> {
  return withTransaction(async (client) => {
    if (args.isDefault) {
      await client.query(
        `UPDATE saved_views SET is_default = false WHERE user_id = $1 AND project_id = $2 AND is_default AND id <> $3`,
        [userId, projectId, viewId],
      );
    }
    const res = await client.query<Row>(
      `UPDATE saved_views
          SET name = $4, filter_json = $5, is_default = $6, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND project_id = $3
        RETURNING id, name, filter_json, is_default, created_at, updated_at`,
      [viewId, userId, projectId, args.name, JSON.stringify(args.filter), args.isDefault],
    );
    return toDto(res.rows[0]);
  });
}

export async function deleteSavedView(userId: string, projectId: string, viewId: string): Promise<void> {
  await q(`DELETE FROM saved_views WHERE id = $1 AND user_id = $2 AND project_id = $3`, [viewId, userId, projectId]);
}
