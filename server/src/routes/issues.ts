/**
 * Задачи: CRUD, смена статуса по workflow, подписка (watchers).
 * Все мутации защищены правами на сервере; ранги и переходы — только после проверок.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import {
  badRequest,
  notFound,
  requireIssuePerm,
  requirePerm,
  zbody,
  zquery,
  type JwtPayload,
} from "../middleware.js";
import { audit } from "../audit.js";
import { assertTransition, statusName } from "../services/workflow.js";
import { computeRank } from "../services/rank.js";
import { getIssueDto, loadIssue, logActivity, mapIssue, nextIssueNum, type IssueRow } from "../services/issues.js";
import { storageKeysForIssue, deleteStorageObjects } from "../services/attachments.js";
import { emit, autoWatch } from "../services/notify.js";
import { parseMentions, resolveVisibleMentions } from "../services/mentions.js";
import {
  IssueCreateBody,
  IssuePatchBody,
  IssueQuery,
  TransitionBody,
} from "../contract.js";

const PRIORITY_NAMES: Record<string, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const escLike = (s: string) => s.replace(/[%_\\]/g, "\\$&");

const me = (req: { user: JwtPayload }) => req.user;

export async function issuesRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------- список с фильтрами */
  app.get(
    "/",
    { preHandler: [requirePerm("browse"), zquery(IssueQuery)] },
    async (req, reply) => {
      const project = req.project!;
      const f = req.query as z.infer<typeof IssueQuery>;

      const clauses: string[] = ["i.project_id = $1"];
      const params: unknown[] = [project.id];
      const add = (clause: string, ...vals: unknown[]) => {
        for (const v of vals) {
          params.push(v);
          clause = clause.replace("?", `$${params.length}`);
        }
        clauses.push(clause);
      };

      if (f.status) add("i.status_id = ?", f.status);
      if (f.assignee) add("i.assignee_id = ?", f.assignee);
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
      reply.send({ items: rows.map(mapIssue), total: Number(total.n) });
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

      if (body.assigneeId) {
        const u = await one<{ id: string }>(
          `SELECT u.id FROM users u
            WHERE u.id = $1 AND u.is_active
              AND (u.global_role = 'admin'
                   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = u.id))`,
          [body.assigneeId, project.id],
        );
        if (!u) throw badRequest("Исполнитель не входит в проект");
      }
      if (body.epicId) {
        const e = await one<{ id: string }>(`SELECT id FROM issues WHERE id = $1 AND project_id = $2`, [body.epicId, project.id]);
        if (!e) throw notFound("Задача-группа (epicId) не найдена в проекте");
      }

      const rank = await computeRank(statusId, null);
      const num = await nextIssueNum(project.id);
      const key = `${project.key}-${num}`;

      const row = (
        await q<IssueRow>(
          `INSERT INTO issues
             (project_id, num, key, title, description, type_id, status_id, priority_id,
              assignee_id, reporter_id, epic_id, labels, points, due_date, rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *`,
          [
            project.id, num, key, body.title, body.description, body.typeId, statusId, body.priorityId,
            body.assigneeId, user.sub, body.epicId, body.labels, body.points,
            body.dueDate ?? null, rank,
          ],
        )
      )[0];

      await logActivity(row.id, user.sub, "создал(а) задачу");
      await audit(user.sub, "issue.create", "issue", row.id, { key });
      reply.code(201).send(mapIssue(row));
    },
  );

  /* ---------------------------------------------------------- чтение одной
     requireIssuePerm (не requirePerm): открывает fallback приглашённого
     (browse по этой задаче) и строже сверяет issue.project_id с путём. */
  app.get("/:id", { preHandler: requireIssuePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    return getIssueDto(project.id, id);
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

      if (body.assigneeId !== undefined && body.assigneeId !== null) {
        const u = await one<{ id: string }>(
          `SELECT u.id FROM users u
            WHERE u.id = $1 AND u.is_active
              AND (u.global_role = 'admin'
                   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = u.id))`,
          [body.assigneeId, project.id],
        );
        if (!u) throw badRequest("Исполнитель не входит в проект");
      }
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
      if (body.assigneeId !== undefined && body.assigneeId !== iss.assignee_id) {
        push("assignee_id", body.assigneeId);
        if (body.assigneeId) {
          const u = await one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [body.assigneeId]);
          log.push(`назначил(а) исполнителем ${u?.name ?? "?"}`);
        } else {
          log.push("снял(а) исполнителя");
        }
      }
      if (body.epicId !== undefined && body.epicId !== iss.epic_id) {
        push("epic_id", body.epicId);
        log.push("изменил(а) группу (эпик)");
      }
      if (body.labels !== undefined && JSON.stringify(body.labels) !== JSON.stringify(iss.labels)) {
        push("labels", body.labels);
        log.push("обновил(а) метки");
      }
      if (body.points !== undefined && body.points !== iss.points) {
        push("points", body.points);
        log.push(`изменил(а) оценку: ${iss.points ?? "—"} → ${body.points ?? "—"}`);
      }
      if (body.dueDate !== undefined && body.dueDate !== iss.due_date) {
        push("due_date", body.dueDate);
        log.push(`изменил(а) срок: ${iss.due_date ?? "—"} → ${body.dueDate ?? "—"}`);
      }
      if (body.tStart !== undefined) push("t_start", body.tStart);
      if (body.tSpan !== undefined) push("t_span", body.tSpan);
      if (body.color !== undefined) push("color", body.color);

      if (sets.length === 0) return mapIssue(iss);

      vals.push(iss.id);
      const row = (
        await q<IssueRow>(
          `UPDATE issues SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
          vals,
        )
      )[0];

      for (const text of log) await logActivity(iss.id, user.sub, text);
      await audit(user.sub, "issue.update", "issue", iss.id, { key: iss.key, fields: Object.keys(body) });

      // Уведомления (NOTIFICATIONS_MIGRATION.md D2)
      if (body.assigneeId !== undefined && body.assigneeId && body.assigneeId !== iss.assignee_id) {
        await emit({
          type: "issue.assigned",
          actorId: user.sub,
          projectId: project.id,
          issueId: iss.id,
          recipientIds: [body.assigneeId],
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
      return mapIssue(row);
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
      const row = (
        await q<IssueRow>(
          `UPDATE issues SET status_id = $1, rank = $2, updated_at = now() WHERE id = $3 RETURNING *`,
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
      return mapIssue(row);
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
}


