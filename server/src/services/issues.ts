/** Доменные хелперы задач: DTO-маппинг, загрузка, атомарная нумерация, activity. */
import type { PoolClient } from "pg";
import { one, q, withClient } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { listCollaborators, type CollaboratorDto } from "./collaborators.js";
import { listAttachments, type AttachmentDto } from "./attachments.js";
import { listIssueLinks, type IssueLinkDto } from "./issueLinks.js";
import { listChecklistItems, type ChecklistItemDto } from "./checklist.js";
import { listValuesForIssue, type CustomFieldValueDto } from "./customFields.js";

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
  /** Родитель-подзадачи (миграция 021); NULL — обычная задача/сама родитель. */
  parent_id: string | null;
  /** Спринт (миграция 023, опциональный модуль); NULL — задача в бэклоге
   *  или проект не использует спринты. */
  sprint_id: string | null;
  color: string | null;
  t_start: number | null;
  t_span: number | null;
  complexity: string | null;
  labels: string[];
  due_date: string | null; // PG отдаёт date как строку YYYY-MM-DD
  rank: number;
  created_at: Date;
  updated_at: Date;
  /** Момент перехода в статус категории 'done'; NULL — задача не закрыта (миграция 016). */
  done_at: Date | null;
  /** Момент ухода из активного набора проекта; NULL — задача активна (миграция 016). */
  archived_at: Date | null;
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
  parentId: string | null;
  sprintId: string | null;
  color: string | null;
  tStart: number | null;
  tSpan: number | null;
  complexity: string | null;
  labels: string[];
  dueDate: string | null;
  rank: number;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  archivedAt: string | null;
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
    parentId: row.parent_id,
    sprintId: row.sprint_id,
    color: row.color,
    tStart: row.t_start,
    tSpan: row.t_span,
    complexity: row.complexity,
    labels: row.labels ?? [],
    dueDate: row.due_date,
    rank: row.rank,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    doneAt: row.done_at ? new Date(row.done_at).toISOString() : null,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
  };
}

/** Скрывает sprintId в ответе, если у проекта выключен модуль спринтов —
 *  та же гарантия, что уже есть у bootstrap.sprints (routes/projects.ts):
 *  выключенный модуль не должен быть виден НИГДЕ в API, включая старую
 *  привязку задачи к спринту, оставшуюся с тех пор, как модуль был включён
 *  (ревью PR #49, третий раунд). Название/цель спринта такой утечке не
 *  подвержены — те роуты уже 404-ят; здесь маскируется только сам факт
 *  «эта задача когда-то была в каком-то спринте». */
export function maskSprintId<T extends { sprintId: string | null }>(dto: T, sprintsEnabled: boolean): T {
  return sprintsEnabled ? dto : { ...dto, sprintId: null };
}

/** Задача по id внутри проекта; отсутствует — 404 на русском. */
export async function loadIssue(projectId: string, issueId: string): Promise<IssueRow> {
  const row = await one<IssueRow>(`SELECT * FROM issues WHERE id = $1 AND project_id = $2`, [issueId, projectId]);
  if (!row) throw notFound("Задача не найдена или удалена");
  return row;
}

/** Быстрый пре-чек parentId ДО nextIssueNum() — по образцу проверки epicId
 *  чуть выше в routes/issues.ts (POST /issues): без него неверный parentId
 *  (404/400) всё равно проваливал бы запрос, но уже после того, как
 *  nextIssueNum() атомарно сжигает номер CORP-N, оставляя дыру в
 *  последовательности ключей — ровно та несогласованность с epicId-веткой,
 *  которую нашло ревью PR #46. НЕ под локом (в отличие от validateParentAssignmentTx
 *  внутри assignParentLocked) — это лишь fail-fast на пуле, не источник
 *  истины: реальная защита от гонки остаётся в assignParentLocked, который
 *  перевалидирует то же самое под advisory-локом прямо перед INSERT. */
export async function precheckParentAssignment(projectId: string, parentId: string): Promise<void> {
  const parent = await one<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM issues WHERE id = $1 AND project_id = $2`,
    [parentId, projectId],
  );
  if (!parent) throw notFound("Родительская задача не найдена в проекте");
  if (parent.parent_id !== null) {
    throw badRequest("Нельзя сделать задачу подзадачей подзадачи — поддерживается только один уровень вложенности");
  }
}

/** Подзадачи (миграция 021) — строго два уровня, без вложенности.
 *  issueId=null — вызов из POST /issues (создаваемая задача ещё не имеет id,
 *  поэтому проверка «у неё уже есть подзадачи» не нужна). */
async function validateParentAssignmentTx(
  client: PoolClient,
  projectId: string,
  parentId: string,
  issueId: string | null,
): Promise<void> {
  if (issueId && parentId === issueId) throw badRequest("Задача не может быть подзадачей самой себя");
  const parentRes = await client.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM issues WHERE id = $1 AND project_id = $2`,
    [parentId, projectId],
  );
  const parent = parentRes.rows[0];
  if (!parent) throw notFound("Родительская задача не найдена в проекте");
  if (parent.parent_id !== null) {
    throw badRequest("Нельзя сделать задачу подзадачей подзадачи — поддерживается только один уровень вложенности");
  }
  if (issueId) {
    const childRes = await client.query<{ id: string }>(`SELECT id FROM issues WHERE parent_id = $1 LIMIT 1`, [issueId]);
    if (childRes.rows[0]) throw badRequest("У задачи уже есть свои подзадачи — сначала уберите их, прежде чем делать её чьей-то подзадачей");
  }
}

