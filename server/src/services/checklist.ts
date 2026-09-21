/** Доменные хелперы чек-листа задачи (checklist_items, миграция 019).
 *  Модель минимальна, по образцу issueLinks.ts: без reorder в v1 (см.
 *  комментарий в самой миграции — если понадобится drag-and-drop, тогда
 *  переходить на дробный rank, а не заводить его заранее). */
import { one, q } from "../db.js";
import { notFound } from "../middleware.js";
import type { ChecklistItemDto } from "../contract.js";
export type { ChecklistItemDto };


interface Row {
  id: string;
  text: string;
  done: boolean;
  position: number;
  created_at: Date;
}

const toDto = (r: Row): ChecklistItemDto => ({
  id: r.id,
  text: r.text,
  done: r.done,
  position: r.position,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function listChecklistItems(issueId: string): Promise<ChecklistItemDto[]> {
  const rows = await q<Row>(
    `SELECT id, text, done, position, created_at FROM checklist_items
      WHERE issue_id = $1 ORDER BY position, created_at`,
    [issueId],
  );
  return rows.map(toDto);
}

export async function countChecklistItems(issueId: string): Promise<number> {
  const row = await one<{ n: string }>(`SELECT count(*)::text AS n FROM checklist_items WHERE issue_id = $1`, [issueId]);
  return Number(row?.n ?? 0);
}

/** position = MAX(position)+1 внутри задачи, атомарно с самой вставкой —
 *  два параллельных добавления могут (редко) получить одну и ту же позицию;
 *  ORDER BY position, created_at в listChecklistItems() тогда решает порядок
 *  по времени создания вместо падения/блокировки ради маловероятной гонки. */
export async function createChecklistItem(issueId: string, text: string): Promise<ChecklistItemDto> {
  const row = await one<Row>(
    `INSERT INTO checklist_items (issue_id, text, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM checklist_items WHERE issue_id = $1), 0))
     RETURNING id, text, done, position, created_at`,
    [issueId, text],
  );
  return toDto(row!);
}

/** Пункт внутри конкретной задачи — иначе null (IDOR-сверка в роуте, как у attachments/links). */
export async function getChecklistItemInIssue(issueId: string, itemId: string): Promise<{ id: string } | null> {
  return one<{ id: string }>(`SELECT id FROM checklist_items WHERE id = $1 AND issue_id = $2`, [itemId, issueId]);
}

export async function updateChecklistItem(
  itemId: string,
  patch: { text?: string; done?: boolean },
): Promise<ChecklistItemDto> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.text !== undefined) {
    values.push(patch.text);
    sets.push(`text = $${values.length}`);
  }
  if (patch.done !== undefined) {
    values.push(patch.done);
    sets.push(`done = $${values.length}`);
  }
  values.push(itemId);
  const row = await one<Row>(
    `UPDATE checklist_items SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING id, text, done, position, created_at`,
    values,
  );
  // Роут проверяет существование ДО этого UPDATE (getChecklistItemInIssue) —
  // но между той проверкой и этим запросом конкурентный DELETE того же пункта
  // мог успеть выполниться первым. one() тогда вернёт null, и row! молча
  // упал бы TypeError'ом на toDto(null).id — неперехваченный 500 вместо
  // честного 404, хотя ситуация ничем не хуже обычного «удалили между
  // проверкой и действием».
  if (!row) throw notFound("Пункт чек-листа не найден");
  return toDto(row);
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  await q(`DELETE FROM checklist_items WHERE id = $1`, [itemId]);
}
