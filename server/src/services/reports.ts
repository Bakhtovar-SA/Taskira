/** Отчётность: агрегаты «что сделано за период» и построчная выгрузка.
 *
 *  ВИДИМОСТЬ. Отчёт не может показать больше, чем пользователю доступно в
 *  интерфейсе. Вместо того чтобы переписывать предикат видимости третий раз
 *  (он уже есть в services/projects.ts и, продублированный, в routes/home.ts —
 *  аудит отметил это как риск расхождения), здесь СНАЧАЛА резолвится список
 *  видимых проектов через listVisibleProjects(), и все запросы ограничиваются
 *  `project_id = ANY($ids)`. Расхождение предикатов невозможно by design.
 *
 *  ПЕРИОД. Границы включительные по дате: from 00:00:00 — to 23:59:59.999
 *  в часовом поясе сервера. Считаем по done_at (миграция 016), поэтому архивные
 *  задачи в отчёты входят наравне с активными — архив не влияет на историю.
 */
import { q } from "../db.js";
import { listVisibleProjects } from "./projects.js";

export interface ReportScope {
  /** id проектов, по которым пользователю разрешено смотреть отчёты. */
  projectIds: string[];
  from: string;
  to: string;
}

export interface ReportTotals {
  /** Закрыто за период (по done_at). */
  closed: number;
  /** Создано за период (по created_at). */
  created: number;
  /** Открыто сейчас — не в категории done, независимо от периода. */
  open: number;
  /** Просрочено сейчас — срок в прошлом и задача не закрыта. */
  overdue: number;
  /** Среднее время от создания до закрытия, дней (по закрытым за период). */
  avgLeadDays: number | null;
  /** Медиана того же — устойчивее среднего к одному забытому «хвосту». */
  medianLeadDays: number | null;
}

export interface ReportRow {
  key: string;
  label: string;
  closed: number;
  created: number;
  open: number;
  avgLeadDays: number | null;
}

export interface ReportPoint {
  /** Неделя закрытия, понедельник, ГГГГ-ММ-ДД. */
  week: string;
  closed: number;
}

export interface ReportResult {
  from: string;
  to: string;
  groupBy: string;
  totals: ReportTotals;
  rows: ReportRow[];
  trend: ReportPoint[];
}

/** Разрешённые проекты с учётом запрошенных фильтров.
 *  Возвращает пустой массив, если пользователю не видно ничего подходящего —
 *  вызывающий отдаёт пустой отчёт, а не 403: «нет данных» честнее, чем отказ. */
export async function resolveReportScope(
  userId: string,
  isGlobalAdmin: boolean,
  filter: { projectId?: string; departmentId?: string },
): Promise<string[]> {
  const visible = await listVisibleProjects(userId, isGlobalAdmin);
  let list = visible;
  if (filter.departmentId) list = list.filter((p) => p.departmentId === filter.departmentId);
  if (filter.projectId) list = list.filter((p) => p.id === filter.projectId);
  return list.map((p) => p.id);
}

/* Границы периода как timestamptz: to включительно (< to + 1 день). */
const bounds = (from: string, to: string) => [`${from} 00:00:00`, `${to} 00:00:00`];

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