/** Валидация + сама запись, объединённые в одну транзакцию под advisory-локом
 *  (по образцу rank.ts: pg_advisory_xact_lock(hashtext($1)) внутри withClient).
 *
 *  Без этого — реальная гонка (найдена в ревью PR #46): два конкурентных
 *  PATCH могут пройти validateParentAssignment по устаревшим данным и вместе
 *  создать вложенность в 3 уровня — например C1 читает P как top-level
 *  родителя и параллельно P читает P2 как top-level родителя; оба UPDATE
 *  проходят раздельно и независимо друг от друга валидны, а вместе нарушают
 *  инвариант «ровно два уровня». Гонка бьёт «с двух концов» одного и того же
 *  отношения родитель/потомок, поэтому лочим ОБЕ вовлечённые задачи —
 *  кандидата в родители и переносимую задачу (если она уже существует), — не
 *  одну. Порядок блокировки — отсортированный список id, чтобы два вызова с
 *  одной парой участников всегда брали advisory-локи в одном порядке
 *  (иначе — дедлок). `write` выполняется тем же client, в той же
 *  транзакции, что и повторная проверка — конкурентному запросу, ждущему тот
 *  же advisory-лок, попросту нечего перехватывать в промежутке. */
/** Общий каркас «BEGIN → advisory-локи по отсортированным ключам → write →
 *  COMMIT/ROLLBACK», вынесенный из assignParentLocked — используется им (с
 *  повторной валидацией внутри) и withIssueParentLock ниже (без нужды в
 *  валидации, но с тем же самым локом на issueId — см. её комментарий).
 *  Экспортирован — тот же примитив нужен services/sprints.ts (completeSprint)
 *  и routes/issues.ts (PATCH /:id/sprint): без общего лока на sprintId
 *  completeSprint() мог закоммититься ПОСЛЕ того, как конкурентный
 *  PATCH /:id/sprint под READ COMMITTED успел прочитать ещё не закоммиченный
 *  (для него — всё ещё 'active') статус спринта и записать sprint_id — тот
 *  же класс кросс-транзакционной гонки, что и с parentId, просто через
 *  границу двух РАЗНЫХ функций, а не двух вызовов одной (ревью PR #49,
 *  седьмой раунд: одиночная проверка в WHERE самого UPDATE закрывает гонку
 *  внутри одной транзакции, но не между двумя независимыми). */
export async function withAdvisoryLocks<T>(keys: string[], run: (client: PoolClient) => Promise<T>): Promise<T> {
  const sortedKeys = [...new Set(keys)].sort();
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      for (const key of sortedKeys) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
      }
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
}

export async function assignParentLocked<T>(
  projectId: string,
  parentId: string,
  issueId: string | null,
  write: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const keys = issueId ? [parentId, issueId] : [parentId];
  return withAdvisoryLocks(keys, async (client) => {
    await validateParentAssignmentTx(client, projectId, parentId, issueId);
    return write(client);
  });
}

/** Снятие parentId (parentId → null) не нарушает инвариант глубины сама по
 *  себе (нет проверки — снимать можно всегда), поэтому раньше шла обычным
 *  незалоченным UPDATE. Но тот же issueId параллельно может быть заперт
 *  конкурентным assignParentLocked() (кто-то делает ЕГО чьей-то подзадачей
 *  или переносит ЕГО собственного будущего родителя) — без локов здесь оба
 *  запроса физически сериализуются на уровне строки Postgres'ом как обычно,
 *  но RETURNING одного из них может отражать состояние, которое второй
 *  запрос тут же перезапишет, и клиент получит на руки ответ, устаревший
 *  ещё до того, как долетел (ревью PR #46). Лочим тот же ключ issueId, что
 *  использовал бы assignParentLocked, — без собственной валидации, снятие
 *  родителя корректно при любом состоянии задачи. */
export async function withIssueParentLock<T>(issueId: string, write: (client: PoolClient) => Promise<T>): Promise<T> {
  return withAdvisoryLocks([issueId], write);
}

/** Мини-профиль участника задачи — чтобы карточку можно было отрисовать без
 *  bootstrap проекта (одиночный просмотр приглашённого, COLLAB_MIGRATION.md Фаза 6). */
