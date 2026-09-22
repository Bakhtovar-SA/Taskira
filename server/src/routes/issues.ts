/**
 * Задачи: CRUD, смена статуса по workflow, подписка (watchers).
 * Все мутации защищены правами на сервере; ранги и переходы — только после проверок.
 */
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { escLike, one, q, withTransaction } from "../db.js";
import {
  badRequest,
  formatZod,
  notFound,
  requireIssuePerm,
  requirePerm,
  zbody,
  zparams,
  zquery,
  type JwtPayload,
} from "../middleware.js";
import { audit } from "../audit.js";
import { assertTransition, statusCategory, statusName } from "../services/workflow.js";
import { computeRank } from "../services/rank.js";
import {
  assignParentLocked,
  getIssueDto,
  listActivity,
  listAssigneeIds,
  listAssigneeIdsBatch,
  loadIssue,
  logActivity,
  mapIssue,
  maskSprintId,
  nextIssueNum,
  precheckParentAssignment,
  setAssignees,
  validateAssigneesInProject,
  withAdvisoryLocks,
  withIssueParentLock,
  type IssueRow,
} from "../services/issues.js";
import { insertIssueLink, linkExists, listIssueLinks } from "../services/issueLinks.js";
import {
  countChecklistItems,
  createChecklistItem,
  deleteChecklistItem,
  getChecklistItemInIssue,
  listChecklistItems,
  updateChecklistItem,
} from "../services/checklist.js";
import {
  getCustomFieldInProject,
  listValuesForIssue,
  setCustomFieldValue,
  validateValueForField,
} from "../services/customFields.js";
import { storageKeysForIssue, deleteStorageObjects } from "../services/attachments.js";
import { emit, autoWatch } from "../services/notify.js";
import { parseMentions, resolveVisibleMentions } from "../services/mentions.js";
import { assertSprintsEnabled, getSprintInProject } from "../services/sprints.js";
import { loadConfig } from "../config.js";
import { createTtlCache } from "../services/ttlCache.js";
import {
  decodeIssueListCursor,
  decodeIssueSortCursor,
  encodeIssueListCursor,
  encodeIssueSortCursor,
  type IssueCursorSort,
} from "../issueListCursor.js";
import { buildIssueFilter, needsStatusJoin, SORT_EXPR } from "../services/issueFilters.js";
import type { IssueAssigneesDto, IssueCountsDto, IssueEpicDto, IssueEpicsDto } from "../contract.js";
import {
  ChecklistItemCreateBody,
  ChecklistItemParams,
  ChecklistItemPatchBody,
  CustomFieldParams,
  CustomFieldValueBody,
  IssueCreateBody,
  IssueAssigneesQuery,
  IssueEpicsQuery,
  IssueCountsQuery,
  IssueListPageMeta,
  IssueLinkCreateBody,
  IssueLinkParams,
  IssuePatchBody,
  IssueQuery,
  LIMITS,
  MoveToSprintBody,
  TransitionBody,
} from "../contract.js";

const PRIORITY_NAMES: Record<string, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const COMPLEXITY_NAMES: Record<string, string> = {
  simple: "Простая",
  medium: "Средняя",
  hard: "Сложная",
};

const me = (req: { user: JwtPayload }) => req.user;

const PERF_TRACE = process.env.PERF_TRACE === "1";
const elapsedMs = (started: bigint): number => Number(process.hrtime.bigint() - started) / 1e6;

interface IssueListPerfTrace {
  requestStarted: bigint;
  permissionMs?: number;
  queryValidationMs?: number;
  beforeFirstSqlMs?: number;
  countSqlMs?: number;
  listSqlMs?: number;
  assigneesSqlMs?: number;
  responseBuildMs?: number;
  serializationStarted?: bigint;
}

const issueListPerfTraces = new WeakMap<object, IssueListPerfTrace>();
const issueListPermission = requirePerm("browse");

