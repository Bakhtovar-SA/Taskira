/** Дашборды (ADR-0022).
 *
 *  GET    /api/dashboards                          — общие дашборды организации и свои личные
 *  POST   /api/dashboards                          — создать (shared — только глобальный администратор)
 *  GET    /api/dashboards/:dashboardId             — один дашборд (чужой личный — 404)
 *  PATCH  /api/dashboards/:dashboardId             — название, виджеты, общий/личный
 *  DELETE /api/dashboards/:dashboardId
 *  POST   /api/dashboards/data                     — данные набора виджетов под видимостью смотрящего
 *  GET    /api/projects/:projectId/overview        — обзор проекта (null — встроенный)            [browse]
 *  PUT    /api/projects/:projectId/overview        — сохранить обзор                              [manageDashboards]
 *  DELETE /api/projects/:projectId/overview        — вернуть встроенный                           [manageDashboards]
 *
 *  Данные виджетов считаются только на проектах из listVisibleProjects() — как в отчётах: общий дашборд не
 *  показывает никому больше, чем тот и так может открыть. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { notFound, requireAuth, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { roleCan } from "../permissions.js";
import { audit } from "../audit.js";
import {
  DashboardCreateBody,
  DashboardDataBody,
  DashboardParams,
  DashboardPatchBody,
  ProjectOverviewBody,
  ProjectParams,
  type DashboardDataDto,
  type DashboardWidget,
  type ProjectOverviewDto,
  type WidgetDataDto,
} from "../contract.js";
import { listVisibleProjects } from "../services/projects.js";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  getProjectOverview,
  listDashboards,
  patchDashboard,
  resetProjectOverview,
  saveProjectOverview,
} from "../services/dashboards.js";
import { widgetData } from "../services/dashboardData.js";

const isAdmin = (u: JwtPayload) => u.globalRole === "admin";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboards", { preHandler: requireAuth }, async (req) => listDashboards(req.user.sub, isAdmin(req.user)));

  app.post("/dashboards", { preHandler: requireAuth, preValidation: zbody(DashboardCreateBody) }, async (req, reply) => {
    const u: JwtPayload = req.user;
    const d = await createDashboard(u.sub, isAdmin(u), req.body as z.infer<typeof DashboardCreateBody>);
    await audit(u.sub, "dashboard.create", "dashboard", d.id, { name: d.name, kind: d.kind });
    return reply.code(201).send(d);
  });

  // Регистрируется раньше /dashboards/:dashboardId, чтобы «data» не принялся за id (к тому же это POST).
  app.post("/dashboards/data", { preHandler: requireAuth, preValidation: zbody(DashboardDataBody) }, async (req): Promise<DashboardDataDto> => {
    const u: JwtPayload = req.user;
    const body = req.body as z.infer<typeof DashboardDataBody>;
    const visible = await listVisibleProjects(u.sub, isAdmin(u));
    if (body.projectId && !visible.some((p) => p.id === body.projectId)) throw notFound("Проект не найден");

    const scopeOf = (w: DashboardWidget): string[] => {
      // Обзор проекта: область всех виджетов — этот проект, что бы ни лежало в их настройках.
      if (body.projectId) return [body.projectId];
      let list = visible;
      if (w.departmentId) list = list.filter((p) => p.departmentId === w.departmentId);
      if (w.projectId) list = list.filter((p) => p.id === w.projectId);
      return list.map((p) => p.id);
    };

    const entries = await Promise.all(
      body.widgets.map(async (w): Promise<[string, WidgetDataDto]> => {
        try {
          return [w.id, await widgetData(w, scopeOf(w), u.sub)];
        } catch (err) {
          // Один сломавшийся виджет не должен гасить весь дашборд.
          req.log.error({ err, widget: w.type }, "dashboard widget failed");
          return [w.id, { type: "error" }];
        }
      }),
    );
    return { results: Object.fromEntries(entries) };
  });

  app.get("/dashboards/:dashboardId", { preHandler: requireAuth, preValidation: zparams(DashboardParams) }, async (req) => {
    const { dashboardId } = req.params as z.infer<typeof DashboardParams>;
    return getDashboard(dashboardId, req.user.sub, isAdmin(req.user));
  });

  app.patch(
    "/dashboards/:dashboardId",
    { preHandler: requireAuth, preValidation: [zparams(DashboardParams), zbody(DashboardPatchBody)] },
    async (req) => {
      const u: JwtPayload = req.user;
      const { dashboardId } = req.params as z.infer<typeof DashboardParams>;
      const patch = req.body as z.infer<typeof DashboardPatchBody>;
      const d = await patchDashboard(dashboardId, u.sub, isAdmin(u), patch);
      await audit(u.sub, "dashboard.update", "dashboard", d.id, { fields: Object.keys(patch), kind: d.kind });
      return d;
    },
  );

  app.delete("/dashboards/:dashboardId", { preHandler: requireAuth, preValidation: zparams(DashboardParams) }, async (req, reply) => {
    const u: JwtPayload = req.user;
    const { dashboardId } = req.params as z.infer<typeof DashboardParams>;
    const d = await deleteDashboard(dashboardId, u.sub, isAdmin(u));
    await audit(u.sub, "dashboard.delete", "dashboard", d.id, { name: d.name, kind: d.kind });
    return reply.code(204).send();
  });

  /* ---------------- обзор проекта ---------------- */

  app.get(
    "/projects/:projectId/overview",
    { preHandler: requirePerm("browse"), preValidation: zparams(ProjectParams) },
    async (req): Promise<ProjectOverviewDto> => {
      const { projectId } = req.params as z.infer<typeof ProjectParams>;
      const canEdit = roleCan(req.projectRole ?? null, "manageDashboards");
      return { dashboard: await getProjectOverview(projectId, req.user.sub, canEdit), canEdit };
    },
  );

  const manage = requirePerm("manageDashboards");

  app.put(
    "/projects/:projectId/overview",
    { preHandler: manage, preValidation: [zparams(ProjectParams), zbody(ProjectOverviewBody)] },
    async (req) => {
      const u: JwtPayload = req.user;
      const { projectId } = req.params as z.infer<typeof ProjectParams>;
      const { widgets } = req.body as z.infer<typeof ProjectOverviewBody>;
      const d = await saveProjectOverview(projectId, u.sub, widgets);
      await audit(u.sub, "project.overview.update", "project", projectId, { widgets: widgets.length });
      return d;
    },
  );

  app.delete("/projects/:projectId/overview", { preHandler: manage, preValidation: zparams(ProjectParams) }, async (req, reply) => {
    const u: JwtPayload = req.user;
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    if (await resetProjectOverview(projectId)) await audit(u.sub, "project.overview.reset", "project", projectId, {});
    return reply.code(204).send();
  });
}
