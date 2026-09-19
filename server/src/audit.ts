/** Журнал действий: кто, что, когда. Ошибка журнала не роняет бизнес-запрос. */
import { q } from "./db.js";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null = null,
  details: Record<string, unknown> = {},
  result: "success" | "denied" | "error" = "success",
): Promise<void> {
  // Дожидаемся INSERT: запрос не завершится и пул не закроется, пока запись
  // ещё летит в фоне. Это также устраняет гонку audit INSERT ↔ test TRUNCATE.
  try {
    await q(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details, result) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [actorId, action, entity, entityId, JSON.stringify(details), result],
    );
  } catch (e) {
    console.error("[audit] не удалось записать событие", e);
  }
}
