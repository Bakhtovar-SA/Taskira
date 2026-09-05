/** Журнал действий: кто, что, когда. Пишется асинхронно и никогда не роняет запрос. */
import { q } from "./db.js";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await q(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorId, action, entity, entityId, JSON.stringify(details)],
    );
  } catch (e) {
    console.error("[audit] не удалось записать событие", e);
  }
}
