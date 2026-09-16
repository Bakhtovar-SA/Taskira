/**
 * Задачи: CRUD, смена статуса по workflow, подписка (watchers).
 * Все мутации защищены правами на сервере; ранги и переходы — только после проверок.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { escLike, one, q } from "../db.js";
import {
  badRequest,
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
import {
  ChecklistItemCreateBody,
  ChecklistItemParams,
  ChecklistItemPatchBody,
  CustomFieldParams,
  CustomFieldValueBody,
  IssueCreateBody,
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

export async function issuesRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------- список с фильтрами */
  app.get(
    "/",
    { preHandler: [requirePerm("browse"), zquery(IssueQuery)] },
    async (req, reply) => {
      const project = req.project!;
      const f = req.query as z.infer<typeof IssueQuery>;

      // Архив (миграция 016) из активного набора исключён по умолчанию: доска и
      // «Список задач» показывают живые задачи. ?archived=1 — только архивные,
      // ?archived=all — всё вместе (для отчётов и сквозного поиска).
      const clauses: string[] = ["i.project_id = $1"];
      if (f.archived === "1") clauses.push("i.archived_at IS NOT NULL");
      else if (f.archived !== "all") clauses.push("i.archived_at IS NULL");
      const params: unknown[] = [project.id];
      const add = (clause: string, ...vals: unknown[]) => {
        for (const v of vals) {
          params.push(v);
          clause = clause.replace("?", `$${params.length}`);
        }
        clauses.push(clause);
      };

      if (f.status) add("i.status_id = ?", f.status);
      if (f.assignee) add("EXISTS (SELECT 1 FROM issue_assignees ia WHERE ia.issue_id = i.id AND ia.user_id = ?)", f.assignee);
      if (f.type) add("i.type_id = ?", f.type);
      if (f.q) add("(i.title ILIKE ? OR i.key ILIKE ?)", `%${escLike(f.q)}%`, `%${escLike(f.q)}%`);
      if (f.dueFrom) add("i.due_date >= ?", f.dueFrom);
      if (f.dueTo) add("i.due_date <= ?", f.dueTo);
      if (f.overdue) clauses.push("i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND ws.category <> 'done'");

      const where = clauses.join(" AND ");
      const total = (
        await one<{ n: string }>(
          `SELECT count(*)::text AS n FROM issues i
             JOIN workflow_statuses ws ON ws.id = i.status_id
            WHERE ${where}`,
          params,
        )
      )!;
      params.push(f.limit, f.offset);
      const rows = await q<IssueRow>(
        `SELECT i.* FROM issues i
           JOIN workflow_statuses ws ON ws.id = i.status_id
          WHERE ${where}
          ORDER BY i.rank, i.id
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const assigneesByIssue = await listAssigneeIdsBatch(rows.map((r) => r.id));
      reply.send({
        items: rows.map((r) => maskSprintId(mapIssue(r, assigneesByIssue.get(r.id) ?? []), project.sprintsEnabled)),
        total: Number(total.n),
      });
    },
  );

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
      const row = body.parentId
        ? await assignParentLocked(project.id, body.parentId, null, async (client) => {
            const res = await client.query<IssueRow>(insertSql, insertVals);
            return res.rows[0];
          })
        : (await q<IssueRow>(insertSql, insertVals))[0];
      if (assigneeIds.length > 0) await setAssignees(row.id, assigneeIds, user.sub);

      await logActivity(row.id, user.sub, "создал(а) задачу");
      await audit(user.sub, "issue.create", "issue", row.id, { key });
      reply.code(201).send(maskSprintId(mapIssue(row, assigneeIds), project.sprintsEnabled));
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

      let row: IssueRow;
      if (sets.length > 0) {
        vals.push(iss.id);
        const updateSql = `UPDATE issues SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`;
        // Назначение нового родителя — валидация и сам UPDATE одной транзакцией
        // под advisory-локом (см. assignParentLocked в services/issues.ts):
        // иначе два конкурентных PATCH могли пройти проверку по устаревшим
        // данным и вместе создать вложенность в 3 уровня (PR #46 review).
        row = newParentId
          ? await assignParentLocked(project.id, newParentId, iss.id, async (client) => {
              const res = await client.query<IssueRow>(updateSql, vals);
              return res.rows[0];
            })
          : isUnsettingParent
            ? await withIssueParentLock(iss.id, async (client) => {
                const res = await client.query<IssueRow>(updateSql, vals);
                return res.rows[0];
              })
            : (await q<IssueRow>(updateSql, vals))[0];
      } else {
        // Ни одно поле самой issues-строки не меняется — только исполнители.
        row = iss;
      }
      if (newAssigneeIds !== undefined && (addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0)) {
        await setAssignees(iss.id, newAssigneeIds, user.sub);
      }

      for (const text of log) await logActivity(iss.id, user.sub, text);
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


