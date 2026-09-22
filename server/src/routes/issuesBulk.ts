/** Массовые операции (ТЗ 3.3, план v2 Трек 3): панель действий применяет РОВНО одно
 *  изменение ко всей выборке за раз — status/assignee/priority/delete (см. BulkIssueAction,
 *  contract.ts). Права — requireIssuePerm устроен под один :id в URL, здесь их много —
 *  поэтому роль резолвится ОДИН раз (req.projectRole, уже выставлен requirePerm("browse")
 *  ниже) и проверяется на КАЖДУЮ задачу отдельно через roleCan() напрямую (тот же
 *  примитив, которым requireIssuePerm пользуется внутри) — частичный успех, а не отказ
 *  по всему батчу из-за одной чужой задачи. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { q } from "../db.js";
import { badRequest, requirePerm, zbody, type JwtPayload } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { audit } from "../audit.js";
import { roleCan, type IssueRef } from "../permissions.js";
import { assertTransition, statusCategory, statusName } from "../services/workflow.js";
import { computeRank } from "../services/rank.js";
import { listAssigneeIdsBatch, logActivity, setAssignees, validateAssigneesInProject } from "../services/issues.js";
import { deleteStorageObjects, storageKeysForIssue } from "../services/attachments.js";
import { emit, autoWatch } from "../services/notify.js";
import { BulkIssueAction, BulkIssueResultDto } from "../contract.js";

const PRIORITY_NAMES: Record<string, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

/** Перм, которым проверяется КАЖДАЯ задача выборки — зеркалит то, чем защищены
 *  одиночные пути: PATCH /:id (priority/assigneeIds) — "edit", POST /:id/transition —
 *  "transition", DELETE /:id — "delete". */
const PERM_FOR_ACTION = {
  status: "transition",
  assignee: "edit",
  priority: "edit",
  delete: "delete",
} as const;

interface Row {
  id: string;
  key: string;
  title: string;
  status_id: string;
  priority_id: string;
  reporter_id: string;
}

/** Зеркалит POST /:id/transition (routes/issues.ts) — та же схема-проверка, тот же
 *  done_at/archived_at, тот же rank (в конец колонки — у массового переноса нет
 *  единой позиции "перед X", в отличие от drag&drop одной карточки). */
async function applyStatus(projectId: string, row: Row, toStatusId: string, actorId: string): Promise<void> {
  await assertTransition(projectId, row.status_id, toStatusId); // 409 ApiHttpError — ловится в цикле вызова
  if (row.status_id === toStatusId) return; // no-op, как и в одиночном переходе
  const rank = await computeRank(toStatusId, null, row.id);
  const toCategory = await statusCategory(toStatusId);
  const doneSql = toCategory === "done" ? "now()" : "NULL";
  const archivedSql = toCategory === "done" ? "archived_at" : "NULL";
  await q(
    `UPDATE issues SET status_id = $1, rank = $2, updated_at = now(), done_at = ${doneSql}, archived_at = ${archivedSql} WHERE id = $3`,
    [toStatusId, rank, row.id],
  );
  const [from, to] = [await statusName(row.status_id), await statusName(toStatusId)];
  await logActivity(row.id, actorId, `переместил(а) из «${from}» в «${to}»`);
  await autoWatch(row.id, actorId);
  await emit({ type: "issue.status", actorId, projectId, issueId: row.id, payload: { key: row.key, title: row.title, from, to } });
  // Тот же тип события, что у одиночного POST /:id/transition — обзор audit_log
  // не должен зависеть от того, каким путём задача сменила статус.
  await audit(actorId, "issue.transition", "issue", row.id, { key: row.key, from: row.status_id, to: toStatusId, bulk: true });
}

/** Зеркалит PATCH /:id assigneeIds-ветку — но всегда ЗАМЕНА списка одним значением
 *  (или пустым при "none"), не слияние: кнопка "назначить X" — предсказуемое действие
 *  для выборки из N задач с разными текущими исполнителями. */
async function applyAssignee(projectId: string, row: Row, assigneeId: string, actorId: string): Promise<void> {
  const before = await listAssigneeIdsBatch([row.id]);
  const beforeIds = before.get(row.id) ?? [];
  const afterIds = assigneeId === "none" ? [] : [assigneeId];
  if (JSON.stringify([...beforeIds].sort()) === JSON.stringify([...afterIds].sort())) return; // no-op
  await setAssignees(row.id, afterIds, actorId);
  const added = afterIds.filter((x) => !beforeIds.includes(x));
  if (added.length > 0) {
    await emit({ type: "issue.assigned", actorId, projectId, issueId: row.id, recipientIds: added, payload: { key: row.key, title: row.title } });
  }
  await logActivity(row.id, actorId, assigneeId === "none" ? "снял(а) исполнителя (массовая операция)" : "назначил(а) исполнителя (массовая операция)");
  await audit(actorId, "issue.update", "issue", row.id, { key: row.key, fields: ["assigneeIds"], bulk: true });
}

