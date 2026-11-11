/**
 * Чтение списков задач проекта: страница с фильтрами, счётчики по статусам, исполнители для
 * фильтра доски и направления. Маршруты (routes/issues.ts) проверяют права и схему запроса,
 * SQL и сборка ответа — здесь.
 */
import type { z } from "zod";
import { one, q } from "../db.js";
import { badRequest } from "../middleware.js";
import { loadConfig } from "../config.js";
import {
  decodeIssueListCursor,
  decodeIssueSortCursor,
  encodeIssueListCursor,
  encodeIssueSortCursor,
  type IssueCursorSort,
} from "../issueListCursor.js";
import type { IssueAssigneesDto, IssueCountsDto, IssueEpicDto, IssueEpicsDto, IssueCountsQuery, IssueListPageMeta, IssueQuery } from "../contract.js";
import { getCustomFieldInProject } from "./customFields.js";
import { buildIssueFilter, needsStatusJoin, SORT_EXPR } from "./issueFilters.js";
import { listAssigneeIdsBatch, mapIssue, maskSprintId, subtasksSummaryBatch, type IssueRow } from "./issues.js";
import { issueRepeatBatch } from "./recurring.js";
import type { ProjectRow } from "./project.js";

export const elapsedMs = (started: bigint): number => Number(process.hrtime.bigint() - started) / 1e6;

/** Замеры этапов списка при PERF_TRACE=1; без трассировки не передаётся. */
export interface IssueListTiming {
  requestStarted: bigint;
  beforeFirstSqlMs?: number;
  countSqlMs?: number;
  listSqlMs?: number;
  assigneesSqlMs?: number;
  responseBuildMs?: number;
}

/** Страница списка задач: фильтры, keyset-курсор или offset, исполнители/подзадачи/повторы пачкой. */
export async function listIssuesPage(project: ProjectRow, f: z.infer<typeof IssueQuery>, trace?: IssueListTiming) {
  const customField = f.cf ? await getCustomFieldInProject(project.id, f.cf) : undefined;
  const { clauses, params } = buildIssueFilter(project.id, f, { sprintsEnabled: project.sprintsEnabled, customField });

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
  const pageIds = pageRows.map((r) => r.id);
  const [assigneesByIssue, subtasksByIssue, repeatByIssue] = await Promise.all([listAssigneeIdsBatch(pageIds), subtasksSummaryBatch(pageIds), issueRepeatBatch(project.id, pageIds)]);
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
    items: pageRows.map((r) =>
      maskSprintId(
        { ...mapIssue(r, assigneesByIssue.get(r.id) ?? []), subtasksSummary: subtasksByIssue.get(r.id) ?? { total: 0, done: 0 }, repeat: repeatByIssue.get(r.id) ?? null },
        project.sprintsEnabled,
      ),
    ),
    ...pageMeta,
  };
  if (trace && responseBuildStarted) trace.responseBuildMs = elapsedMs(responseBuildStarted);
  return payload;
}

/** Счётчики по статусам для того же набора фильтров, что у списка. */
export async function countIssuesByStatus(project: ProjectRow, f: z.infer<typeof IssueCountsQuery>): Promise<IssueCountsDto> {
  const customField = f.cf ? await getCustomFieldInProject(project.id, f.cf) : undefined;
  const { clauses, params } = buildIssueFilter(project.id, f, { sprintsEnabled: project.sprintsEnabled, customField });
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
}

/** Исполнители активных задач проекта по убыванию числа задач (аватарки фильтра доски). */
export async function countIssueAssignees(projectId: string, limit: number): Promise<IssueAssigneesDto> {
  const rows = await q<{ user_id: string; n: number }>(
    `SELECT ia.user_id, count(*)::int AS n
       FROM issue_assignees ia
       JOIN issues i ON i.id = ia.issue_id
      WHERE i.project_id = $1 AND i.archived_at IS NULL
      GROUP BY ia.user_id
      ORDER BY n DESC, ia.user_id
      LIMIT $2`,
    [projectId, limit],
  );
  return { items: rows.map((r) => ({ userId: r.user_id, count: r.n })) };
}

/** Активные направления с детьми; счётчики лежат на строке направления (EPIC-01). */
export async function listEpics(projectId: string, limit: number): Promise<IssueEpicsDto> {
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
    `SELECT e.id, e.key, e.title, e.color, e.t_start, e.t_span,
            e.epic_child_total AS total, e.epic_child_done AS done
       FROM issues e
      WHERE e.project_id = $1 AND e.epic_child_total > 0 AND e.archived_at IS NULL
      ORDER BY e.rank, e.id
      LIMIT $2`,
    [projectId, limit + 1],
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
}
