/**
 * Задачи: CRUD, смена статуса по workflow, подписка (watchers).
 * Все мутации защищены правами на сервере; ранги и переходы — только после проверок.
 */
import type { FastifyInstance } from "fastify";
import { markStep } from "../services/onboarding.js";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { withTransaction } from "../db.js";
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
import { auditFromRequest } from "../audit.js";
import { createIssueRecurrenceInTx } from "../services/issueAutomation.js";
import { setIssueReminder, validateReminder } from "../services/issueReminders.js";
import { roleCan } from "../permissions.js";
import { forbidden } from "../middleware.js";
import { assertValidTiming } from "../services/recurrence.js";
import { createIssueInTx, prepareIssueCreate } from "../services/issueCreate.js";
import { transitionIssue } from "../services/issueTransition.js";
import {
  assignParentLocked,
  assertSelfAssignment,
  deleteIssue,
  findIssueInProject,
  getIssueDto,
  listActivity,
  listAssigneeIds,
  loadIssue,
  logActivity,
  mapIssue,
  maskSprintId,
  nextIssueNum,
  precheckParentAssignment,
  setWatching,
  type IssueRow,
} from "../services/issues.js";
import {
  countIssueAssignees,
  countIssuesByStatus,
  elapsedMs,
  listEpics,
  listIssuesPage,
  type IssueListTiming,
} from "../services/issueList.js";
import { notifyIssuePatched, patchIssue } from "../services/issueUpdate.js";
import { deleteIssueLink, insertIssueLink, linkExists, listIssueLinks } from "../services/issueLinks.js";
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
import { emit, autoWatch } from "../services/notify.js";
import { assertSprintsEnabled, assignIssueToSprint, getSprintInProject, removeIssueFromSprint } from "../services/sprints.js";
import { loadConfig } from "../config.js";
import { createTtlCache } from "../services/ttlCache.js";
import type { IssueAssigneesDto, IssueCountsDto, IssueEpicsDto } from "../contract.js";
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
  IssueLinkCreateBody,
  IssueLinkParams,
  IssuePatchBody,
  IssueQuery,
  LIMITS,
  MoveToSprintBody,
  TransitionBody,
} from "../contract.js";

const me = (req: { user: JwtPayload }) => req.user;

const PERF_TRACE = process.env.PERF_TRACE === "1";

interface IssueListPerfTrace extends IssueListTiming {
  permissionMs?: number;
  queryValidationMs?: number;
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

