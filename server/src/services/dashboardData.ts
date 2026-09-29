/** Данные виджетов дашборда (ADR-0022).
 *
 *  Каждый виджет считается на СПИСКЕ проектов, который уже ограничен видимостью смотрящего (routes/dashboards.ts
 *  резолвит его через listVisibleProjects(), как отчёты) — здесь предикат видимости не повторяется. Пустой список —
 *  пустые данные, не ошибка: общий дашборд не должен сообщать, что где-то есть проект, которого человек не видит.
 *
 *  В SQL не попадает ничего из запроса, кроме параметров: группировки и порядок выбираются из белых списков по типу,
 *  который уже проверил zod. «Открытая» задача — статус не из категории done; архив содержит только закрытые задачи
 *  (миграция 016), поэтому для открытых отдельный фильтр по archived_at не нужен. */
import { q } from "../db.js";
import type { DashboardWidget, WidgetDataDto } from "../contract.js";

type Widget<T extends DashboardWidget["type"]> = Extract<DashboardWidget, { type: T }>;
type Data<T extends WidgetDataDto["type"]> = Extract<WidgetDataDto, { type: T }>;

const num = (v: unknown): number => Number(v ?? 0);
const OPEN = `ws.category <> 'done'`;
/** Флаг ведёт триггер на issue_assignees (миграция 20260920T1410) — дешевле anti-join'а. */
const NO_ASSIGNEE = `i.has_assignee = false`;
/** Порядок приоритетов для сортировки списков: критичные первыми. */
const PRIORITY_RANK = `CASE i.priority_id WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
/** Сколько групп разбивки показываем по отдельности; остальное — одной строкой «_other». */
const BREAKDOWN_TOP = 10;

async function countWidget(w: Widget<"count">, ids: string[]): Promise<Data<"count">> {
  const WHERE: Record<Widget<"count">["metric"], string> = {
    open: OPEN,
    overdue: `${OPEN} AND i.due_date < CURRENT_DATE`,
    dueSoon: `${OPEN} AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`,
    unassigned: `${OPEN} AND ${NO_ASSIGNEE}`,
    closed: `i.done_at >= now() - make_interval(days => $2)`,
    created: `i.created_at >= now() - make_interval(days => $2)`,
  };
  const usesPeriod = w.metric === "closed" || w.metric === "created";
  const r = await q<{ n: string }>(
    `SELECT count(*) AS n FROM issues i JOIN workflow_statuses ws ON ws.id = i.status_id
      WHERE i.project_id = ANY($1) AND ${WHERE[w.metric]}`,
    usesPeriod ? [ids, w.periodDays] : [ids],
  );
  return { type: "count", value: num(r[0]?.n) };
}

async function breakdownWidget(w: Widget<"breakdown">, ids: string[]): Promise<Data<"breakdown">> {
  // key / label / category — выражения из белого списка; для статусов по нескольким проектам одинаковые
  // названия сливаются (у каждого проекта свой «В работе»), ключ — категория + название.
  const G: Record<Widget<"breakdown">["groupBy"], { key: string; label: string; cat: string; join: string; order: string }> = {
    status: {
      key: `ws.category || ':' || ws.name`,
      label: "ws.name",
      cat: "ws.category",
      join: "",
      order: `CASE ws.category WHEN 'todo' THEN 0 WHEN 'inprogress' THEN 1 ELSE 2 END, n DESC, label`,
    },
    // Как в отчётах: задача с несколькими исполнителями попадает в каждую их группу.
    assignee: {
      key: "COALESCE(u.id::text, 'none')",
      label: "COALESCE(u.name, '')",
      cat: "NULL::text",
      join: "LEFT JOIN issue_assignees ia ON ia.issue_id = i.id LEFT JOIN users u ON u.id = ia.user_id",
      order: "n DESC, label",
    },
    // Приоритеты — по самому значению (критичные первыми), а не по числу задач.
    priority: { key: "i.priority_id", label: "i.priority_id", cat: "NULL::text", join: "", order: PRIORITY_RANK },
    type: { key: "i.type_id", label: "i.type_id", cat: "NULL::text", join: "", order: "n DESC, label" },
    project: { key: "pr.id::text", label: "pr.name", cat: "NULL::text", join: "JOIN projects pr ON pr.id = i.project_id", order: "n DESC, label" },
  };
  const g = G[w.groupBy];
  const rows = await q<{ k: string; label: string; cat: "todo" | "inprogress" | "done" | null; n: string }>(
    `SELECT ${g.key} AS k, ${g.label} AS label, ${g.cat} AS cat, count(*) AS n
       FROM issues i JOIN workflow_statuses ws ON ws.id = i.status_id ${g.join}
      WHERE i.project_id = ANY($1) AND ${OPEN}
      GROUP BY 1, 2, 3
      ORDER BY ${g.order}`,
    [ids],
  );
  const total = await q<{ n: string }>(
    `SELECT count(*) AS n FROM issues i JOIN workflow_statuses ws ON ws.id = i.status_id WHERE i.project_id = ANY($1) AND ${OPEN}`,
    [ids],
  );
  const items = rows.map((r) => ({ key: r.k, label: r.label, count: num(r.n), category: r.cat }));
  const head = items.slice(0, BREAKDOWN_TOP);
  const rest = items.slice(BREAKDOWN_TOP).reduce((sum, r) => sum + r.count, 0);
  if (rest > 0) head.push({ key: "_other", label: "", count: rest, category: null });
  return { type: "breakdown", total: num(total[0]?.n), items: head };
}

async function trendWidget(w: Widget<"trend">, ids: string[]): Promise<Data<"trend">> {
  // Все недели периода, в том числе пустые: провал до нуля — тоже информация.
  const rows = await q<{ week: string; created: string; closed: string }>(
    `WITH weeks AS (
       SELECT generate_series(date_trunc('week', now() - make_interval(days => $2)), date_trunc('week', now()), interval '1 week') AS wk
     )
     SELECT to_char(weeks.wk, 'YYYY-MM-DD') AS week,
            (SELECT count(*) FROM issues i WHERE i.project_id = ANY($1) AND i.created_at >= weeks.wk AND i.created_at < weeks.wk + interval '1 week') AS created,
            (SELECT count(*) FROM issues i WHERE i.project_id = ANY($1) AND i.done_at    >= weeks.wk AND i.done_at    < weeks.wk + interval '1 week') AS closed
       FROM weeks ORDER BY weeks.wk`,
    [ids, w.periodDays],
  );
  return { type: "trend", weeks: rows.map((r) => ({ week: r.week, created: num(r.created), closed: num(r.closed) })) };
}

type IssueRow = {
  issue_id: string;
  project_id: string;
  key: string;
  title: string;
  type_id: Data<"issues">["items"][number]["typeId"];
  priority_id: Data<"issues">["items"][number]["priorityId"];
  status_id: string;
  status_name: string;
  status_category: Data<"issues">["items"][number]["statusCategory"];
  due_date: string | null;
  project_key: string;
  project_name: string;
};

async function issuesWidget(w: Widget<"issues">, ids: string[], userId: string): Promise<Data<"issues">> {
  const P: Record<Widget<"issues">["preset"], { where: string; order: string }> = {
    mine: {
      where: `${OPEN} AND EXISTS (SELECT 1 FROM issue_assignees ia WHERE ia.issue_id = i.id AND ia.user_id = $3)`,
      order: `i.due_date NULLS LAST, ${PRIORITY_RANK}, i.created_at`,
    },
    overdue: { where: `${OPEN} AND i.due_date < CURRENT_DATE`, order: `i.due_date, ${PRIORITY_RANK}` },
    dueSoon: { where: `${OPEN} AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`, order: `i.due_date, ${PRIORITY_RANK}` },
    unassigned: { where: `${OPEN} AND ${NO_ASSIGNEE}`, order: `${PRIORITY_RANK}, i.created_at DESC` },
    recentlyCreated: { where: "i.archived_at IS NULL", order: "i.created_at DESC" },
    recentlyClosed: { where: "i.done_at IS NOT NULL", order: "i.done_at DESC" },
  };
  const p = P[w.preset];
  // Берём на одну больше — честный признак «показано не всё».
  const rows = await q<IssueRow>(
    `SELECT i.id AS issue_id, i.project_id, i.key, i.title, i.type_id, i.priority_id, i.status_id,
            ws.name AS status_name, ws.category AS status_category, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
            pr.key AS project_key, pr.name AS project_name
       FROM issues i
       JOIN workflow_statuses ws ON ws.id = i.status_id
       JOIN projects pr ON pr.id = i.project_id
      WHERE i.project_id = ANY($1) AND ${p.where}
      ORDER BY ${p.order}
      LIMIT $2`,
    w.preset === "mine" ? [ids, w.limit + 1, userId] : [ids, w.limit + 1],
  );
  return {
    type: "issues",
    truncated: rows.length > w.limit,
    items: rows.slice(0, w.limit).map((r) => ({
      issueId: r.issue_id,
      projectId: r.project_id,
      key: r.key,
      title: r.title,
      typeId: r.type_id,
      priorityId: r.priority_id,
      statusId: r.status_id,
      statusName: r.status_name,
      statusCategory: r.status_category,
      dueDate: r.due_date,
      projectKey: r.project_key,
      projectName: r.project_name,
    })),
  };
}

async function workloadWidget(w: Widget<"workload">, ids: string[]): Promise<Data<"workload">> {
  const rows = await q<{ id: string; name: string; initials: string; color: string; overdue: string; soon: string; other: string }>(
    `SELECT u.id, u.name, u.initials, u.color,
            count(*) FILTER (WHERE i.due_date < CURRENT_DATE) AS overdue,
            count(*) FILTER (WHERE i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS soon,
            count(*) FILTER (WHERE i.due_date IS NULL OR i.due_date > CURRENT_DATE + 7) AS other
       FROM issues i
       JOIN workflow_statuses ws ON ws.id = i.status_id
       JOIN issue_assignees ia ON ia.issue_id = i.id
       JOIN users u ON u.id = ia.user_id
      WHERE i.project_id = ANY($1) AND ${OPEN}
      GROUP BY u.id, u.name, u.initials, u.color
      ORDER BY count(*) DESC, u.name
      LIMIT $2`,
    [ids, w.limit],
  );
  return {
    type: "workload",
    items: rows.map((r) => ({ userId: r.id, name: r.name, initials: r.initials, color: r.color, overdue: num(r.overdue), dueSoon: num(r.soon), other: num(r.other) })),
  };
}

async function progressWidget(w: Widget<"progress">, ids: string[]): Promise<Data<"progress">> {
  // Доля закрытых среди всех задач проекта, включая архив — как на роадмапе (ADR-0021).
  const rows = await q<{ id: string; key: string; name: string; done: string; total: string; overdue: string }>(
    `SELECT pr.id, pr.key, pr.name,
            count(i.id) FILTER (WHERE ws.category = 'done') AS done,
            count(i.id) AS total,
            count(i.id) FILTER (WHERE ws.category <> 'done' AND i.due_date < CURRENT_DATE) AS overdue
       FROM projects pr
       LEFT JOIN issues i ON i.project_id = pr.id
       LEFT JOIN workflow_statuses ws ON ws.id = i.status_id
      WHERE pr.id = ANY($1) AND NOT pr.is_demo
      GROUP BY pr.id, pr.key, pr.name
      ORDER BY pr.name
      LIMIT $2`,
    [ids, w.limit],
  );
  return { type: "progress", items: rows.map((r) => ({ projectId: r.id, key: r.key, name: r.name, done: num(r.done), total: num(r.total), overdue: num(r.overdue) })) };
}

async function activityWidget(w: Widget<"activity">, ids: string[]): Promise<Data<"activity">> {
  const rows = await q<{ id: string; issue_id: string; key: string; title: string; project_id: string; actor: string; text: string; created_at: Date }>(
    `SELECT a.id, a.issue_id, i.key, i.title, i.project_id, u.name AS actor, a.text, a.created_at
       FROM activity a
       JOIN issues i ON i.id = a.issue_id
       JOIN users u ON u.id = a.actor_id
      WHERE i.project_id = ANY($1)
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [ids, w.limit],
  );
  return {
    type: "activity",
    items: rows.map((r) => ({ id: r.id, issueId: r.issue_id, issueKey: r.key, issueTitle: r.title, projectId: r.project_id, actorName: r.actor, text: r.text, createdAt: new Date(r.created_at).toISOString() })),
  };
}

/** Пустые данные нужной формы — для виджета, которому не досталось ни одного видимого проекта. */
export function emptyWidgetData(type: DashboardWidget["type"]): WidgetDataDto {
  switch (type) {
    case "count":
      return { type, value: 0 };
    case "breakdown":
      return { type, total: 0, items: [] };
    case "trend":
      return { type, weeks: [] };
    case "issues":
      return { type, items: [], truncated: false };
    default:
      return { type, items: [] };
  }
}

/** Данные одного виджета на уже отфильтрованном по видимости списке проектов. */
export async function widgetData(w: DashboardWidget, projectIds: string[], userId: string): Promise<WidgetDataDto> {
  if (projectIds.length === 0) return emptyWidgetData(w.type);
  switch (w.type) {
    case "count":
      return countWidget(w, projectIds);
    case "breakdown":
      return breakdownWidget(w, projectIds);
    case "trend":
      return trendWidget(w, projectIds);
    case "issues":
      return issuesWidget(w, projectIds, userId);
    case "workload":
      return workloadWidget(w, projectIds);
    case "progress":
      return progressWidget(w, projectIds);
    case "activity":
      return activityWidget(w, projectIds);
  }
}
