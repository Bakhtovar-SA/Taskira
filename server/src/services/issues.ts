/** Доменные хелперы задач: DTO-маппинг, загрузка, атомарная нумерация, activity. */
import { one, q } from "../db.js";
import { notFound } from "../middleware.js";

/* -------- строка БД → camelCase DTO (единый формат ответа API) -------- */
export interface IssueRow {
  id: string;
  project_id: string;
  num: number;
  key: string;
  title: string;
  description: string;
  type_id: string;
  status_id: string;
  priority_id: string;
  assignee_id: string | null;
  reporter_id: string;
  epic_id: string | null;
  color: string | null;
  t_start: number | null;
  t_span: number | null;
  points: number | null;
  sprint_id: string | null;
  labels: string[];
  due_date: string | null; // PG отдаёт date как строку YYYY-MM-DD
  rank: number;
  created_at: Date;
  updated_at: Date;
}

export interface IssueDto {
  id: string;
  projectId: string;
  num: number;
  key: string;
  title: string;
  description: string;
  typeId: string;
  statusId: string;
  priorityId: string;
  assigneeId: string | null;
  reporterId: string;
  epicId: string | null;
  color: string | null;
  tStart: number | null;
  tSpan: number | null;
  points: number | null;
  sprintId: string | null;
  labels: string[];
  dueDate: string | null;
  rank: number;
  createdAt: string;
  updatedAt: string;
}

export function mapIssue(row: IssueRow): IssueDto {
  return {
    id: row.id,
    projectId: row.project_id,
    num: row.num,
    key: row.key,
    title: row.title,
    description: row.description,
    typeId: row.type_id,
    statusId: row.status_id,
    priorityId: row.priority_id,
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    epicId: row.epic_id,
    color: row.color,
    tStart: row.t_start,
    tSpan: row.t_span,
    points: row.points,
    sprintId: row.sprint_id,
    labels: row.labels ?? [],
    dueDate: row.due_date,
    rank: row.rank,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Задача по id внутри проекта; отсутствует — 404 на русском. */
export async function loadIssue(projectId: string, issueId: string): Promise<IssueRow> {
  const row = await one<IssueRow>(`SELECT * FROM issues WHERE id = $1 AND project_id = $2`, [issueId, projectId]);
  if (!row) throw notFound("Задача не найдена или удалена");
  return row;
}

export async function getIssueDto(projectId: string, issueId: string): Promise<IssueDto> {
  return mapIssue(await loadIssue(projectId, issueId));
}

/** Атомарный следующий номер задачи: UPSERT счётчика (миграция 003).
    Первое обращение к счётчику проекта стартует с MAX(num)+1 — защита от
    расхождения, если задачи уже создавались до появления счётчика. */
export async function nextIssueNum(projectId: string): Promise<number> {
  const row = await one<{ num: number }>(
    `INSERT INTO project_counters (project_id, next_num)
       SELECT $1, COALESCE((SELECT MAX(num) FROM issues WHERE project_id = $1), 0) + 2
       ON CONFLICT (project_id)
       DO UPDATE SET next_num = project_counters.next_num + 1
     RETURNING next_num - 1 AS num`,
    [projectId],
  );
  if (!row) throw new Error("Счётчик задач не вернул номер");
  return row.num;
}

/** Запись в историю задачи («кто, что, когда»). */
export async function logActivity(issueId: string, actorId: string, text: string): Promise<void> {
  await q(`INSERT INTO activity (issue_id, actor_id, text) VALUES ($1, $2, $3)`, [issueId, actorId, text]);
}
