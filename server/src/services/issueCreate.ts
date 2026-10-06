/** Создание задачи в транзакции вызывающего; аудит HTTP-запроса остаётся в маршруте. */
import type { PoolClient } from "pg";
import type { ActivityEvent, ComplexityId, IssueDto, PriorityId } from "../contract.js";
import { one } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import type { ProjectRow } from "./project.js";
import { computeRank, lockRankColumn } from "./rank.js";
import { logActivity, nextIssueNum, setAssignees, validateAssigneesInProject, type IssueRow } from "./issues.js";

export interface CreateIssueInput {
  title: string;
  description: string;
  typeId: IssueDto["typeId"];
  priorityId: PriorityId;
  statusId?: string | null;
  assigneeIds: string[];
  epicId?: string | null;
  labels: string[];
  complexity: ComplexityId | null;
  dueDate?: string | null;
  checklistItems: string[];
  activity?: ActivityEvent;
}

export interface PreparedIssueCreate {
  projectId: string;
  statusId: string;
  assigneeIds: string[];
}

/** HTTP-маршрут проверяет эти поля до отдельного резервирования номера, как раньше.
 *  Фоновый вызов делает те же проверки своим клиентом внутри общей транзакции. */
export async function prepareIssueCreate(project: ProjectRow, input: CreateIssueInput, client?: PoolClient): Promise<PreparedIssueCreate> {
  const get = async (sql: string, params: unknown[]) => client
    ? (await client.query<{ id: string }>(sql, params)).rows[0] ?? null
    : one<{ id: string }>(sql, params);
  let statusId = input.statusId ?? null;
  if (statusId) {
    const known = await get(`SELECT id FROM workflow_statuses WHERE id = $1 AND project_id = $2`, [statusId, project.id]);
    if (!known) throw badRequest("Статус не найден в проекте");
  } else {
    const first = await get(`SELECT id FROM workflow_statuses
      WHERE project_id = $1 AND category = 'todo' ORDER BY position LIMIT 1`, [project.id]);
    if (!first) throw notFound("В проекте нет статуса категории «todo» — проверьте workflow");
    statusId = first.id;
  }
  const assigneeIds = [...new Set(input.assigneeIds)];
  await validateAssigneesInProject(project.id, assigneeIds, client);
  if (input.epicId) {
    const epic = await get(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [input.epicId, project.id]);
    if (!epic) throw notFound("Задача-группа (epicId) не найдена в проекте");
  }
  return { projectId: project.id, statusId, assigneeIds };
}

export async function createIssueInTx(
  client: PoolClient,
  project: ProjectRow,
  input: CreateIssueInput,
  actorId: string,
  // Только маршрут: прежние проверки и номер уже выполнены вне транзакции.
  reserved?: { num: number; prepared: PreparedIssueCreate; parentId?: string | null },
): Promise<IssueRow> {
  const prepared = reserved?.prepared ?? await prepareIssueCreate(project, input, client);
  if (prepared.projectId !== project.id) throw new Error("Подготовка задачи относится к другому проекту");
  // Счётчик держит лок до COMMIT: фоновый запуск — одна задача/правило на транзакцию.
  const num = reserved?.num ?? await nextIssueNum(project.id, client);
  const { statusId, assigneeIds } = prepared;
  // Новая задача встаёт в начало живой колонки, как при ручном создании.
  await lockRankColumn(client, statusId);
  const first = (await client.query<{ id: string }>(
    `SELECT id FROM issues WHERE status_id = $1 AND project_id = $2 AND archived_at IS NULL ORDER BY rank, id LIMIT 1`,
    [statusId, project.id],
  )).rows[0];
  const rank = await computeRank(client, project.id, statusId, first?.id ?? null);
  const created = (await client.query<IssueRow>(
    `INSERT INTO issues
      (project_id, num, key, title, description, type_id, status_id, priority_id,
       reporter_id, epic_id, parent_id, labels, complexity, due_date, rank)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [project.id, num, `${project.key}-${num}`, input.title, input.description, input.typeId, statusId,
      input.priorityId, actorId, input.epicId ?? null, reserved?.parentId ?? null,
      input.labels, input.complexity, input.dueDate ?? null, rank],
  )).rows[0];
  await setAssignees(created.id, assigneeIds, actorId, client);
  if (input.checklistItems.length > 0) {
    await client.query(
      `INSERT INTO checklist_items (issue_id, text, position)
       SELECT $1, item, ord::integer - 1 FROM unnest($2::text[]) WITH ORDINALITY AS input(item, ord)`,
      [created.id, input.checklistItems],
    );
  }
  await logActivity(created.id, actorId, input.activity ?? { kind: "created" }, client);
  return created;
}