/** Сводка + разбивка + недельный тренд одним набором запросов. */
export async function buildReport(
  projectIds: string[],
  from: string,
  to: string,
  groupBy: string,
): Promise<ReportResult> {
  const empty: ReportResult = {
    from,
    to,
    groupBy,
    totals: { closed: 0, created: 0, open: 0, overdue: 0, avgLeadDays: null, medianLeadDays: null },
    rows: [],
    trend: [],
  };
  if (projectIds.length === 0) return empty;

  const [lo, hi] = bounds(from, to);
  // $1 — проекты, $2 — начало периода, $3 — начало дня ПОСЛЕ конца (полуинтервал).
  const p = [projectIds, lo, hi];

  const totalsRow = (
    await q<Record<string, unknown>>(
      `SELECT
         count(*) FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day')            AS closed,
         count(*) FILTER (WHERE i.created_at >= $2 AND i.created_at < $3::timestamptz + interval '1 day')      AS created,
         count(*) FILTER (WHERE ws.category <> 'done')                                                         AS open,
         count(*) FILTER (WHERE ws.category <> 'done' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS overdue,
         avg(EXTRACT(EPOCH FROM (i.done_at - i.created_at)) / 86400)
           FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day')                    AS avg_lead,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (i.done_at - i.created_at)) / 86400
         ) FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day')                    AS median_lead
       FROM issues i
       JOIN workflow_statuses ws ON ws.id = i.status_id
      WHERE i.project_id = ANY($1)`,
      p,
    )
  )[0];

  const totals: ReportTotals = {
    closed: num(totalsRow?.closed),
    created: num(totalsRow?.created),
    open: num(totalsRow?.open),
    overdue: num(totalsRow?.overdue),
    avgLeadDays: round1(numOrNull(totalsRow?.avg_lead)),
    medianLeadDays: round1(numOrNull(totalsRow?.median_lead)),
  };

  // Разбивка. Выражения ключа/подписи выбираются из белого списка — в SQL
  // не попадает ничего пришедшего из запроса, кроме параметров.
  const GROUPS: Record<string, { key: string; label: string; join: string }> = {
    project: { key: "pr.id::text", label: "pr.name", join: "JOIN projects pr ON pr.id = i.project_id" },
    assignee: {
      key: "COALESCE(u.id::text, 'none')",
      label: "COALESCE(u.name, 'Без исполнителя')",
      join: "LEFT JOIN users u ON u.id = i.assignee_id",
    },
    type: { key: "i.type_id", label: "i.type_id", join: "" },
    priority: { key: "i.priority_id", label: "i.priority_id", join: "" },
  };
  const g = GROUPS[groupBy] ?? GROUPS.project;

  const rows = await q<Record<string, unknown>>(
    `SELECT ${g.key} AS k, ${g.label} AS label,
            count(*) FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day')       AS closed,
            count(*) FILTER (WHERE i.created_at >= $2 AND i.created_at < $3::timestamptz + interval '1 day') AS created,
            count(*) FILTER (WHERE ws.category <> 'done')                                                    AS open,
            avg(EXTRACT(EPOCH FROM (i.done_at - i.created_at)) / 86400)
              FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day')               AS avg_lead
       FROM issues i
       JOIN workflow_statuses ws ON ws.id = i.status_id
       ${g.join}
      WHERE i.project_id = ANY($1)
      GROUP BY ${g.key}, ${g.label}
      HAVING count(*) FILTER (WHERE i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day') > 0
          OR count(*) FILTER (WHERE ws.category <> 'done') > 0
      ORDER BY closed DESC, label ASC`,
    p,
  );

  const trend = await q<Record<string, unknown>>(
    `SELECT to_char(date_trunc('week', i.done_at), 'YYYY-MM-DD') AS week, count(*) AS closed
       FROM issues i
      WHERE i.project_id = ANY($1)
        AND i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day'
      GROUP BY 1
      ORDER BY 1`,
    p,
  );

  return {
    from,
    to,
    groupBy,
    totals,
    rows: rows.map((r) => ({
      key: String(r.k),
      label: String(r.label),
      closed: num(r.closed),
      created: num(r.created),
      open: num(r.open),
      avgLeadDays: round1(numOrNull(r.avg_lead)),
    })),
    trend: trend.map((t) => ({ week: String(t.week), closed: num(t.closed) })),
  };
}

export interface ExportRow {
  key: string;
  title: string;
  project: string;
  type: string;
  priority: string;
  status: string;
  assignee: string | null;
  reporter: string;
  labels: string[];
  due_date: string | null;
  created_at: Date;
  done_at: Date | null;
  lead_days: number | null;
}

/** Построчный срез для выгрузки. scope: closed — закрытые за период,
 *  created — созданные за период, open — открытые на текущий момент. */
export async function exportRows(
  projectIds: string[],
  from: string,
  to: string,
  scope: "closed" | "created" | "open",
  limit: number,
): Promise<ExportRow[]> {
  if (projectIds.length === 0) return [];
  const [lo, hi] = bounds(from, to);

  // Параметры собираются ПОД СРЕЗ, а не одним общим списком: у scope=open
  // границы периода в запросе не упоминаются, а Postgres не умеет вывести тип
  // параметра, на который нет ни одной ссылки, и падает с 42P18.
  const WHERE: Record<string, string> = {
    closed: `i.done_at >= $2 AND i.done_at < $3::timestamptz + interval '1 day'`,
    created: `i.created_at >= $2 AND i.created_at < $3::timestamptz + interval '1 day'`,
    open: `ws.category <> 'done'`,
  };
  const ORDER: Record<string, string> = {
    closed: "i.done_at DESC",
    created: "i.created_at DESC",
    open: "i.due_date NULLS LAST, i.created_at",
  };
  const params: unknown[] = scope === "open" ? [projectIds, limit] : [projectIds, lo, hi, limit];
  const limitParam = `$${params.length}`;

  return q<ExportRow>(
    `SELECT i.key, i.title, pr.name AS project, i.type_id AS type, i.priority_id AS priority,
            ws.name AS status, ua.name AS assignee, ur.name AS reporter, i.labels,
            i.due_date, i.created_at, i.done_at,
            EXTRACT(EPOCH FROM (i.done_at - i.created_at)) / 86400 AS lead_days
       FROM issues i
       JOIN projects pr ON pr.id = i.project_id
       JOIN workflow_statuses ws ON ws.id = i.status_id
       LEFT JOIN users ua ON ua.id = i.assignee_id
       JOIN users ur ON ur.id = i.reporter_id
      WHERE i.project_id = ANY($1) AND ${WHERE[scope]}
      ORDER BY ${ORDER[scope]}
      LIMIT ${limitParam}`,
    params,
  );
}
