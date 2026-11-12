/**
 * Проверка ответов API по схемам `contract.ts` в интеграционных тестах.
 *
 * Схемы ответов — источник типов клиента и сервера, но в рабочем коде их никто не вызывает (`.parse()` на
 * границе нет: SQL-строки приводятся `q<Row>`, мапперы лишь аннотированы типом). Маппер, вернувший не то, что
 * объявил, проходит и typecheck, и тесты, которые смотрят на отдельные поля. Здесь каждый успешный JSON-ответ
 * маршрута из `RESPONSES` разбирается его схемой; расхождение роняет тест, в котором был сделан запрос
 * (`responseContract.setup.ts`). Рабочий код не меняется: хук ставится только на приложение из `getApp()`.
 *
 * ДОБАВИТЬ МАРШРУТ: строка `"МЕТОД /api/путь": Схема` — путь как в `test/access/routes.manifest.ts`. Список
 * неполный намеренно: сюда входят маршруты, чей ответ целиком описан схемой из `contract.ts`. Обёртки,
 * собранные в обработчике (`{ item, checklist }`, `{ links }` и т. п.), схемы не имеют и не проверяются.
 * Лишние поля ответа ошибкой не считаются (zod-объекты их отбрасывают) — ловятся отсутствующие поля и типы.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as C from "../src/contract.js";
import { ApplicationsDto } from "../src/applicationContract.js";

const page = (item: z.ZodType) => C.IssueListPageMeta.extend({ items: z.array(item) });

export const RESPONSES: Record<string, z.ZodType> = {
  "GET /api/applications": ApplicationsDto,
  "GET /api/auth/me": C.MeDto,
  "GET /api/dashboards": z.array(C.DashboardDto),
  "GET /api/dashboards/:dashboardId": C.DashboardDto,
  "GET /api/departments": z.array(C.DepartmentDto),
  "GET /api/departments/:id/members": z.array(C.DepartmentMemberDto),
  "GET /api/instance/brand": C.BrandDto,
  "GET /api/issues/assigned-to-me": C.AssignedToMeDto,
  "GET /api/issues/collaborating": z.array(C.CollaboratingItemDto),
  "GET /api/issues/resolve": C.IssueResolveDto,
  "GET /api/issues/search": C.SearchResultDto,
  "GET /api/me/onboarding": C.OnboardingDto,
  "GET /api/notifications": C.NotificationPageDto,
  "GET /api/notifications/unread-count": C.UnreadCountDto,
  "GET /api/project-templates": z.array(C.ProjectTemplateDto),
  "GET /api/projects": z.array(C.ProjectDto),
  "GET /api/projects/:projectId": C.ProjectBootstrapDto,
  "GET /api/projects/:projectId/custom-fields": z.array(C.CustomFieldDto),
  "GET /api/projects/:projectId/issue-templates": z.array(C.IssueTemplateDto),
  "GET /api/projects/:projectId/issues": page(C.IssueDto),
  "GET /api/projects/:projectId/issues/:id": C.IssueDetailDto,
  "GET /api/projects/:projectId/issues/:id/activity": z.array(C.ActivityDto),
  "GET /api/projects/:projectId/issues/:id/collaborators": z.array(C.CollaboratorDto),
  "GET /api/projects/:projectId/issues/:id/comments": z.array(C.CommentDto),
  "GET /api/projects/:projectId/issues/assignees": C.IssueAssigneesDto,
  "GET /api/projects/:projectId/issues/counts": C.IssueCountsDto,
  "GET /api/projects/:projectId/issues/epics": C.IssueEpicsDto,
  "GET /api/projects/:projectId/saved-views": z.array(C.SavedViewDto),
  "GET /api/projects/:projectId/sprints": z.array(C.SprintDto),
  "GET /api/projects/:projectId/workflow": C.WorkflowDto,
  "GET /api/reports/summary": C.ReportSummaryDto,
  "GET /api/roadmap": C.RoadmapDto,
  "GET /api/users/pickable": z.array(C.PickableUserDto),
  "PATCH /api/applications": ApplicationsDto,
  "PATCH /api/projects/:projectId/issues/:id": C.IssueMutationResultDto,
  "POST /api/dashboards/data": C.DashboardDataDto,
  "POST /api/projects/:projectId/issues": C.IssueDto,
  "POST /api/projects/:projectId/issues/:id/comments": C.CommentDto,
  "POST /api/projects/:projectId/issues/:id/transition": C.IssueMutationResultDto,
};

export interface ContractViolation { route: string; issues: string }

const violations: ContractViolation[] = [];
const seen = new Set<string>();

/** Расхождения, накопленные с прошлого вызова; очищает список. */
export function takeViolations(): ContractViolation[] {
  return violations.splice(0);
}

/** Маршруты из RESPONSES, у которых в этом процессе был проверен хотя бы один ответ. */
export function checkedRoutes(): string[] {
  return [...seen].sort();
}

/** Вызывать до `app.ready()`: хук корня наследуют маршруты, зарегистрированные плагинами. */
export function installResponseContract(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const route = `${req.method} ${req.routeOptions.url}`;
    const schema = RESPONSES[route];
    if (!schema || reply.statusCode < 200 || reply.statusCode >= 300 || typeof payload !== "string") return payload;
    let body: unknown;
    try { body = JSON.parse(payload); }
    catch { violations.push({ route, issues: "ответ не JSON" }); return payload; }
    seen.add(route);
    const result = schema.safeParse(body);
    if (!result.success) {
      violations.push({ route, issues: result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(корень)"}: ${i.message}`).join("; ") });
    }
    return payload;
  });
}
