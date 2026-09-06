/** Workflow: схема переходов, её проверка и DTO. Переход вне схемы — 409 CONFLICT. */
import { one, q } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { ApiHttpError } from "../middleware.js";

export interface StatusRow {
  id: string;
  sid: string;
  name: string;
  category: "todo" | "inprogress" | "done";
  position: number;
}

export interface TransitionRow {
  id: string;
  from_status_id: string;
  to_status_id: string;
}

export interface WorkflowDto {
  statuses: StatusRow[];
  transitions: TransitionRow[];
}

/** Дефолтный граф переходов (используется в seed и в POST /workflow/reset).
    Ключи — стабильные sid статусов, не uuid. */
export const DEFAULT_TRANSITIONS: Array<[fromSid: string, toSid: string]> = [
  ["todo", "inprogress"],
  ["todo", "done"],
  ["inprogress", "todo"],
  ["inprogress", "review"],
  ["inprogress", "done"],
  ["review", "inprogress"],
  ["review", "done"],
  ["done", "inprogress"],
];

export const DEFAULT_STATUSES: Array<{ sid: string; name: string; category: StatusRow["category"]; position: number }> = [
  { sid: "todo", name: "К выполнению", category: "todo", position: 0 },
  { sid: "inprogress", name: "В работе", category: "inprogress", position: 1 },
  { sid: "review", name: "На ревью", category: "inprogress", position: 2 },
  { sid: "done", name: "Готово", category: "done", position: 3 },
];

export const conflict = (reason: string) => new ApiHttpError(409, "CONFLICT", reason);

/** Загружает статусы проекта (по position). */
export async function getStatuses(projectId: string): Promise<StatusRow[]> {
  return q<StatusRow>(
    `SELECT id, sid, name, category, position FROM workflow_statuses WHERE project_id = $1 ORDER BY position`,
    [projectId],
  );
}

/** Название статуса (для activity-записей). */
export async function statusName(statusId: string): Promise<string> {
  const row = await one<{ name: string }>(`SELECT name FROM workflow_statuses WHERE id = $1`, [statusId]);
  return row?.name ?? statusId;
}

/** Проверка перехода по схеме. from === to — всегда разрешён (no-op/переупорядочивание).
    Статусы должны принадлежать проекту; отсутствие ребра — 409. */
export async function assertTransition(projectId: string, fromStatusId: string, toStatusId: string): Promise<void> {
  if (fromStatusId === toStatusId) return;

  const statuses = await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1`, [projectId]);
  const known = new Set(statuses.map((s) => s.id));
  if (!known.has(fromStatusId)) throw badRequest("Исходный статус не принадлежит проекту");
  if (!known.has(toStatusId)) throw badRequest("Целевой статус не принадлежит проекту");

  const edge = await one<{ id: string }>(
    `SELECT id FROM workflow_transitions
      WHERE project_id = $1 AND from_status_id = $2 AND to_status_id = $3`,
    [projectId, fromStatusId, toStatusId],
  );
  if (!edge) {
    const [from, to] = [await statusName(fromStatusId), await statusName(toStatusId)];
    throw conflict(`Переход «${from} → ${to}» запрещён схемой рабочего процесса`);
  }
}

/** DTO схемы для GET /workflow и bootstrap. */
export async function getWorkflow(projectId: string): Promise<WorkflowDto> {
  const statuses = await getStatuses(projectId);
  const transitions = await q<TransitionRow>(
    `SELECT id, from_status_id, to_status_id
       FROM workflow_transitions
      WHERE project_id = $1
      ORDER BY from_status_id, to_status_id`,
    [projectId],
  );
  return { statuses, transitions };
}
