/**
 * Манифест матрицы доступа (SEC-IDOR-01, docs/tracks/TRACK-M-PRODUCTION-READINESS.md, M1).
 *
 * КАК ПОЛЬЗОВАТЬСЯ. Тест `routes.manifest.test.ts` сверяет `ROUTES` со списком маршрутов, которые реально
 * обслуживает `buildApp()`; `accessMatrix.test.ts` прогоняет каждую запись на реальной БД под шестью
 * сценариями. Добавили маршрут — добавьте ОДНУ строку в `ROUTES` (политику выберите из `P`: она называется по
 * тому, что проверяет маршрут — `requireGlobalAdmin`, `requirePerm(...)`, `requireIssuePerm(...)`, `requireSession`…).
 * Если у маршрута есть тело/обязательные query-параметры — добавьте строку в `BODIES` / `QUERIES`: валидация
 * (zod, `preValidation`) выполняется ДО проверки прав, и без корректного тела вместо 401/403 придёт 400.
 * Новый вложенный параметр пути (`/projects/:projectId/<ресурс>/:<id>`) — ещё строка в OWNED или NOT_OWNED в
 * `crossProject.test.ts`: там объект P2 подставляется в путь P1 и ожидается 404 (межпроектный IDOR).
 *
 * ПРАВИЛА ДЛЯ СЛИЯНИЯ (параллельные ветки добавляют маршруты): одна запись — одна строка; ключи отсортированы
 * (простая сортировка строк, как `Array.prototype.sort()`); строки не форматируются в несколько строк и не
 * группируются комментариями — иначе два PR, добавляющих маршруты рядом, получают конфликт, а не чистое слияние.
 * Тест на порядок называет первый ключ не на своём месте.
 *
 * СЦЕНАРИИ (кто и к чему обращается; везде — реальные идентификаторы из фикстуры):
 *   anon          — без учётных данных.
 *   outsider      — активный member без членства в проектах и команде; обращается к проекту P1 (команда D1).
 *   empForeign    — employee проекта P1 на ЧУЖОЙ задаче P1 (не автор и не исполнитель) и на проектных ресурсах P1.
 *   collabOther   — приглашённый (issue_collaborators) к задаче A проекта P1; обращается к ДРУГОЙ задаче B того же проекта.
 *   deactivated   — бывший employee P1: сессия выдана до деактивации (is_active=false, кэш сброшен).
 *   tokenOutOfScope — API-токен scope=read пользователя emp1 (employee P1) против ресурсов проекта P2: проект вне
 *                   его членства, а метод записи вдобавок вне scope токена.
 *
 * ОЖИДАНИЯ: число — точный HTTP-статус; "ALLOW" — доступ открыт (любой статус, кроме 401/403, — тело/идентификаторы
 * подставляются условные, поэтому 400/404 уже «после» проверки прав); "N/A" — сценарий к маршруту неприменим (причина
 * в имени политики).
 *
 * ПРАВИЛО 404 vs 403 — docs/SECURITY_OVERVIEW.md, «Правило 404 / 403».
 */