export async function issuesRoutes(app: FastifyInstance): Promise<void> {
  const assigneesCache = createTtlCache<IssueAssigneesDto>(loadConfig().assigneesCacheTtlMs);
  /* ---------------------------------------------------------- список с фильтрами */
  app.get(
    "/",
    {
      onRequest: PERF_TRACE
        ? async (req) => {
            issueListPerfTraces.set(req, { requestStarted: process.hrtime.bigint() });
          }
        : undefined,
      preHandler: PERF_TRACE
        ? [
            async (req, reply) => {
              const started = process.hrtime.bigint();
              await issueListPermission.call(req.server, req, reply);
              const trace = issueListPerfTraces.get(req);
              if (trace) trace.permissionMs = elapsedMs(started);
            },
            async (req) => {
              const started = process.hrtime.bigint();
              const parsed = IssueQuery.safeParse(req.query);
              if (!parsed.success) throw badRequest(formatZod(parsed.error));
              req.query = parsed.data as typeof req.query;
              const trace = issueListPerfTraces.get(req);
              if (trace) trace.queryValidationMs = elapsedMs(started);
            },
          ]
        : [issueListPermission, zquery(IssueQuery)],
      preSerialization: PERF_TRACE
        ? async (req) => {
            const trace = issueListPerfTraces.get(req);
            if (trace) trace.serializationStarted = process.hrtime.bigint();
          }
        : undefined,
      onSend: PERF_TRACE
        ? async (req, _reply, payload) => {
            const trace = issueListPerfTraces.get(req);
            if (trace) {
              const query = req.query as z.infer<typeof IssueQuery>;
              process.stdout.write(
                `[perf-trace] ${JSON.stringify({
                  route: "GET /api/projects/:projectId/issues",
                  requestId: req.id,
                  limit: query.limit,
                  offset: query.offset,
                  cursor: query.cursor ? "present" : undefined,
                  beforeFirstSqlMs: trace.beforeFirstSqlMs,
                  countSqlMs: trace.countSqlMs,
                  listSqlMs: trace.listSqlMs,
                  assigneesSqlMs: trace.assigneesSqlMs,
                  permissionMs: trace.permissionMs,
                  queryValidationMs: trace.queryValidationMs,
                  responseValidationMs: 0,
                  responseBuildMs: trace.responseBuildMs,
                  serializationMs: trace.serializationStarted ? elapsedMs(trace.serializationStarted) : undefined,
                  handlerToSerializedMs: elapsedMs(trace.requestStarted),
                })}\n`,
              );
            }
            return payload;
          }
        : undefined,
    },
    async (req, reply) => {
      const project = req.project!;
      const f = req.query as z.infer<typeof IssueQuery>;
      const trace = issueListPerfTraces.get(req);

      const { clauses, params } = buildIssueFilter(project.id, f, { sprintsEnabled: project.sprintsEnabled });

      // total относится ко всему отфильтрованному набору, а не к хвосту после
      // курсора. Поэтому фиксируем WHERE/params до добавления keyset-предиката.
      const countWhere = clauses.join(" AND ");
      const countParams = [...params];
      if (trace) trace.beforeFirstSqlMs = elapsedMs(trace.requestStarted);
      const countStarted = trace && f.includeTotal ? process.hrtime.bigint() : undefined;
      const total = f.includeTotal
        ? await one<{ n: string }>(
            `SELECT count(*)::text AS n FROM issues i
               JOIN workflow_statuses ws ON ws.id = i.status_id
              WHERE ${countWhere}`,
            countParams,
          )
        : null;
      if (trace && countStarted) trace.countSqlMs = elapsedMs(countStarted);

      const secret = loadConfig().jwtSecret;
      const byRank = f.sort === "rank";
      const sortExpr = f.sort === "rank" ? "" : SORT_EXPR[f.sort];
      if (f.cursor) {
        try {
          if (byRank) {
            const cursor = decodeIssueListCursor(f.cursor, secret);
            params.push(cursor.rank, cursor.id);
            clauses.push(`(i.rank, i.id) > ($${params.length - 1}, $${params.length})`);
          } else {
            const cursor = decodeIssueSortCursor(f.cursor, secret);
            if (cursor.sort !== f.sort || cursor.dir !== f.dir) throw new Error("cursor sort mismatch");
            params.push(cursor.value, cursor.num);
            // Тай-брейк зеркален направлению: индекс (project_id, <ключ>, num)
            // читается и вперёд, и назад, а смешанный порядок (ключ DESC,
            // num ASC) потребовал бы второго индекса на каждую сортировку.
            // Из-за этого позицию можно задать сравнением строк: в отличие от
            // `a > x OR (a = x AND b > y)` оно становится условием индекса и
            // глубокая страница не читает пропущенное.
            const cmp = f.dir === "asc" ? ">" : "<";
            clauses.push(`(${sortExpr}, i.num) ${cmp} ($${params.length - 1}, $${params.length})`);
          }
        } catch {
          throw badRequest("Некорректный курсор страницы");
        }
      }
      const where = clauses.join(" AND ");
      params.push(f.limit + 1, f.cursor ? 0 : f.offset);
      const dirSql = f.dir === "desc" ? "DESC" : "ASC";
      const orderBy = byRank ? "i.rank, i.id" : `${sortExpr} ${dirSql}, i.num ${dirSql}`;
      const listStarted = trace ? process.hrtime.bigint() : undefined;
      const rows = await q<IssueRow & { sort_val?: number }>(
        `SELECT i.*${byRank ? "" : `, ${sortExpr} AS sort_val`} FROM issues i
           JOIN workflow_statuses ws ON ws.id = i.status_id
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      if (trace && listStarted) trace.listSqlMs = elapsedMs(listStarted);
      const hasMore = rows.length > f.limit;
      const pageRows = hasMore ? rows.slice(0, f.limit) : rows;
      const assigneesStarted = trace ? process.hrtime.bigint() : undefined;
      const assigneesByIssue = await listAssigneeIdsBatch(pageRows.map((r) => r.id));
      if (trace && assigneesStarted) trace.assigneesSqlMs = elapsedMs(assigneesStarted);
      const responseBuildStarted = trace ? process.hrtime.bigint() : undefined;
      const pageMeta: IssueListPageMeta = {
        hasMore,
        nextCursor:
          hasMore && pageRows.length > 0
            ? byRank
              ? encodeIssueListCursor(pageRows.at(-1)!, secret)
              : encodeIssueSortCursor(
                  { sort: f.sort as IssueCursorSort, dir: f.dir, value: pageRows.at(-1)!.sort_val!, num: pageRows.at(-1)!.num },
                  secret,
                )
            : null,
        ...(total ? { total: Number(total.n) } : {}),
      };
      const payload = {
        items: pageRows.map((r) => maskSprintId(mapIssue(r, assigneesByIssue.get(r.id) ?? []), project.sprintsEnabled)),
        ...pageMeta,
      };
      if (trace && responseBuildStarted) trace.responseBuildMs = elapsedMs(responseBuildStarted);
      return reply.send(payload);
    },
  );

  /* ------------------------------------------------ счётчики по статусам */
  // Тот же набор фильтров, что у списка. Один запрос на набор: клиент берёт
  // отсюда общее число и заголовки колонок доски, а не считает загруженное.
  // Идёт по idx_issues_active (project_id, status_id, rank) WHERE archived_at IS NULL.
  app.get("/counts", { preHandler: [issueListPermission, zquery(IssueCountsQuery)] }, async (req): Promise<IssueCountsDto> => {
    const project = req.project!;
    const f = req.query as z.infer<typeof IssueCountsQuery>;
    const { clauses, params } = buildIssueFilter(project.id, f, { sprintsEnabled: project.sprintsEnabled });
    const rows = await q<{ status_id: string; n: string }>(
      `SELECT i.status_id, count(*)::text AS n FROM issues i
         ${needsStatusJoin(f) ? "JOIN workflow_statuses ws ON ws.id = i.status_id" : ""}
        WHERE ${clauses.join(" AND ")}
        GROUP BY i.status_id`,
      params,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status_id] = Number(r.n);
      total += Number(r.n);
    }
    return { total, byStatus };
  });

  /* ------------------------------------------- исполнители (для фильтра доски) */
  app.get("/assignees", { preHandler: [issueListPermission, zquery(IssueAssigneesQuery)] }, async (req): Promise<IssueAssigneesDto> => {
    const project = req.project!;
    const { limit } = req.query as z.infer<typeof IssueAssigneesQuery>;
    // Агрегат по всем назначениям проекта (на 50 тыс. задач — 65 мс и Seq Scan), а список нужен лишь для
    // аватарок фильтра: точность «на эту секунду» не нужна, поэтому кэш на процесс на короткое время.
    // Результат не зависит от пользователя (только проект и лимит), поэтому ключ — без пользователя.
    return assigneesCache.get(`${project.id}:${limit}`, async () => {
      const rows = await q<{ user_id: string; n: number }>(
        `SELECT ia.user_id, count(*)::int AS n
           FROM issue_assignees ia
           JOIN issues i ON i.id = ia.issue_id
          WHERE i.project_id = $1 AND i.archived_at IS NULL
          GROUP BY ia.user_id
          ORDER BY n DESC, ia.user_id
          LIMIT $2`,
        [project.id, limit],
      );
      return { items: rows.map((r) => ({ userId: r.user_id, count: r.n })) };
    });
  });

  /* ------------------------------------------------ направления (эпики) */
  // «Эпик» — задача, на которую ссылается чей-то epic_id (миграция 002). Возвращает
  // только активные направления с агрегатом по их активным детям: число и
  // сколько из них закрыто (по категории статуса, как считал клиент). Размер
  // ответа — число направлений, а не задач проекта.
  app.get("/epics", { preHandler: [issueListPermission, zquery(IssueEpicsQuery)] }, async (req): Promise<IssueEpicsDto> => {
    const project = req.project!;
    const { limit } = req.query as z.infer<typeof IssueEpicsQuery>;
    const rows = await q<{
      id: string;
      key: string;
      title: string;
      color: string | null;
      t_start: number | null;
      t_span: number | null;
      total: number;
      done: number;
    }>(
      `SELECT e.id, e.key, e.title, e.color, e.t_start, e.t_span, c.total, c.done
         FROM (
           SELECT ch.epic_id,
                  count(*)::int AS total,
                  (count(*) FILTER (WHERE ws.category = 'done'))::int AS done
             FROM issues ch
             JOIN workflow_statuses ws ON ws.id = ch.status_id
            WHERE ch.project_id = $1 AND ch.archived_at IS NULL AND ch.epic_id IS NOT NULL
            GROUP BY ch.epic_id
         ) c
         JOIN issues e ON e.id = c.epic_id
        WHERE e.archived_at IS NULL
        ORDER BY e.rank, e.id
        LIMIT $2`,
      [project.id, limit + 1],
    );
    const truncated = rows.length > limit;
    return {
      items: (truncated ? rows.slice(0, limit) : rows).map((r): IssueEpicDto => ({
        id: r.id,
        key: r.key,
        title: r.title,
        color: r.color,
        tStart: r.t_start,
        tSpan: r.t_span,
        childTotal: r.total,
        childDone: r.done,
      })),
      truncated,
    };
  });

  /* ---------------------------------------------------------- создание */
  app.post(
    "/",
    { preHandler: requirePerm("create"), preValidation: zbody(IssueCreateBody) },
    async (req, reply) => {
      const project = req.project!;
      const body = req.body as z.infer<typeof IssueCreateBody>;
      const user = me(req);

      // Статус: заданный клиентом (с проверкой) или первый из категории todo
      let statusId = body.statusId ?? null;
      if (statusId) {
        const known = await one<{ id: string }>(
          `SELECT id FROM workflow_statuses WHERE id = $1 AND project_id = $2`,
          [statusId, project.id],
        );
        if (!known) throw badRequest("Статус не найден в проекте");
      } else {
        const first = await one<{ id: string }>(
          `SELECT id FROM workflow_statuses
            WHERE project_id = $1 AND category = 'todo'
            ORDER BY position LIMIT 1`,
          [project.id],
        );
        if (!first) throw notFound("В проекте нет статуса категории «todo» — проверьте workflow");
        statusId = first.id;
      }

      // Исполнители должны быть реальными участниками проекта — глобальный admin
      // больше не проходит "мимо" этой проверки (было: назначать можно было любого
      // admin'а даже без членства в проекте; см. ROLE_MIGRATION.md/аудит деплоя).
      const assigneeIds = [...new Set(body.assigneeIds)];
      await validateAssigneesInProject(project.id, assigneeIds);
      if (body.epicId) {
        const e = await one<{ id: string }>(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [body.epicId, project.id]);
        if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
      }
      // Как и epicId выше — проверяем ДО nextIssueNum(), чтобы неверный
      // parentId не сжигал номер CORP-N понапрасну в общем случае (ревью PR
      // #46). Не заменяет повторную проверку под локом в assignParentLocked
      // ниже — та остаётся единственным источником истины против гонки, эта
      // — только fail-fast вне её окна. Внутри самого окна гонки (кандидат
      // в родители успевает получить своего родителя/потомка между этим
      // прочтением без лока и вставкой под локом) precheck всё ещё может
      // пройти, а nextIssueNum() ниже уже сожжёт номер до того, как повторная
      // проверка под локом отклонит запрос — недействительное состояние
      // никогда не сохраняется, но номер в этом узком случае теряется
      // (ревью PR #46, второй раунд).
      if (body.parentId) await precheckParentAssignment(project.id, body.parentId);
      // Новая задача встаёт В НАЧАЛО колонки, а не в конец (аудит LIFE-05):
      // кнопка быстрого создания и поле ввода — вверху колонки, и задача,
      // упавшая вниз за экран, читается как «не создалась». beforeId = первая
      // живая задача колонки; её нет — computeRank сам вернёт стартовый ранг.
      const firstInColumn = await one<{ id: string }>(
        `SELECT id FROM issues
          WHERE status_id = $1 AND project_id = $2 AND archived_at IS NULL
          ORDER BY rank, id LIMIT 1`,
        [statusId, project.id],
      );
      const rank = await computeRank(statusId, firstInColumn?.id ?? null);
      const num = await nextIssueNum(project.id);
      const key = `${project.key}-${num}`;

      const insertSql = `INSERT INTO issues
             (project_id, num, key, title, description, type_id, status_id, priority_id,
              reporter_id, epic_id, parent_id, labels, complexity, due_date, rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *`;
      const insertVals = [
        project.id, num, key, body.title, body.description, body.typeId, statusId, body.priorityId,
        user.sub, body.epicId, body.parentId ?? null, body.labels, body.complexity,
        body.dueDate ?? null, rank,
      ];
      // parentId задан — валидация и INSERT идут одной транзакцией под
      // advisory-локом (см. assignParentLocked): иначе конкурентный запрос мог
      // бы протиснуться между проверкой «родитель — не подзадача» и записью.
      const createInTransaction = async (client: PoolClient) => {
        const res = await client.query<IssueRow>(insertSql, insertVals);
        const created = res.rows[0];
        await setAssignees(created.id, assigneeIds, user.sub, client);
        if (body.checklistItems.length > 0) {
          await client.query(
            `INSERT INTO checklist_items (issue_id, text, position)
             SELECT $1, item, ord::integer - 1
               FROM unnest($2::text[]) WITH ORDINALITY AS input(item, ord)`,
            [created.id, body.checklistItems],
          );
        }
        await logActivity(created.id, user.sub, "создал(а) задачу", client);
        return created;
      };
      const row = body.parentId
        ? await assignParentLocked(project.id, body.parentId, null, createInTransaction)
        : await withTransaction(createInTransaction);

      await audit(user.sub, "issue.create", "issue", row.id, { key });
      const checklist = body.checklistItems.length > 0 ? await listChecklistItems(row.id) : [];
      reply.code(201).send({ ...maskSprintId(mapIssue(row, assigneeIds), project.sprintsEnabled), checklist });
    },
  );

  /* ---------------------------------------------------------- чтение одной
     requireIssuePerm (не requirePerm): открывает fallback приглашённого
     (browse по этой задаче) и строже сверяет issue.project_id с путём. */
  app.get("/:id", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    return maskSprintId(await getIssueDto(project.id, id), project.sprintsEnabled);
  });

  /* ---------------------------------------------------------- история задачи
     Та же видимость, что у самой задачи (включая приглашённого). */
  app.get("/:id/activity", { preHandler: requireIssuePerm("browse") }, async (req) => {
    return listActivity(req.issueRef!.id);
  });

  /* ---------------------------------------------------------- правка полей */
  app.patch(
    "/:id",
    { preHandler: requireIssuePerm("edit"), preValidation: zbody(IssuePatchBody) },
    async (req) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof IssuePatchBody>;
      const iss = await loadIssue(project.id, id);
      const beforeAssigneeIds = await listAssigneeIds(iss.id);

      // Дедуп сразу — и для валидации, и для diff/записи ниже используем одно
      // и то же нормализованное значение (см. аналогичный комментарий в POST /issues).
      const newAssigneeIds = body.assigneeIds !== undefined ? [...new Set(body.assigneeIds)] : undefined;
      if (newAssigneeIds !== undefined) await validateAssigneesInProject(project.id, newAssigneeIds);
      if (body.epicId !== undefined && body.epicId !== null) {
        const e = await one<{ id: string }>(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [body.epicId, project.id]);
        if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => {
        vals.push(val);
        sets.push(`${col} = $${vals.length}`);
      };
      const log: string[] = [];

      if (body.title !== undefined && body.title !== iss.title) {
        push("title", body.title);
        log.push("переименовал(а) задачу");
      }
      if (body.description !== undefined && body.description !== iss.description) {
        push("description", body.description);
        log.push("обновил(а) описание");
      }
      if (body.priorityId !== undefined && body.priorityId !== iss.priority_id) {
        push("priority_id", body.priorityId);
        log.push(`изменил(а) приоритет: ${PRIORITY_NAMES[iss.priority_id]} → ${PRIORITY_NAMES[body.priorityId]}`);
      }
      // Исполнители (миграция 025) — не колонка issues, отдельная запись в
      // issue_assignees ниже, после того как известно, действительно ли
      // список изменился (added/removed для activity/уведомлений).
      let addedAssigneeIds: string[] = [];
      let removedAssigneeIds: string[] = [];
      if (newAssigneeIds !== undefined) {
        const beforeSet = new Set(beforeAssigneeIds);
        const afterSet = new Set(newAssigneeIds);
        addedAssigneeIds = newAssigneeIds.filter((x) => !beforeSet.has(x));
        removedAssigneeIds = beforeAssigneeIds.filter((x) => !afterSet.has(x));
        if (addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0) {
          const names = await q<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id = ANY($1)`, [
            [...addedAssigneeIds, ...removedAssigneeIds],
          ]);
          const nameOf = new Map(names.map((n) => [n.id, n.name]));
          for (const uid of addedAssigneeIds) log.push(`назначил(а) исполнителем ${nameOf.get(uid) ?? "?"}`);
          for (const uid of removedAssigneeIds) log.push(`снял(а) исполнителя ${nameOf.get(uid) ?? "?"}`);
        }
      }
      if (body.epicId !== undefined && body.epicId !== iss.epic_id) {
        push("epic_id", body.epicId);
        log.push("изменил(а) группу (эпик)");
      }
      // parentChanging — parentId реально меняется (не просто прислан тем же
      // значением). newParentId — ветка назначения НОВОГО родителя (нужна
      // повторная валидация под локом в assignParentLocked); isUnsettingParent —
      // ветка снятия (парentId → null; инвариант глубины она не затрагивает,
      // но собственный лок всё равно нужен — см. withIssueParentLock ниже).
      const parentChanging = body.parentId !== undefined && body.parentId !== iss.parent_id;
      const newParentId = parentChanging && body.parentId !== null ? body.parentId : null;
      const isUnsettingParent = parentChanging && body.parentId === null;
      if (parentChanging) {
        push("parent_id", body.parentId);
        log.push(body.parentId ? "сделал(а) подзадачей другой задачи" : "убрал(а) из подзадач");
      }
      if (body.labels !== undefined && JSON.stringify(body.labels) !== JSON.stringify(iss.labels)) {
        push("labels", body.labels);
        log.push("обновил(а) метки");
      }
      if (body.complexity !== undefined && body.complexity !== iss.complexity) {
        push("complexity", body.complexity);
        log.push(
          `изменил(а) сложность: ${COMPLEXITY_NAMES[iss.complexity ?? ""] ?? "—"} → ${COMPLEXITY_NAMES[body.complexity ?? ""] ?? "—"}`,
        );
      }
      if (body.dueDate !== undefined && body.dueDate !== iss.due_date) {
        push("due_date", body.dueDate);
        log.push(`изменил(а) срок: ${iss.due_date ?? "—"} → ${body.dueDate ?? "—"}`);
      }
      if (body.tStart !== undefined) push("t_start", body.tStart);
      if (body.tSpan !== undefined) push("t_span", body.tSpan);
      if (body.color !== undefined) push("color", body.color);

      // Исполнители — отдельная таблица (миграция 025), не участвуют в sets
      // (issues-колонках), поэтому "пустой патч" проверяем по обоим сразу.
      if (sets.length === 0 && newAssigneeIds === undefined) {
        return maskSprintId(mapIssue(iss, beforeAssigneeIds), project.sprintsEnabled);
      }

      let updateSql: string | null = null;
      if (sets.length > 0) {
        vals.push(iss.id);
        updateSql = `UPDATE issues SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`;
      }
      const mutate = async (client: PoolClient): Promise<IssueRow> => {
        const row = updateSql ? (await client.query<IssueRow>(updateSql, vals)).rows[0] : iss;
        if (newAssigneeIds !== undefined && (addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0)) {
          await setAssignees(iss.id, newAssigneeIds, user.sub, client);
        }
        for (const text of log) await logActivity(iss.id, user.sub, text, client);
        return row;
      };
      // Поля задачи, полный список исполнителей и activity фиксируются одним
      // коммитом; parent-ветки дополнительно используют прежние advisory locks.
      const row = newParentId
        ? await assignParentLocked(project.id, newParentId, iss.id, mutate)
        : isUnsettingParent
          ? await withIssueParentLock(iss.id, mutate)
          : await withTransaction(mutate);

      await audit(user.sub, "issue.update", "issue", iss.id, { key: iss.key, fields: Object.keys(body) });

      // Уведомления (NOTIFICATIONS_MIGRATION.md D2) — только новым исполнителям,
      // не всему списку: снятие или уже назначенных повторно пинговать не за что.
      if (addedAssigneeIds.length > 0) {
        await emit({
          type: "issue.assigned",
          actorId: user.sub,
          projectId: project.id,
          issueId: iss.id,
          recipientIds: addedAssigneeIds,
          payload: { key: iss.key, title: row.title },
        });
      }
      if (body.description !== undefined && body.description !== iss.description) {
        // Уведомляем только НОВЫЕ упоминания — правка описания (фикс опечатки)
        // не должна повторно пинговать уже упомянутых (review PR #19).
        const was = new Set(parseMentions(iss.description));
        const added = parseMentions(body.description).filter((l) => !was.has(l));
        const mentionIds = await resolveVisibleMentions(project.id, iss.id, added);
        if (mentionIds.length > 0) {
          await emit({
            type: "issue.mention",
            actorId: user.sub,
            projectId: project.id,
            issueId: iss.id,
            recipientIds: mentionIds,
            payload: { key: iss.key, title: row.title, in: "description" },
          });
        }
      }
      return maskSprintId(mapIssue(row, newAssigneeIds ?? beforeAssigneeIds), project.sprintsEnabled);
    },
  );

  /* ---------------------------------------------------------- удаление */
  app.delete(
    "/:id",
    { preHandler: requireIssuePerm("delete") },
    async (req, reply) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user = me(req);
      const iss = await loadIssue(project.id, id);
      // Ключи вложений собираем ДО удаления — каскад FK снесёт строки, но не файлы.
      const attachKeys = await storageKeysForIssue(iss.id);
      // Каскады: комментарии/activity/watchers/attachments; epic_id дочерних обнулится FK
      await q(`DELETE FROM issues WHERE id = $1`, [iss.id]);
      await deleteStorageObjects(attachKeys); // best-effort уборка хранилища (FILES_MIGRATION.md §5)
      await audit(user.sub, "issue.delete", "issue", iss.id, { key: iss.key });
      reply.code(204).send();
    },
  );

  /* ---------------------------------------------------------- смена статуса (workflow + ранг) */
  app.post(
    "/:id/transition",
    { preHandler: requireIssuePerm("transition"), preValidation: zbody(TransitionBody) },
    async (req) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof TransitionBody>;
      const iss = await loadIssue(project.id, id);

      if (body.beforeId) {
        const anchor = await one<{ status_id: string }>(`SELECT status_id FROM issues WHERE id = $1`, [body.beforeId]);
        if (!anchor) throw notFound("Задача-ориентир (beforeId) не найдена");
        if (anchor.status_id !== body.to) throw badRequest("Позиция «перед» указывает на задачу из другой колонки");
      }

      // Схема workflow — источник правды; нарушение даёт 409 CONFLICT
      await assertTransition(project.id, iss.status_id, body.to);

      const rank = await computeRank(body.to, body.beforeId ?? null, iss.id);
      const changed = iss.status_id !== body.to;

      // done_at (миграция 016): ставим при входе в категорию 'done', снимаем при
      // возврате в работу — переоткрытая и снова закрытая задача получает новую
      // дату закрытия, а не первую. Внутри самой категории 'done' (перенос между
      // двумя закрывающими статусами) дату НЕ трогаем — задача не «перезакрылась».
      const toCategory = await statusCategory(body.to);
      const wasDone = iss.done_at !== null;
      const nowDone = toCategory === "done";
      const doneSql = nowDone ? (wasDone ? "done_at" : "now()") : "NULL";
      // Из архива задача выходит автоматически, как только снова становится живой.
      const archivedSql = nowDone ? "archived_at" : "NULL";

      const row = (
        await q<IssueRow>(
          `UPDATE issues
              SET status_id = $1, rank = $2, updated_at = now(),
                  done_at = ${doneSql}, archived_at = ${archivedSql}
            WHERE id = $3 RETURNING *`,
          [body.to, rank, iss.id],
        )
      )[0];

      if (changed) {
        const [from, to] = [await statusName(iss.status_id), await statusName(body.to)];
        await logActivity(iss.id, user.sub, `переместил(а) из «${from}» в «${to}»`);
        await autoWatch(iss.id, user.sub);
        await emit({
          type: "issue.status",
          actorId: user.sub,
          projectId: project.id,
          issueId: iss.id,
          payload: { key: iss.key, title: iss.title, from, to },
        });
      }
      await audit(user.sub, "issue.transition", "issue", iss.id, { key: iss.key, from: iss.status_id, to: body.to });
      return maskSprintId(mapIssue(row, await listAssigneeIds(iss.id)), project.sprintsEnabled);
    },
  );

  /* ---------------------------------------------------------- подписка на задачу
     requireIssuePerm — приглашённый тоже может следить за своей задачей. */
  app.post("/:id/watchers/me", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    await q(`INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [iss.id, user.sub]);
    const n = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM issue_watchers WHERE issue_id = $1`, [iss.id]))!;
    await audit(user.sub, "watcher.add", "issue", iss.id, { key: iss.key, viaCollaborator: req.isCollaborator || undefined });
    return { watching: true, watchers: Number(n.n) };
  });

  app.delete("/:id/watchers/me", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    await q(`DELETE FROM issue_watchers WHERE issue_id = $1 AND user_id = $2`, [iss.id, user.sub]);
    const n = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM issue_watchers WHERE issue_id = $1`, [iss.id]))!;
    await audit(user.sub, "watcher.remove", "issue", iss.id, { key: iss.key, viaCollaborator: req.isCollaborator || undefined });
    return { watching: false, watchers: Number(n.n) };
  });

  /* ---------------------------------------------------------- связи между задачами
     (issue_links, миграция 014, ticket §3.2). Линковать может тот, у кого есть
     `edit` на ЭТУ задачу (:id); обе задачи должны быть в проекте (single-project),
     иначе 404 — не раскрываем существование чужих задач.
     `type` в теле — направление со стороны :id. 'blocked_by' раскладывается в
     строку 'blocks' от блокирующей задачи к :id, но запрос всё равно идёт на
     /issues/:id/links и ответ — связи :id, чтобы клиент обновлял открытую
     карточку независимо от направления (см. review PR #27). */
  app.post(
    "/:id/links",
    { preHandler: requireIssuePerm("edit"), preValidation: zbody(IssueLinkCreateBody) },
    async (req) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof IssueLinkCreateBody>;

      const iss = await loadIssue(project.id, id);
      if (body.linkedIssueId === iss.id) throw badRequest("Нельзя связать задачу с самой собой");
      const other = await one<{ id: string; key: string }>(
        `SELECT id, key FROM issues WHERE id = $1 AND project_id = $2`,
        [body.linkedIssueId, project.id],
      );
      if (!other) throw notFound("Связываемая задача не найдена в проекте");

      // Хранимый тип и направление вставки. 'blocked_by' → 'blocks' наоборот.
      const stored = body.type === "relates" ? "relates" : "blocks";
      const [fromId, toId] = body.type === "blocked_by" ? [other.id, iss.id] : [iss.id, other.id];

      if (await linkExists(iss.id, other.id, stored)) throw badRequest("Такая связь уже есть");

      const linkId = await insertIssueLink(fromId, toId, stored, user.sub);
      await logActivity(
        iss.id,
        user.sub,
        body.type === "blocks"
          ? `отметил(а), что задача блокирует ${other.key}`
          : body.type === "blocked_by"
            ? `отметил(а), что задача заблокирована ${other.key}`
            : `связал(а) с ${other.key}`,
      );
      await audit(user.sub, "issue.link.add", "issue", iss.id, { key: iss.key, to: other.key, type: body.type });
      return { id: linkId, links: await listIssueLinks(iss.id) };
    },
  );

  app.delete(
    "/:id/links/:linkId",
    { preHandler: requireIssuePerm("edit"), preValidation: zparams(IssueLinkParams) },
    async (req) => {
      const project = req.project!;
      const { id, linkId } = req.params as { id: string; linkId: string };
      const user = me(req);
      const iss = await loadIssue(project.id, id);
      // Удалять можно с любого конца связи, но только если этот конец — наша задача.
      const del = await one<{ id: string }>(
        `DELETE FROM issue_links
          WHERE id = $1 AND (issue_id = $2 OR linked_issue_id = $2)
          RETURNING id`,
        [linkId, iss.id],
      );
      if (!del) throw notFound("Связь не найдена");
      await audit(user.sub, "issue.link.remove", "issue", iss.id, { key: iss.key, linkId });
      return { links: await listIssueLinks(iss.id) };
    },
  );

  /* ---------------------------------------------------------- чек-лист (checklist_items,
     миграция 019). Тем же правом `edit` на задачу, что и links/поля — отдельной
     модели прав нет. Activity логируем только на добавление/удаление пункта,
     не на каждый чек/анчек — иначе лента задачи тонет в «отметил(а) галочку». */
  app.post(
    "/:id/checklist",
    { preHandler: requireIssuePerm("edit"), preValidation: zbody(ChecklistItemCreateBody) },
    async (req) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user = me(req);
      const body = req.body as z.infer<typeof ChecklistItemCreateBody>;

      const iss = await loadIssue(project.id, id);
      if ((await countChecklistItems(iss.id)) >= LIMITS.checklistItemsPerIssue) {
        throw badRequest(`В чек-листе не может быть больше ${LIMITS.checklistItemsPerIssue} пунктов`);
      }
      const item = await createChecklistItem(iss.id, body.text);
      await logActivity(iss.id, user.sub, `добавил(а) пункт чек-листа «${body.text}»`);
      await audit(user.sub, "issue.checklist.add", "issue", iss.id, { key: iss.key, itemId: item.id });
      return { item, checklist: await listChecklistItems(iss.id) };
    },
  );

  app.patch(
    "/:id/checklist/:itemId",
    { preHandler: requireIssuePerm("edit"), preValidation: [zparams(ChecklistItemParams), zbody(ChecklistItemPatchBody)] },
    async (req) => {
      const project = req.project!;
      const { id, itemId } = req.params as { id: string; itemId: string };
      const body = req.body as z.infer<typeof ChecklistItemPatchBody>;

      const iss = await loadIssue(project.id, id);
      if (!(await getChecklistItemInIssue(iss.id, itemId))) throw notFound("Пункт чек-листа не найден");
      const item = await updateChecklistItem(itemId, body);
      return { item, checklist: await listChecklistItems(iss.id) };
    },
  );

  app.delete(
    "/:id/checklist/:itemId",
    { preHandler: requireIssuePerm("edit"), preValidation: zparams(ChecklistItemParams) },
    async (req) => {
      const project = req.project!;
      const { id, itemId } = req.params as { id: string; itemId: string };
      const user = me(req);
      const iss = await loadIssue(project.id, id);
      const existing = await getChecklistItemInIssue(iss.id, itemId);
      if (!existing) throw notFound("Пункт чек-листа не найден");
      await deleteChecklistItem(itemId);
      await logActivity(iss.id, user.sub, "удалил(а) пункт чек-листа");
      await audit(user.sub, "issue.checklist.remove", "issue", iss.id, { key: iss.key, itemId });
      return { checklist: await listChecklistItems(iss.id) };
    },
  );

  /* ---------------------------------------------------------- значения пользовательских
     полей (custom_field_values, миграция 020). Определения полей — GET/POST/PATCH/DELETE
     /projects/:projectId/custom-fields (routes/customFields.ts, право editWorkflow);
     здесь — только значение НА ЭТОЙ задаче, тем же `edit`, что приоритет/сложность/метки. */
  app.put(
    "/:id/custom-fields/:fieldId",
    { preHandler: requireIssuePerm("edit"), preValidation: [zparams(CustomFieldParams), zbody(CustomFieldValueBody)] },
    async (req) => {
      const project = req.project!;
      const { id, fieldId } = req.params as { id: string; fieldId: string };
      const body = req.body as z.infer<typeof CustomFieldValueBody>;

      const iss = await loadIssue(project.id, id);
      const field = await getCustomFieldInProject(project.id, fieldId);
      if (!field) throw notFound("Поле не найдено");

      const value = body.value === null ? null : validateValueForField(field, body.value);
      await setCustomFieldValue(fieldId, iss.id, value);
      return { values: await listValuesForIssue(iss.id) };
    },
  );

  /* ---------------------------------------------------------- назначение в спринт
     (issues.sprint_id, миграция 023) — отдельным роутом, а не веткой общего
     PATCH /:id: право manageSprints (admin/manager) — сильнее edit, которым
     гейтится весь остальной PATCH, и общий обработчик не умеет требовать
     разное право на разные поля одного тела. Тот же выбор, что уже сделан
     для чек-листа/полей/связей — отдельный под-роут вместо инлайн-ветки в
     PATCH /:id (в отличие от удалённой миграцией 012 версии, где sprintId
     менялся и через общий PATCH тоже — не воспроизводим эту избыточность,
     см. SPRINTS_MIGRATION.md). sprintId=null снимает задачу со спринта. */
  app.patch(
    "/:id/sprint",
    { preHandler: requireIssuePerm("manageSprints", assertSprintsEnabled), preValidation: zbody(MoveToSprintBody) },
    async (req) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof MoveToSprintBody>;
      const user = me(req);

      const iss = await loadIssue(project.id, id);
      let row: IssueRow;
      if (body.sprintId) {
        // Быстрый пречек вне лока — как и везде в этом кодовой базе
        // (precheckParentAssignment и т.п.), это только честный fail-fast
        // на случай несуществующего/чужого sprintId, НЕ защита от гонки:
        // существование/принадлежность спринта проекту между этим SELECT и
        // UPDATE ниже не меняется.
        const sprintId = body.sprintId;
        const sprint = await getSprintInProject(project.id, sprintId);
        if (!sprint) throw notFound("Спринт не найден в проекте");
        // advisory-лок на sprintId — тот же ключ, что берёт completeSprint()
        // (services/sprints.ts). Одиночная проверка status<>'completed' в
        // WHERE UPDATE закрывает гонку только ВНУТРИ этого запроса; под READ
        // COMMITTED конкурентный completeSprint() мог ещё не закоммититься,
        // и без общего лока EXISTS ниже читал бы его старый ('active') снимок
        // — задача получила бы sprint_id уже завершённого спринта (ревью PR
        // #49, седьмой раунд). Общий ключ с completeSprint() сериализует
        // обоих через одну и ту же транзакцию, а не гонку снимков.
        const rows = await withAdvisoryLocks([sprintId], async (client) => {
          const res = await client.query<IssueRow>(
            `UPDATE issues SET sprint_id = $2
                WHERE id = $1
                  AND EXISTS (SELECT 1 FROM sprints WHERE id = $2 AND project_id = $3 AND status <> 'completed')
              RETURNING *`,
            [iss.id, sprintId, project.id],
          );
          return res.rows;
        });
        // 0 строк — спринт прошёл precheck выше, но стал completed до захвата
        // лока (completeSprint выполнился первым и уже закоммитился); иных
        // причин не осталось — существование/проект уже проверены, а задача
        // только что успешно прочитана loadIssue().
        if (rows.length === 0) throw badRequest("Нельзя добавить задачу в завершённый спринт");
        row = rows[0];
      } else {
        // Снятие со спринта не завязано на его состояние — лок не нужен,
        // как и withIssueParentLock не нужен для снятия parentId.
        row = (await q<IssueRow>(`UPDATE issues SET sprint_id = NULL WHERE id = $1 RETURNING *`, [iss.id]))[0];
      }
      await audit(user.sub, "issue.sprint.move", "issue", iss.id, { key: iss.key, sprintId: body.sprintId });
      return mapIssue(row, await listAssigneeIds(iss.id));
    },
  );
}