export interface ParticipantDto {
  id: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
}

async function listParticipants(issueId: string): Promise<ParticipantDto[]> {
  const rows = await q<{ id: string; name: string; initials: string; color: string; job_role: string }>(
    `SELECT u.id, u.name, u.initials, u.color, u.job_role
       FROM users u
      WHERE u.id IN (
        SELECT reporter_id FROM issues WHERE id = $1
        UNION SELECT assignee_id FROM issues WHERE id = $1
        UNION SELECT author_id FROM comments WHERE issue_id = $1
        UNION SELECT user_id FROM issue_collaborators WHERE issue_id = $1
      )`,
    [issueId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, initials: r.initials, color: r.color, jobRole: r.job_role }));
}

export interface SubtasksSummaryDto {
  total: number;
  done: number;
}

/** Итог по подзадачам — total/done СЧИТАЕТСЯ по всем детям (включая
 *  заархивированных), не по тому, что успел загрузить клиент в data.issues
 *  (тот список — активные задачи по умолчанию). Иначе бейдж "Подзадачи · N/M"
 *  в IssueModal.tsx регрессировал бы сам собой, когда закрытая подзадача
 *  уходит в архив по возрасту (ARCHIVE_AFTER_DAYS) — архивирование не
 *  удаление, оно обязано продолжать учитываться "в отчётах" (см. CLAUDE.md,
 *  раздел Issue lifecycle), а бейдж — тот же вид отчёта (ревью PR #46).
 *  Список САМИХ строк подзадач в UI по-прежнему активные-only — как и везде
 *  в приложении default view прячет архив, отчёты/счётчики его учитывают. */
async function getSubtasksSummary(issueId: string): Promise<SubtasksSummaryDto> {
  const row = await one<{ total: string; done: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE done_at IS NOT NULL)::text AS done
       FROM issues WHERE parent_id = $1`,
    [issueId],
  );
  return { total: Number(row?.total ?? 0), done: Number(row?.done ?? 0) };
}

/** Карточка задачи: DTO + приглашённые участники (issue_collaborators, миграция 008)
 *  + участники (reporter/assignee/авторы комментариев/приглашённые) для рендера
 *  карточки без bootstrap. Всё это — только в детальном ответе GET /:id, не в списке. */
export type IssueDetailDto = IssueDto & {
  collaborators: CollaboratorDto[];
  participants: ParticipantDto[];
  attachments: AttachmentDto[];
  links: IssueLinkDto[];
  checklist: ChecklistItemDto[];
  customFieldValues: CustomFieldValueDto[];
  subtasksSummary: SubtasksSummaryDto;
};

export async function getIssueDto(projectId: string, issueId: string): Promise<IssueDetailDto> {
  const row = await loadIssue(projectId, issueId);
  const [collaborators, participants, attachments, links, checklist, customFieldValues, subtasksSummary] = await Promise.all([
    listCollaborators(row.id),
    listParticipants(row.id),
    listAttachments(row.id),
    listIssueLinks(row.id),
    listChecklistItems(row.id),
    listValuesForIssue(row.id),
    getSubtasksSummary(row.id),
  ]);
  return { ...mapIssue(row), collaborators, participants, attachments, links, checklist, customFieldValues, subtasksSummary };
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

export interface ActivityDto {
  id: string;
  actorId: string | null;
  actor: { id: string; name: string; initials: string; color: string } | null;
  text: string;
  createdAt: string;
}

/** История задачи, последние `limit` записей в хронологическом порядке.
 *
 *  До этого таблица `activity` была write-only: logActivity() исправно писала
 *  строки, но НИ ОДИН роут их не отдавал, и вкладка «История» в карточке задачи
 *  всегда оставалась пустой (аудит). Лимит — чтобы у долгоживущей задачи
 *  история не грузилась целиком (PERF-04). */
export async function listActivity(issueId: string, limit = 100): Promise<ActivityDto[]> {
  const rows = await q<{
    id: string;
    actor_id: string | null;
    text: string;
    created_at: Date;
    name: string | null;
    initials: string | null;
    color: string | null;
  }>(
    `SELECT a.id, a.actor_id, a.text, a.created_at, u.name, u.initials, u.color
       FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.issue_id = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [issueId, limit],
  );
  return rows
    .map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actor: r.actor_id && r.name ? { id: r.actor_id, name: r.name, initials: r.initials ?? "", color: r.color ?? "#888" } : null,
      text: r.text,
      createdAt: new Date(r.created_at).toISOString(),
    }))
    .reverse(); // в БД брали свежие сверху, наружу отдаём по возрастанию времени
}

/** Запись в историю задачи («кто, что, когда»). */
export async function logActivity(issueId: string, actorId: string, text: string): Promise<void> {
  await q(`INSERT INTO activity (issue_id, actor_id, text) VALUES ($1, $2, $3)`, [issueId, actorId, text]);
}