export const SCENARIOS = ["anon", "outsider", "empForeign", "collabOther", "deactivated", "tokenOutOfScope"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Expect = number | "ALLOW" | "N/A";
export type Policy = Readonly<Record<Scenario, Expect>>;

const A = "ALLOW" as const;
const NA = "N/A" as const;
const pol = (
  anon: Expect,
  outsider: Expect,
  empForeign: Expect,
  collabOther: Expect,
  deactivated: Expect,
  tokenOutOfScope: Expect,
): Policy => ({ anon, outsider, empForeign, collabOther, deactivated, tokenOutOfScope });

/** Политики. Порядок аргументов: anon, outsider, empForeign, collabOther, deactivated, tokenOutOfScope. */
export const P = {
  /** Без аутентификации: health, метрики, брендинг. Деактивированному и токену тоже открыто. */
  public: pol(A, A, A, A, A, A),
  /** POST /api/auth/login: тело с несуществующей учёткой — одинаковый 401 для всех (перебор не различим). */
  loginFailure: pol(401, 401, 401, 401, 401, 401),
  /** WebSocket: аутентификация — первое сообщение после апгрейда, не заголовок; покрыт ws-тестами. */
  websocket: pol(NA, NA, NA, NA, NA, NA),
  /** requireAuth, без проекта, чтение; токен scope=read допустим. */
  userRead: pol(401, A, A, A, 401, A),
  /** requireAuth, без проекта, запись; токен scope=read → 403 TOKEN_SCOPE. */
  userWrite: pol(401, A, A, A, 401, 403),
  /** requireSession: любой вошедший, но не API-токен (403 TOKEN_NOT_ALLOWED). */
  sessionOnly: pol(401, A, A, A, 401, 403),
  /** Чужой личный ресурс (дашборд) по id: 404 «не существует для вас»; токен-запись — 403 раньше. */
  foreignPersonalRead: pol(401, 404, 404, 404, 401, 404),
  foreignPersonalWrite: pol(401, 404, 404, 404, 401, 403),
  /** requireGlobalAdmin: обычному участнику — 403 независимо от проекта. */
  adminOnly: pol(401, 403, 403, 403, 401, 403),
  /** requirePerm(browse|create) на :projectId — employee проекта проходит, посторонний и приглашённый — нет. */
  projectMember: pol(401, 403, A, 403, 401, 403),
  /** requirePerm(editWorkflow|manageAccess|editAppearance|editRoadmap|manageDashboards|saveProjectTemplate) — не для employee. */
  projectPrivileged: pol(401, 403, 403, 403, 401, 403),
  /** requireIssuePerm(browse|comment): employee видит чужую задачу проекта; приглашённый к ДРУГОЙ задаче — нет. */
  issueMember: pol(401, 403, A, 403, 401, 403),
  /** requireIssuePerm(edit|transition|delete|manageCollaborators) на чужой задаче — employee получает 403. */
  issueOwnerOnly: pol(401, 403, 403, 403, 401, 403),
  /** Спринты выключены (sprintsEnabled=false): gate до проверки роли → 404 «функции нет» для любого вошедшего. */
  sprintsOffRead: pol(401, 404, 404, 404, 401, 404),
  sprintsOffWrite: pol(401, 404, 404, 404, 401, 403),
} as const satisfies Record<string, Policy>;

/** Маршрут сам инвалидирует сессию вызывающего (logout) — раннер перед следующей записью логинит заново. */
export const RELOGIN_AFTER: ReadonlySet<string> = new Set(["POST /api/auth/logout"]);

/**
 * Все маршруты (без HEAD и OPTIONS). Один маршрут — одна строка, по алфавиту.
 */
export const ROUTES: Readonly<Record<string, Policy>> = {
  "DELETE /api/admin/brand/logo": P.adminOnly,
  "DELETE /api/admin/demo-project": P.adminOnly,
  "DELETE /api/admin/service-accounts/:id/tokens/:tokenId": P.adminOnly,
  "DELETE /api/admin/tokens/:id": P.adminOnly,
  "DELETE /api/dashboards/:dashboardId": P.foreignPersonalWrite,
  "DELETE /api/departments/:id": P.adminOnly,
  "DELETE /api/departments/:id/members/:userId": P.adminOnly,
  "DELETE /api/me/avatar": P.sessionOnly,
  "DELETE /api/me/tokens/:id": P.foreignPersonalWrite,
  "DELETE /api/project-templates/:templateId": P.adminOnly,
  "DELETE /api/projects/:projectId": P.adminOnly,
  "DELETE /api/projects/:projectId/background-photo": P.projectPrivileged,
  "DELETE /api/projects/:projectId/custom-fields/:fieldId": P.projectPrivileged,
  "DELETE /api/projects/:projectId/dependencies/:sourceProjectId": P.projectPrivileged,
  "DELETE /api/projects/:projectId/favorite": P.projectMember,
  "DELETE /api/projects/:projectId/issue-templates/:templateId": P.projectPrivileged,
  "DELETE /api/projects/:projectId/issues/:id": P.issueOwnerOnly,
  "DELETE /api/projects/:projectId/issues/:id/attachments/:attId": P.issueMember,
  "DELETE /api/projects/:projectId/issues/:id/checklist/:itemId": P.issueOwnerOnly,
  "DELETE /api/projects/:projectId/issues/:id/collaborators/:userId": P.issueOwnerOnly,
  "DELETE /api/projects/:projectId/issues/:id/links/:linkId": P.issueOwnerOnly,
  "DELETE /api/projects/:projectId/issues/:id/watchers/me": P.issueMember,
  "DELETE /api/projects/:projectId/members/:userId": P.projectPrivileged,
  "DELETE /api/projects/:projectId/milestones/:milestoneId": P.projectPrivileged,
  "DELETE /api/projects/:projectId/overview": P.projectPrivileged,
  "DELETE /api/projects/:projectId/recurring/:id": P.projectPrivileged,
  "DELETE /api/projects/:projectId/saved-views/:viewId": { ...P.projectMember, empForeign: 404 },
  "DELETE /api/projects/:projectId/webhooks/:id": P.adminOnly,
  "DELETE /api/projects/:projectId/workflow/transitions/:id": P.projectPrivileged,
  "GET /api/admin/audit-log/export": P.adminOnly,
  "GET /api/admin/export": P.adminOnly,
  "GET /api/admin/license": P.adminOnly,
  "GET /api/admin/service-accounts": P.adminOnly,
  "GET /api/admin/service-accounts/:id/tokens": P.adminOnly,
  "GET /api/admin/setup": P.adminOnly,
  "GET /api/admin/tokens": P.adminOnly,
  "GET /api/auth/config": P.sessionOnly,
  "GET /api/auth/me": P.sessionOnly,
  "GET /api/dashboards": P.userRead,
  "GET /api/dashboards/:dashboardId": P.foreignPersonalRead,
  "GET /api/departments": P.userRead,
  "GET /api/departments/:id/members": P.adminOnly,
  "GET /api/health": P.public,
  "GET /api/instance/brand": P.public,
  "GET /api/instance/brand/logo": P.public,
  "GET /api/integrations/config": P.adminOnly,
  "GET /api/issues/assigned-to-me": P.userRead,
  "GET /api/issues/collaborating": P.userRead,
  "GET /api/issues/resolve": P.userRead,
  "GET /api/issues/search": P.userRead,
  "GET /api/maintenance": P.adminOnly,
  "GET /api/me/onboarding": P.sessionOnly,
  "GET /api/me/tokens": P.sessionOnly,
  "GET /api/notifications": P.userRead,
  "GET /api/notifications/unread-count": P.userRead,
  "GET /api/project-templates": P.adminOnly,
  "GET /api/projects": P.userRead,
  "GET /api/projects/:projectId": P.projectMember,
  "GET /api/projects/:projectId/background-photo/:size": P.projectMember,
  "GET /api/projects/:projectId/custom-fields": P.projectMember,
  "GET /api/projects/:projectId/issue-templates": P.projectMember,
  "GET /api/projects/:projectId/issues": P.projectMember,
  "GET /api/projects/:projectId/issues/:id": P.issueMember,
  "GET /api/projects/:projectId/issues/:id/activity": P.issueMember,
  "GET /api/projects/:projectId/issues/:id/attachments": P.issueMember,
  "GET /api/projects/:projectId/issues/:id/attachments/:attId": P.issueMember,
  "GET /api/projects/:projectId/issues/:id/collaborators": P.issueMember,
  "GET /api/projects/:projectId/issues/:id/comments": P.issueMember,
  "GET /api/projects/:projectId/issues/assignees": P.projectMember,
  "GET /api/projects/:projectId/issues/counts": P.projectMember,
  "GET /api/projects/:projectId/issues/epics": P.projectMember,
  "GET /api/projects/:projectId/overview": P.projectMember,
  "GET /api/projects/:projectId/recurring": P.projectMember,
  "GET /api/projects/:projectId/recurring/:id/runs": P.projectMember,
  "GET /api/projects/:projectId/saved-views": P.projectMember,
  "GET /api/projects/:projectId/sprints": P.sprintsOffRead,
  "GET /api/projects/:projectId/webhooks": P.adminOnly,
  "GET /api/projects/:projectId/webhooks/:id/deliveries": P.adminOnly,
  "GET /api/projects/:projectId/webhooks/:id/deliveries/:deliveryId": P.adminOnly,
  "GET /api/projects/:projectId/workflow": P.projectMember,
  "GET /api/recurring/config": P.userRead,
  "GET /api/reports/issues.csv": P.userRead,
  "GET /api/reports/summary": P.userRead,
  "GET /api/roadmap": P.userRead,
  "GET /api/users": P.adminOnly,
  "GET /api/users/:id/avatar": P.userRead,
  "GET /api/users/pickable": P.userRead,
  "GET /api/ws": P.websocket,
  "GET /health": P.public,
  "GET /metrics": P.public,
  "GET /ready": P.public,
  "PATCH /api/admin/brand": P.adminOnly,
  "PATCH /api/admin/service-accounts/:id": P.adminOnly,
  "PATCH /api/admin/setup": P.adminOnly,
  "PATCH /api/dashboards/:dashboardId": P.foreignPersonalWrite,
  "PATCH /api/departments/:id": P.adminOnly,
  "PATCH /api/notifications/prefs": P.userWrite,
  "PATCH /api/projects/:projectId": P.adminOnly,
  "PATCH /api/projects/:projectId/appearance": P.projectPrivileged,
  "PATCH /api/projects/:projectId/custom-fields/:fieldId": P.projectPrivileged,
  "PATCH /api/projects/:projectId/issue-templates/:templateId": P.projectPrivileged,
  "PATCH /api/projects/:projectId/issues/:id": P.issueOwnerOnly,
  "PATCH /api/projects/:projectId/issues/:id/checklist/:itemId": P.issueOwnerOnly,
  "PATCH /api/projects/:projectId/issues/:id/sprint": P.sprintsOffWrite,
  "PATCH /api/projects/:projectId/issues/bulk": P.projectMember,
  "PATCH /api/projects/:projectId/milestones/:milestoneId": P.projectPrivileged,
  "PATCH /api/projects/:projectId/recurring/:id": P.projectPrivileged,
  "PATCH /api/projects/:projectId/roadmap": P.projectPrivileged,
  "PATCH /api/projects/:projectId/saved-views/:viewId": { ...P.projectMember, empForeign: 404 },
  "PATCH /api/projects/:projectId/webhooks/:id": P.adminOnly,
  "PATCH /api/users/:id": P.adminOnly,
  "POST /api/admin/brand/logo": P.adminOnly,
  "POST /api/admin/demo-project": P.adminOnly,
  "POST /api/admin/service-accounts": P.adminOnly,
  "POST /api/admin/service-accounts/:id/tokens": P.adminOnly,
  "POST /api/admin/setup/complete": P.adminOnly,
  "POST /api/admin/users": P.adminOnly,
  "POST /api/auth/login": P.loginFailure,
  "POST /api/auth/logout": P.sessionOnly,
  "POST /api/dashboards": P.userWrite,
  "POST /api/dashboards/data": P.userWrite,
  "POST /api/departments": P.adminOnly,
  "POST /api/ldap/ping": P.adminOnly,
  "POST /api/ldap/resync": P.adminOnly,
  "POST /api/maintenance/run": P.adminOnly,
  "POST /api/me/avatar": P.sessionOnly,
  "POST /api/me/hints/:hintId/dismiss": P.sessionOnly,
  "POST /api/me/onboarding/hide": P.sessionOnly,
  "POST /api/me/onboarding/steps": P.sessionOnly,
  "POST /api/me/tokens": P.sessionOnly,
  "POST /api/notifications/dismiss": P.userWrite,
  "POST /api/notifications/read": P.userWrite,
  "POST /api/projects": P.adminOnly,
  "POST /api/projects/:projectId/background-photo": P.projectPrivileged,
  "POST /api/projects/:projectId/custom-fields": P.projectPrivileged,
  "POST /api/projects/:projectId/dependencies": P.projectPrivileged,
  "POST /api/projects/:projectId/issue-templates": P.projectPrivileged,
  "POST /api/projects/:projectId/issues": P.projectMember,
  "POST /api/projects/:projectId/issues/:id/attachments": P.issueMember,
  "POST /api/projects/:projectId/issues/:id/checklist": P.issueOwnerOnly,
  "POST /api/projects/:projectId/issues/:id/comments": P.issueMember,
  "POST /api/projects/:projectId/issues/:id/links": P.issueOwnerOnly,
  "POST /api/projects/:projectId/issues/:id/transition": P.issueOwnerOnly,
  "POST /api/projects/:projectId/issues/:id/watchers/me": P.issueMember,
  "POST /api/projects/:projectId/milestones": P.projectPrivileged,
  "POST /api/projects/:projectId/recurring": P.projectPrivileged,
  "POST /api/projects/:projectId/recurring/:id/pause": P.projectPrivileged,
  "POST /api/projects/:projectId/recurring/:id/resume": P.projectPrivileged,
  "POST /api/projects/:projectId/recurring/:id/run-now": P.projectPrivileged,
  "POST /api/projects/:projectId/recurring/preview": P.projectMember,
  "POST /api/projects/:projectId/save-as-template": P.projectPrivileged,
  "POST /api/projects/:projectId/saved-views": P.projectMember,
  "POST /api/projects/:projectId/sprints": P.sprintsOffWrite,
  "POST /api/projects/:projectId/sprints/:sprintId/complete": P.sprintsOffWrite,
  "POST /api/projects/:projectId/sprints/:sprintId/start": P.sprintsOffWrite,
  "POST /api/projects/:projectId/webhooks": P.adminOnly,
  "POST /api/projects/:projectId/webhooks/:id/deliveries/:deliveryId/redeliver": P.adminOnly,
  "POST /api/projects/:projectId/webhooks/:id/ping": P.adminOnly,
  "POST /api/projects/:projectId/webhooks/:id/redeliver-failed": P.adminOnly,
  "POST /api/projects/:projectId/webhooks/:id/rotate-secret": P.adminOnly,
  "POST /api/projects/:projectId/workflow/reset": P.projectPrivileged,
  "POST /api/projects/:projectId/workflow/transitions": P.projectPrivileged,
  "PUT /api/departments/:id/members/:userId": P.adminOnly,
  "PUT /api/me/lang": P.sessionOnly,
  "PUT /api/projects/:projectId/favorite": P.projectMember,
  "PUT /api/projects/:projectId/issues/:id/collaborators/:userId": P.issueOwnerOnly,
  "PUT /api/projects/:projectId/issues/:id/custom-fields/:fieldId": P.issueOwnerOnly,
  "PUT /api/projects/:projectId/members/:userId": P.projectPrivileged,
  "PUT /api/projects/:projectId/overview": P.projectPrivileged,
};

/**
 * Корректные тела запросов: нужны только чтобы пройти zod-валидацию (она идёт до прав). Подстановки:
 * "$uuid" — случайный UUID, "$issue" — задача сценария, "$project" — проект сценария. Одна строка — один маршрут, по алфавиту.
 */
export const BODIES: Readonly<Record<string, unknown>> = {
  "PATCH /api/admin/brand": { name: "X" },
  "PATCH /api/admin/service-accounts/:id": { isActive: true },
  "PATCH /api/admin/setup": { instanceName: "X" },
  "PATCH /api/dashboards/:dashboardId": { name: "X" },
  "PATCH /api/departments/:id": { name: "Team X" },
  "PATCH /api/notifications/prefs": { selfWatch: true },
  "PATCH /api/projects/:projectId": { name: "X" },
  "PATCH /api/projects/:projectId/appearance": { icon: "rocket" },
  "PATCH /api/projects/:projectId/custom-fields/:fieldId": { name: "X" },
  "PATCH /api/projects/:projectId/issue-templates/:templateId": { name: "X", typeId: "task", priorityId: "medium", title: "t" },
  "PATCH /api/projects/:projectId/issues/:id": { title: "X" },
  "PATCH /api/projects/:projectId/issues/:id/checklist/:itemId": { done: true },
  "PATCH /api/projects/:projectId/issues/:id/sprint": { sprintId: null },
  "PATCH /api/projects/:projectId/issues/bulk": { action: "priority", issueIds: ["$uuid"], priorityId: "low" },
  "PATCH /api/projects/:projectId/milestones/:milestoneId": { name: "X" },
  "PATCH /api/projects/:projectId/recurring/:id": { name: "X" },
  "PATCH /api/projects/:projectId/roadmap": { startDate: "2026-01-01" },
  "PATCH /api/projects/:projectId/saved-views/:viewId": { name: "v", filter: {} },
  "PATCH /api/projects/:projectId/webhooks/:id": { name: "X" },
  "PATCH /api/users/:id": { globalRole: "member" },
  "POST /api/admin/service-accounts": { username: "svc-x", name: "X" },
  "POST /api/admin/service-accounts/:id/tokens": { name: "x", scope: "read" },
  "POST /api/admin/users": { username: "newuser1", password: "Str0ng-Passw0rd-123!", name: "N", initials: "NN", color: "#112233", jobRole: "qa" },
  "POST /api/auth/login": { username: "nobody-here", password: "wrong-password-1" },
  "POST /api/dashboards": { name: "D" },
  "POST /api/dashboards/data": { widgets: [] },
  "POST /api/departments": { name: "Team X" },
  "POST /api/me/onboarding/steps": { step: "theme" },
  "POST /api/me/tokens": { name: "x", scope: "read" },
  "POST /api/projects": { key: "ZZZ", name: "Z", departmentId: "$uuid" },
  "POST /api/projects/:projectId/custom-fields": { name: "f", fieldType: "text" },
  "POST /api/projects/:projectId/dependencies": { sourceProjectId: "$uuid" },
  "POST /api/projects/:projectId/issue-templates": { name: "X", typeId: "task", priorityId: "medium", title: "t" },
  "POST /api/projects/:projectId/issues": { title: "t", typeId: "task", priorityId: "medium", epicId: null, complexity: null },
  "POST /api/projects/:projectId/issues/:id/checklist": { text: "x" },
  "POST /api/projects/:projectId/issues/:id/comments": { body: "x" },
  "POST /api/projects/:projectId/issues/:id/links": { linkedIssueId: "$uuid", type: "relates" },
  "POST /api/projects/:projectId/issues/:id/transition": { to: "$uuid" },
  "POST /api/projects/:projectId/milestones": { name: "M", date: "2026-12-01" },
  "POST /api/projects/:projectId/recurring": { name: "R", templateId: "$uuid", schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: "2026-01-01" },
  "POST /api/projects/:projectId/recurring/preview": { schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: "2026-01-01" },
  "POST /api/projects/:projectId/save-as-template": { name: "T" },
  "POST /api/projects/:projectId/saved-views": { name: "v", filter: {} },
  "POST /api/projects/:projectId/sprints": { name: "S" },
  "POST /api/projects/:projectId/webhooks": { name: "h", url: "https://example.com/h", events: ["issue.created"] },
  "POST /api/projects/:projectId/webhooks/:id/redeliver-failed": {},
  "POST /api/projects/:projectId/workflow/transitions": { from: "$uuid", to: "$uuid" },
  "PUT /api/me/lang": { lang: "ru" },
  "PUT /api/projects/:projectId/issues/:id/custom-fields/:fieldId": { value: "x" },
  "PUT /api/projects/:projectId/members/:userId": { role: "viewer" },
  "PUT /api/projects/:projectId/overview": { widgets: [] },
};

/** Обязательные query-параметры (тоже валидируются до прав). Одна строка — один маршрут, по алфавиту. */
export const QUERIES: Readonly<Record<string, string>> = {
  "GET /api/issues/resolve": "key=CORP-1",
  "GET /api/issues/search": "q=test",
  "GET /api/reports/issues.csv": "from=2026-01-01&to=2026-12-31",
  "GET /api/reports/summary": "from=2026-01-01&to=2026-12-31",
  "POST /api/maintenance/run": "dryRun=true",
};
