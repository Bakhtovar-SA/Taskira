/** История задачи — события данными (трек E, миграция 20260929T1500_activity_kind.sql).
 *
 *  Пишем и событие (`kind` + `payload`), и русскую фразу в `text`: фраза нужна клиентам до трека E, экспорту и как
 *  запасной вариант для чтения. Фразы — те же, что писались раньше, поэтому старые и новые записи выглядят одинаково.
 *  Клиент показывает событие через словарь на языке интерфейса (`src/activityText.ts`). */
import type { PoolClient } from "pg";
import { q } from "../db.js";
import { ActivityEvent } from "../contract.js";

const PRIORITY_NAMES: Record<string, string> = { critical: "Критичный", high: "Высокий", medium: "Средний", low: "Низкий" };
const COMPLEXITY_NAMES: Record<string, string> = { simple: "Простая", medium: "Средняя", hard: "Сложная" };
const BULK = " (массовая операция)";

/** Русская фраза события — то, что раньше писалось в `activity.text` напрямую. */
export function activityText(e: ActivityEvent): string {
  switch (e.kind) {
    case "created":
      return "создал(а) задачу";
    case "renamed":
      return "переименовал(а) задачу";
    case "description":
      return "обновил(а) описание";
    case "priority":
      return `изменил(а) приоритет: ${PRIORITY_NAMES[e.from]} → ${PRIORITY_NAMES[e.to]}${e.bulk ? BULK : ""}`;
    case "complexity":
      return `изменил(а) сложность: ${COMPLEXITY_NAMES[e.from ?? ""] ?? "—"} → ${COMPLEXITY_NAMES[e.to ?? ""] ?? "—"}`;
    case "due":
      return `изменил(а) срок: ${e.from ?? "—"} → ${e.to ?? "—"}`;
    case "assigneeAdded":
      return `назначил(а) исполнителем ${e.name}`;
    case "assigneeRemoved":
      return `снял(а) исполнителя ${e.name}`;
    case "assigneeBulk":
      return (e.cleared ? "снял(а) исполнителя" : "назначил(а) исполнителя") + BULK;
    case "direction":
      return "изменил(а) группу (эпик)";
    case "parent":
      return e.set ? "сделал(а) подзадачей другой задачи" : "убрал(а) из подзадач";
    case "labels":
      return "обновил(а) метки";
    case "status":
      return `переместил(а) из «${e.from}» в «${e.to}»${e.bulk ? BULK : ""}`;
    case "checklistAdded":
      return `добавил(а) пункт чек-листа «${e.text}»`;
    case "checklistRemoved":
      return "удалил(а) пункт чек-листа";
    case "link":
      return e.type === "blocks"
        ? `отметил(а), что задача блокирует ${e.key}`
        : e.type === "blocked_by"
          ? `отметил(а), что задача заблокирована ${e.key}`
          : `связал(а) с ${e.key}`;
  }
}

/** Колонки строки для INSERT: kind отдельно, остальное — payload. */
export function activityColumns(event: ActivityEvent): { kind: string; payload: string; text: string } {
  // Схема проверяется и на записи: вызывающие приводят строки из БД к типам (`priority_id as PriorityId`), и значение
  // вне списка без проверки молча дало бы «undefined» во фразе. Лучше громкая ошибка, чем испорченная история.
  const e = ActivityEvent.parse(event);
  const { kind, ...rest } = e;
  return { kind, payload: JSON.stringify(rest), text: activityText(e) };
}

/** Событие из строки БД. Нет kind (запись до миграции) или kind неизвестен (более новая версия) — null. */
export function activityEventOf(kind: string | null, payload: unknown): ActivityEvent | null {
  if (!kind) return null;
  const r = ActivityEvent.safeParse({ ...(payload && typeof payload === "object" ? payload : {}), kind });
  return r.success ? r.data : null;
}

/** Запись в историю задачи («кто, что, когда»). */
export async function logActivity(issueId: string, actorId: string, event: ActivityEvent, client?: PoolClient): Promise<void> {
  const c = activityColumns(event);
  const sql = `INSERT INTO activity (issue_id, actor_id, text, kind, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`;
  const params = [issueId, actorId, c.text, c.kind, c.payload];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}
