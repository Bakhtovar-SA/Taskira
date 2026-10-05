import type { Page } from "@playwright/test";
import { shellFixture } from "./shell-fixture";

export async function reportsFixture(page: Page, theme = "light", lang = "ru", options: { empty?: boolean; fail?: boolean; personal?: boolean } = {}) {
  await shellFixture(page, theme, lang);
  await page.clock.setFixedTime(new Date("2026-10-02T07:00:00Z"));
  const requests: URL[] = [];
  const names = ["Корпоративные задачи", "Юридические вопросы и согласование договоров", "Автоматизация работы команды", "Обновление сайта", "Планирование кампаний"];
  const keys = ["CORP", "LEGAL", "OPS", "WEB", "MKT"];
  const projects = names.map((name, i) => ({ id: `p${i + 1}`, key: keys[i], name, departmentId: i < 2 ? "d1" : "d2", description: "", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false }));
  const dashboards = options.personal ? [{ id: "personal", name: "Empty", kind: "personal", ownerId: "u1", projectId: null, canEdit: true, widgets: [], updatedAt: "2026-10-01" }] : [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects") return route.fulfill({ json: projects });
    if (url.pathname === "/api/dashboards/data") return route.fulfill({ json: { results: {} } });
    if (url.pathname === "/api/dashboards") {
      if (route.request().method() === "POST") return route.fulfill({ json: { ...dashboards[0], ...route.request().postDataJSON(), id: "created", kind: "personal", ownerId: "u1", canEdit: true, projectId: null, updatedAt: "2026-10-02" } });
      return route.fulfill({ json: dashboards });
    }
    if (url.pathname === "/api/reports/issues.csv") { requests.push(url); return route.fulfill({ contentType: "text/csv", headers: { "content-disposition": 'attachment; filename="report.csv"' }, body: "\uFEFFКлюч,Проект\nCORP-1,Корпоративные задачи" }); }
    if (url.pathname !== "/api/reports/summary") return route.fallback();
    requests.push(url);
    if (options.fail) return route.fulfill({ status: 503, json: { error: { code: "unavailable", reason: "Не удалось загрузить отчёт" } } });
    const previous = url.searchParams.get("to")! < "2026-09-03";
    const empty = options.empty;
    const rows = projects.filter(p => (!url.searchParams.get("departmentId") || p.departmentId === url.searchParams.get("departmentId")) && (!url.searchParams.get("projectIds") || url.searchParams.get("projectIds")!.split(",").includes(p.id))).map((p, i) => ({ key: p.id, label: p.name, created: [42, 32, 30, 28, 24][i], closed: [38, 26, 24, 20, 16][i], open: 47, overdue: [6, 4, 3, 3, 2][i], avgLeadDays: 4.2 }));
    return route.fulfill({ json: {
      from: url.searchParams.get("from"), to: url.searchParams.get("to"), groupBy: url.searchParams.get("groupBy") || "project", projectCount: rows.length,
      totals: { closed: empty ? 0 : previous ? 110 : 124, created: empty ? 0 : previous ? 143 : 156, open: 235, overdue: 18, avgLeadDays: empty ? null : previous ? 5 : 4.2, medianLeadDays: empty ? null : 3 },
      rows: empty ? [] : rows,
      trend: empty ? [] : ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((week, i) => ({ week, created: [22, 34, 38, 40, 22][i], closed: [14, 26, 32, 34, 18][i] })),
    } });
  });
  return requests;
}