      return reply.send(await listIssuesPage(project, f, trace));
    },
  );

  /* ------------------------------------------------ счётчики по статусам */
  // Тот же набор фильтров, что у списка. Один запрос на набор: клиент берёт
  // отсюда общее число и заголовки колонок доски, а не считает загруженное.
  // Идёт по idx_issues_active (project_id, status_id, rank) WHERE archived_at IS NULL.
  app.get("/counts", { preHandler: [issueListPermission, zquery(IssueCountsQuery)] }, async (req): Promise<IssueCountsDto> => {
    const project = req.project!;
    const f = req.query as z.infer<typeof IssueCountsQuery>;
    return countIssuesByStatus(project, f);
  });

  /* ------------------------------------------- исполнители (для фильтра доски) */
  app.get("/assignees", { preHandler: [issueListPermission, zquery(IssueAssigneesQuery)] }, async (req): Promise<IssueAssigneesDto> => {
    const project = req.project!;
    const { limit } = req.query as z.infer<typeof IssueAssigneesQuery>;
    // Агрегат по всем назначениям проекта (на 50 тыс. задач — 65 мс и Seq Scan), а список нужен лишь для
    // аватарок фильтра: точность «на эту секунду» не нужна, поэтому кэш на процесс на короткое время.
    // Результат не зависит от пользователя (только проект и лимит), поэтому ключ — без пользователя.
    return assigneesCache.get(`${project.id}:${limit}`, () => countIssueAssignees(project.id, limit));
  });

  /* ------------------------------------------------ направления (эпики) */
  // «Эпик» — задача, на которую ссылается чей-то epic_id (миграция 002). Возвращает
  // только активные направления с активными детьми: число детей и сколько из них
  // закрыто (по категории статуса). Счётчики лежат на строке направления и
  // поддерживаются триггерами (EPIC-01, миграция 20260930T0500) — раньше здесь был
  // агрегат по всем детям проекта, дорогой при большой доле задач под направлениями.
  // Фильтр по проекту — на самом направлении: ребёнок всегда в проекте направления (epicId проверяется
  // `project_id = $2` при создании и в PATCH, других путей записи epic_id нет), поэтому ответ тот же.
  app.get("/epics", { preHandler: [issueListPermission, zquery(IssueEpicsQuery)] }, async (req): Promise<IssueEpicsDto> => {
    const project = req.project!;
    const { limit } = req.query as z.infer<typeof IssueEpicsQuery>;
    return listEpics(project.id, limit);
  });

  /* ---------------------------------------------------------- создание */
  app.post(
    "/",
    { preHandler: requirePerm("create"), preValidation: zbody(IssueCreateBody) },
    async (req, reply) => {
      const project = req.project!;
      const body = req.body as z.infer<typeof IssueCreateBody>;
      const user = me(req);

      if (body.recurrence) {
        if (!roleCan(req.projectRole ?? null, "manageRecurring")) throw forbidden("Нет права управлять повторениями");
        assertValidTiming(body.recurrence);
      }
      if (body.remindAt) validateReminder(body.remindAt);
      if (req.projectRole === "employee") assertSelfAssignment(user.sub, [], body.assigneeIds);
      const prepared = await prepareIssueCreate(project, body);
      const assigneeIds = prepared.assigneeIds;
      // Как и epicId в prepareIssueCreate — проверяем ДО nextIssueNum(), чтобы неверный
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
      const num = await nextIssueNum(project.id);
      const key = `${project.key}-${num}`;
      // Проверка родителя остаётся в assignParentLocked; INSERT сразу содержит связь.
      const createInTransaction = async (client: PoolClient) => {
        const row = await createIssueInTx(client, project, body, user.sub, { num, prepared, parentId: body.parentId });
        if (body.recurrence) await createIssueRecurrenceInTx(client, project, row, body.recurrence, user.sub);
        if (body.remindAt) await setIssueReminder(client, row.id, user.sub, body.remindAt);
        return row;
      };
      const row = body.parentId
        ? await assignParentLocked(project.id, body.parentId, null, createInTransaction)
        : await withTransaction(createInTransaction);

      await auditFromRequest(req, "issue.create", "issue", row.id, { key });
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
    // «Начало работы» (ТЗ 5.11): открыл свою задачу — ту, где он исполнитель.
    if (req.issueRef?.assigneeIds.includes(me(req).sub)) await markStep(me(req).sub, "open_issue");
    return maskSprintId(await getIssueDto(project.id, id, me(req).sub), project.sprintsEnabled);
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
      const result = await patchIssue(project, id, body, { id: user.sub, role: req.projectRole });
      const dto = maskSprintId(mapIssue(result.row, result.assigneeIds), project.sprintsEnabled);
      if (result.noop) return dto;
      const iss = result.issue;
      await auditFromRequest(req, "issue.update", "issue", iss.id, { key: iss.key, fields: Object.keys(body).filter(key => key !== "expectedUpdatedAt" && key !== "expectedVersion") });
      await notifyIssuePatched(project.id, user.sub, body, result);
      return { ...dto, ...(result.undo ? { undo: result.undo } : {}) };
    },
  );

  /* ---------------------------------------------------------- удаление */
  app.delete(
    "/:id",
    { preHandler: requireIssuePerm("delete") },
    async (req, reply) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const iss = await loadIssue(project.id, id);
      await deleteIssue(iss.id);
      await auditFromRequest(req, "issue.delete", "issue", iss.id, { key: iss.key });
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
      const { previous: iss, row, changed, from, to } = await transitionIssue(
        project.id, id, body.to, body.beforeId ?? null, user.sub, true, body.expectedUpdatedAt, body.expectedVersion,
      );

      if (changed) {
        await autoWatch(iss.id, user.sub);
        await emit({
          type: "issue.status",
          actorId: user.sub,
          projectId: project.id,
          issueId: iss.id,
          payload: { key: iss.key, title: iss.title, from, to },
        });
        await markStep(user.sub, "change_status");
      }
      await auditFromRequest(req, "issue.transition", "issue", iss.id, { key: iss.key, from: iss.status_id, to: body.to });
      return { ...maskSprintId(mapIssue(row, await listAssigneeIds(iss.id)), project.sprintsEnabled),
        ...(changed ? { undo: { issueId: iss.id, statusId: iss.status_id, updatedAt: new Date(row.updated_at).toISOString() } } : {}) };
    },
  );

  /* ---------------------------------------------------------- подписка на задачу
     requireIssuePerm — приглашённый тоже может следить за своей задачей. */
  app.post("/:id/watchers/me", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    const watchers = await setWatching(iss.id, user.sub, true);
    await auditFromRequest(req, "watcher.add", "issue", iss.id, { key: iss.key, viaCollaborator: req.isCollaborator || undefined });
    return { watching: true, watchers };
  });

  app.delete("/:id/watchers/me", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    const user = me(req);
    const iss = await loadIssue(project.id, id);
    const watchers = await setWatching(iss.id, user.sub, false);
    await auditFromRequest(req, "watcher.remove", "issue", iss.id, { key: iss.key, viaCollaborator: req.isCollaborator || undefined });
    return { watching: false, watchers };
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
      const other = await findIssueInProject(project.id, body.linkedIssueId);
      if (!other) throw notFound("Связываемая задача не найдена в проекте");

      // Хранимый тип и направление вставки. 'blocked_by' → 'blocks' наоборот.
      const stored = body.type === "relates" ? "relates" : "blocks";
      const [fromId, toId] = body.type === "blocked_by" ? [other.id, iss.id] : [iss.id, other.id];

      if (await linkExists(iss.id, other.id, stored)) throw badRequest("Такая связь уже есть");

      const linkId = await insertIssueLink(fromId, toId, stored, user.sub);
      await logActivity(iss.id, user.sub, { kind: "link", type: body.type, key: other.key });
      await auditFromRequest(req, "issue.link.add", "issue", iss.id, { key: iss.key, to: other.key, type: body.type });
      return { id: linkId, links: await listIssueLinks(iss.id) };
    },
  );

  app.delete(
    "/:id/links/:linkId",
    { preHandler: requireIssuePerm("edit"), preValidation: zparams(IssueLinkParams) },
    async (req) => {
      const project = req.project!;
      const { id, linkId } = req.params as { id: string; linkId: string };
      const iss = await loadIssue(project.id, id);
      // Удалять можно с любого конца связи, но только если этот конец — наша задача.
      const del = await deleteIssueLink(linkId, iss.id);
      if (!del) throw notFound("Связь не найдена");
      await auditFromRequest(req, "issue.link.remove", "issue", iss.id, { key: iss.key, linkId });
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
      await logActivity(iss.id, user.sub, { kind: "checklistAdded", text: body.text });
      await auditFromRequest(req, "issue.checklist.add", "issue", iss.id, { key: iss.key, itemId: item.id });
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
      await logActivity(iss.id, user.sub, { kind: "checklistRemoved" });
      await auditFromRequest(req, "issue.checklist.remove", "issue", iss.id, { key: iss.key, itemId });
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
      await setCustomFieldValue(fieldId, iss.id, value, body.expectedValue);
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
        const rows = await assignIssueToSprint(iss.id, sprintId, project.id);
        // 0 строк — спринт прошёл precheck выше, но стал completed до захвата
        // лока (completeSprint выполнился первым и уже закоммитился); иных
        // причин не осталось — существование/проект уже проверены, а задача
        // только что успешно прочитана loadIssue().
        if (rows.length === 0) throw badRequest("Нельзя добавить задачу в завершённый спринт");
        row = rows[0];
      } else {
        // Снятие со спринта не завязано на его состояние — лок не нужен,
        // как и withIssueParentLock не нужен для снятия parentId.
        row = await removeIssueFromSprint(iss.id);
      }
      await auditFromRequest(req, "issue.sprint.move", "issue", iss.id, { key: iss.key, sprintId: body.sprintId });
      return mapIssue(row, await listAssigneeIds(iss.id));
    },
  );
}