async function applyPriority(row: Row, priorityId: string, actorId: string): Promise<void> {
  if (row.priority_id === priorityId) return; // no-op
  await q(`UPDATE issues SET priority_id = $1, updated_at = now() WHERE id = $2`, [priorityId, row.id]);
  await logActivity(row.id, actorId, `изменил(а) приоритет: ${PRIORITY_NAMES[row.priority_id]} → ${PRIORITY_NAMES[priorityId]} (массовая операция)`);
  await audit(actorId, "issue.update", "issue", row.id, { key: row.key, fields: ["priorityId"], bulk: true });
}

/** Зеркалит DELETE /:id — вложения собираются ДО каскадного удаления строки. */
async function applyDelete(row: Row, actorId: string): Promise<void> {
  const attachKeys = await storageKeysForIssue(row.id);
  await q(`DELETE FROM issues WHERE id = $1`, [row.id]);
  await deleteStorageObjects(attachKeys);
  await audit(actorId, "issue.delete", "issue", row.id, { key: row.key, bulk: true });
}

export async function issuesBulkRoutes(app: FastifyInstance): Promise<void> {
  app.patch(
    "/bulk",
    { preHandler: requirePerm("browse"), preValidation: zbody(BulkIssueAction) },
    async (req): Promise<BulkIssueResultDto> => {
      const project = req.project!;
      const user: JwtPayload = req.user;
      const body = req.body as z.infer<typeof BulkIssueAction>;
      const role = req.projectRole ?? null; // уже вычислена requirePerm("browse") выше (?? — только для типа, она всегда установлена)

      // Один запрос вместо N: задачи не из ЭТОГО проекта просто не попадут в
      // выборку — они окажутся среди "пропущенных" ниже, не дав заглянуть в
      // чужой проект по id.
      const dedupIds = [...new Set(body.issueIds)];
      const rows = await q<Row>(
        `SELECT id, key, title, status_id, priority_id, reporter_id FROM issues WHERE id = ANY($1) AND project_id = $2`,
        [dedupIds, project.id],
      );
      const assigneesByIssue = await listAssigneeIdsBatch(rows.map((r) => r.id));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const perm = PERM_FOR_ACTION[body.action];
      const succeeded: string[] = [];
      const failed: { issueId: string; reason: string }[] = [];

      // action=assignee: назначаемый пользователь один на весь батч — валидируем
      // членство ОДИН раз, а не на каждую задачу выборки.
      if (body.action === "assignee" && body.assigneeId !== "none") {
        try {
          await validateAssigneesInProject(project.id, [body.assigneeId]);
        } catch (e) {
          // Плохой assigneeId — запрос некорректен целиком (как и PATCH /:id с тем же телом),
          // а не "часть задач не прошла".
          throw e instanceof ApiHttpError ? e : badRequest("Исполнитель не найден в проекте");
        }
      }

      for (const issueId of dedupIds) {
        const row = byId.get(issueId);
        if (!row) {
          failed.push({ issueId, reason: "Задача не найдена в проекте" });
          continue;
        }
        const issueRef: IssueRef = { id: row.id, assigneeIds: assigneesByIssue.get(row.id) ?? [], reporterId: row.reporter_id };
        if (!roleCan(role, perm, { userId: user.sub, issue: issueRef })) {
          failed.push({ issueId, reason: "Нет прав на эту задачу" });
          continue;
        }
        try {
          if (body.action === "status") await applyStatus(project.id, row, body.statusId, user.sub);
          else if (body.action === "assignee") await applyAssignee(project.id, row, body.assigneeId, user.sub);
          else if (body.action === "priority") await applyPriority(row, body.priorityId, user.sub);
          else await applyDelete(row, user.sub);
          succeeded.push(issueId);
        } catch (e) {
          // Недопустимый переход (assertTransition — 409) — самый вероятный "живой"
          // отказ здесь: у разных задач в выборке разные текущие статусы, и не для
          // всех цель могла быть достижима по схеме. Остальные ошибки — тоже не
          // роняем весь батч, репортим как отказ по этой конкретной задаче.
          failed.push({ issueId, reason: e instanceof ApiHttpError ? e.message : "Не удалось применить изменение" });
        }
      }

      await audit(user.sub, "issue.bulkAction", "project", project.id, {
        action: body.action,
        requested: dedupIds.length,
        succeeded: succeeded.length,
        failed: failed.length,
      });
      return { succeeded, failed };
    },
  );
}
