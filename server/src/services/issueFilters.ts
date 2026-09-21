/**
 * Общий построитель WHERE для списка задач и счётчиков. Фильтры, сортировка и
 * поиск выполняются здесь, на сервере: при ленивой загрузке клиент видит лишь
 * часть набора, и фильтр «по уже загруженному» молча искал бы только в ней.
 */
import type { z } from "zod";
import { escLike } from "../db.js";
import type { IssueFilterQuery } from "../contract.js";
import type { IssueCursorSort } from "../issueListCursor.js";

export type IssueFilters = z.infer<typeof IssueFilterQuery>;

/** Запросу нужен JOIN workflow_statuses под алиасом `ws` (категория статуса). */
export function buildIssueFilter(projectId: string, f: IssueFilters): { clauses: string[]; params: unknown[] } {
  // Архив (миграция 016) из активного набора исключён по умолчанию: доска и
  // «Список задач» показывают живые задачи. ?archived=1 — только архивные,
  // ?archived=all — всё вместе (для отчётов и сквозного поиска).
  const clauses: string[] = ["i.project_id = $1"];
  if (f.archived === "1") clauses.push("i.archived_at IS NOT NULL");
  else if (f.archived !== "all") clauses.push("i.archived_at IS NULL");
  const params: unknown[] = [projectId];
  const add = (clause: string, ...vals: unknown[]) => {
    for (const v of vals) {
      params.push(v);
      clause = clause.replace("?", `$${params.length}`);
    }
    clauses.push(clause);
  };

  if (f.status) add("i.status_id = ?", f.status);
  // has_assignee ведёт триггер на issue_assignees (миграция 20260920T1410); он же
  // даёт частичный индекс idx_issues_active_unassigned вместо anti-join.
  if (f.assignee === "none") clauses.push("i.has_assignee = false");
  else if (f.assignee) add("EXISTS (SELECT 1 FROM issue_assignees ia WHERE ia.issue_id = i.id AND ia.user_id = ?)", f.assignee);
  if (f.type) add("i.type_id = ?", f.type);
  if (f.parentId) add("i.parent_id = ?", f.parentId);
  if (f.epicId) add("i.epic_id = ?", f.epicId);
  if (f.q) add("(i.title ILIKE ? OR i.key ILIKE ?)", `%${escLike(f.q)}%`, `%${escLike(f.q)}%`);
  if (f.dueFrom) add("i.due_date >= ?", f.dueFrom);
  if (f.dueTo) add("i.due_date <= ?", f.dueTo);
  if (f.overdue) clauses.push("i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND ws.category <> 'done'");
  if (f.closed === "hide") clauses.push("ws.category <> 'done'");
  else if (f.closed === "recent") {
    add("(ws.category <> 'done' OR i.done_at IS NULL OR i.done_at >= now() - (? * interval '1 day'))", f.closedDays);
  } else if (f.closed === "older") {
    add("(ws.category = 'done' AND i.done_at IS NOT NULL AND i.done_at < now() - (? * interval '1 day'))", f.closedDays);
  }
  return { clauses, params };
}

/** Нужна ли категория статуса (`ws`) — иначе JOIN в счётчике лишний. */
export const needsStatusJoin = (f: IssueFilters): boolean => !!f.overdue || !!f.closed;

/** SQL-выражения ключей сортировки, приведённые к float8 — и для ORDER BY, и
 *  для сравнения с курсором, чтобы значения совпадали побитово. Порядок
 *  приоритетов — PRIORITY_ORDER клиента; задачи без срока — в конце.
 *  Выражения ДОЛЖНЫ дословно совпадать с индексами миграций 20260920T14xx_*:
 *  иначе планировщик не сможет использовать индекс для ORDER BY. */
export const SORT_EXPR: Record<IssueCursorSort, string> = {
  priority: "(CASE i.priority_id WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)::float8",
  due: "COALESCE((i.due_date - DATE '1970-01-01'), 1000000)::float8",
  // AT TIME ZONE 'UTC' делает выражение IMMUTABLE — иначе его нельзя положить в индекс.
  updated: "floor(EXTRACT(EPOCH FROM (i.updated_at AT TIME ZONE 'UTC')) * 1000)::float8",
  key: "i.num",
};
