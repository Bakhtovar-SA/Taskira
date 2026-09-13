/** Отчёты: сводка за период и выгрузка в CSV.
 *
 *  GET /api/reports/summary      — агрегаты + разбивка + недельный тренд (JSON)
 *  GET /api/reports/issues.csv   — построчная выгрузка (CSV для Excel)
 *
 *  Project-less: регистрируется на уровне /api, как /issues/assigned-to-me.
 *  Прав уровня проекта здесь не проверяем через requirePerm — вместо этого
 *  resolveReportScope() резолвит СПИСОК видимых пользователю проектов тем же
 *  listVisibleProjects(), что и остальной интерфейс, и все запросы жёстко
 *  ограничены этим списком. Пользователь физически не может получить в отчёте
 *  проект, который не может открыть; отдельной роли «аналитик» не вводим.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { requireAuth, zquery, badRequest, type JwtPayload } from "../middleware.js";
import { ReportQuery, ReportExportQuery } from "../contract.js";
import { buildReport, exportRows, resolveReportScope } from "../services/reports.js";
import { csvDocument, csvDateTime } from "../services/csv.js";
import { audit } from "../audit.js";

const TYPE_NAMES: Record<string, string> = { task: "Задача", bug: "Ошибка", request: "Запрос" };
const PRIORITY_NAMES: Record<string, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};
/** Человекочитаемая часть имени файла. Только латиница: это значение уходит
 *  в ASCII-параметр filename= заголовка Content-Disposition, а туда кириллица
 *  не проходит вовсе (Node роняет ответ с ERR_INVALID_CHAR). Русское имя
 *  передаём отдельно, в filename*=UTF-8'' — его понимают все современные
 *  браузеры, ASCII-вариант остаётся запасным. */
const SCOPE_SLUG: Record<string, string> = {
  closed: "closed",
  created: "created",
  open: "open",
};
const SCOPE_NAMES: Record<string, string> = {
  closed: "закрытые",
  created: "созданные",
  open: "открытые",
};

/** Период не должен быть вывернут наизнанку и не должен быть безразмерным:
 *  два года — потолок для одного отчёта (дальше это выгрузка данных, не отчёт). */
const MAX_RANGE_DAYS = 366 * 2;

function assertRange(from: string, to: string): void {
  if (from > to) throw badRequest("Начало периода позже его конца");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days)) throw badRequest("Некорректный период");
  if (days > MAX_RANGE_DAYS) throw badRequest(`Период слишком большой — максимум ${MAX_RANGE_DAYS} дней`);
}

/** Человекочитаемая подпись строки разбивки: для типов и приоритетов
 *  в БД лежат технические id, их переводим здесь, а не в SQL. */
const labelFor = (groupBy: string, raw: string): string =>
  groupBy === "type" ? (TYPE_NAMES[raw] ?? raw) : groupBy === "priority" ? (PRIORITY_NAMES[raw] ?? raw) : raw;

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/reports/summary",
    { preHandler: requireAuth, preValidation: zquery(ReportQuery) },
    async (req) => {
      const user: JwtPayload = req.user;
      const f = req.query as z.infer<typeof ReportQuery>;
      assertRange(f.from, f.to);

      const projectIds = await resolveReportScope(user.sub, user.globalRole === "admin", {
        projectId: f.projectId,
        departmentId: f.departmentId,
      });
      const report = await buildReport(projectIds, f.from, f.to, f.groupBy);
      return {
        ...report,
        projectCount: projectIds.length,
        rows: report.rows.map((r) => ({ ...r, label: labelFor(f.groupBy, r.label) })),
      };
    },
  );

  app.get(
    "/reports/issues.csv",
    { preHandler: requireAuth, preValidation: zquery(ReportExportQuery) },
    async (req, reply) => {
      const user: JwtPayload = req.user;
      const f = req.query as z.infer<typeof ReportExportQuery>;
      assertRange(f.from, f.to);

      const projectIds = await resolveReportScope(user.sub, user.globalRole === "admin", {
        projectId: f.projectId,
        departmentId: f.departmentId,
      });
      const rows = await exportRows(projectIds, f.from, f.to, f.scope, f.limit);

      const csv = csvDocument(
        [
          "Ключ", "Название", "Проект", "Тип", "Приоритет", "Статус",
          "Исполнитель", "Автор", "Метки", "Срок", "Создана", "Закрыта", "Дней в работе",
        ],
        rows.map((r) => [
          r.key,
          r.title,
          r.project,
          TYPE_NAMES[r.type] ?? r.type,
          PRIORITY_NAMES[r.priority] ?? r.priority,
          r.status,
          r.assignee ?? "—",
          r.reporter,
          (r.labels ?? []).join(", "),
          r.due_date ?? "",
          csvDateTime(r.created_at),
          csvDateTime(r.done_at),
          r.lead_days === null ? "" : String(Math.round(Number(r.lead_days) * 10) / 10).replace(".", ","),
        ]),
      );

      // Выгрузка данных — событие для аудита: кто, когда и какой срез забрал.
      await audit(user.sub, "report.export", "report", null, {
        scope: f.scope,
        from: f.from,
        to: f.to,
        projects: projectIds.length,
        rows: rows.length,
      });

      const asciiName = `taskira-${SCOPE_SLUG[f.scope] ?? "report"}-${f.from}_${f.to}.csv`;
      const humanName = `taskira-${SCOPE_NAMES[f.scope] ?? f.scope}-${f.from}_${f.to}.csv`;
      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(humanName)}`)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store");
      return reply.send(csv);
    },
  );
}
