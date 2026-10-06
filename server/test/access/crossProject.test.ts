/**
 * SEC-IDOR-01, часть 3: межпроектный IDOR на реальных вложенных объектах.
 *
 * accessMatrix.test.ts проверяет, КТО проходит проверку прав; вложенные идентификаторы там — случайные UUID, поэтому
 * главный вектор IDOR не проверяется: участник P1 с полными правами идёт по пути СВОЕГО проекта, но подставляет id
 * объекта, который принадлежит P2 (или соседней задаче P1). Проверка прав по :projectId/:id проходит, и всё решает
 * то, ограничен ли поиск вложенного объекта родителем из пути.
 *
 * Здесь для каждого маршрута манифеста с вложенным параметром:
 *   - «чужой проект»   — родители из P1, последний вложенный объект из P2 → 404;
 *   - «всё из P2»      — все вложенные объекты из P2 при :projectId = P1 → 404 (если вложенных параметров больше одного);
 *   - «соседняя задача» — путь задачи A, объект задачи B того же проекта → 404 (для вложений, пунктов чеклиста, связей);
 *   - контроль         — тот же запрос с объектами P1 НЕ даёт 401/403/404/5xx: иначе 404 выше ничего не доказывает
 *                        (выключенный модуль, неверный URL, сломанная фикстура тоже отвечают 404).
 * Каждый вариант выполняют глобальный админ (видит P2 — 404 ему даёт только привязка к пути) и mgr1, менеджер P1 без
 * доступа к P2 (403, если у менеджера нет права на маршрут). Ответ совпадает с ответом на несуществующий id с теми же
 * родителями. После каждого запроса объекты P2 и задачи B побайтно те же, что до него: так ловится «изменили, потом
 * ответили 404».
 *
 * Отдельно — идентификаторы чужого проекта в ТЕЛЕ запроса (связь, переход, спринт, родитель, эпик, шаблон…) и
 * сквозной инвариант «в данных P1 нет ссылок на объекты P2».
 *
 * Правило ответа — docs/SECURITY_OVERVIEW.md, «Правило 404 / 403». Новый вложенный параметр в манифесте без записи
 * в OWNED или NOT_OWNED валит первый тест этого файла.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "../helpers.js";
import { loadConfig } from "../../src/config.js";
import { _allowLoopbackForTests, parseTargetRules } from "../../src/services/egress.js";
import { _setWebhookLookupForTests } from "../../src/services/webhooks.js";
import { stopWebhookDispatch } from "../../src/services/webhookDispatch.js";
import { BODIES, ROUTES } from "./routes.manifest.js";

type Kind =
  | "issue" | "attachment" | "checklistItem" | "link" | "customField" | "issueTemplate" | "milestone"
  | "savedView" | "webhook" | "delivery" | "transition" | "sprint" | "recurringRule";

/** Вложенный параметр пути («<сегмент перед ним>/:<параметр>») → объект, который он адресует. */
const OWNED: Readonly<Record<string, Kind>> = {
  "attachments/:attId": "attachment",
  "checklist/:itemId": "checklistItem",
  "custom-fields/:fieldId": "customField",
  "deliveries/:deliveryId": "delivery",
  "issue-templates/:templateId": "issueTemplate",
  "issues/:id": "issue",
  "links/:linkId": "link",
  "milestones/:milestoneId": "milestone",
  "recurring/:id": "recurringRule",
  "saved-views/:viewId": "savedView",
  "sprints/:sprintId": "sprint",
  "transitions/:id": "transition",
  "webhooks/:id": "webhook",
};

/** Вложенные параметры, которые не адресуют объект проекта, — с причиной. */
const NOT_OWNED: Readonly<Record<string, string>> = {
  "background-photo/:size": "размер превью, не объект",
  "collaborators/:userId": "пользователь — глобальная сущность; кого можно пригласить — access.collaborators.test.ts",
  "dependencies/:sourceProjectId":
    "ссылка на другой проект — межпроектная зависимость по замыслу (ТЗ 5.15); невидимый источник — 404 (roadmap.test.ts и тело ниже)",
  "members/:userId": "пользователь — глобальная сущность; состав проекта — access.roles.test.ts",
};

/** Объекты, привязанные к задаче (а не к проекту), — для варианта «соседняя задача». */
const ISSUE_CHILDREN: ReadonlySet<Kind> = new Set<Kind>(["attachment", "checklistItem", "link"]);

/** Маршруты вне /projects/:projectId с двумя параметрами пути: проверены ниже отдельно или параметр — не объект. */
const OTHER_NESTED: Readonly<Record<string, string>> = {
  "DELETE /api/admin/service-accounts/:id/tokens/:tokenId": "тест «токен другого сервисного аккаунта» ниже",
  "DELETE /api/departments/:id/members/:userId": "пользователь — глобальная сущность",
  "PUT /api/departments/:id/members/:userId": "пользователь — глобальная сущность",
};

const PROJECT_PREFIX = "/api/projects/:projectId/";

interface Param { name: string; key: string }

function nestedParams(template: string): Param[] {
  const segments = template.split("/");
  return segments.flatMap((segment, i) =>
    segment.startsWith(":") && segment !== ":projectId" ? [{ name: segment.slice(1), key: `${segments[i - 1]}/${segment}` }] : [],
  );
}

let app: FastifyInstance;
let fx: Fixture;
const tokens = {} as { admin: string; mgr1: string; mgr2: string };
type Objects = Record<Kind, string>;
/** p1 — объекты P1 (задача A и её дети); p1b — дети задачи B проекта P1; p2 — объекты P2. */
const objs = {} as { p1: Objects; p1b: Pick<Objects, "issue" | "attachment" | "checklistItem" | "link">; p2: Objects };
let p2Status: string;
/** Задача C проекта P1 — цель запросов с идентификаторами P2 в теле (A удаляет контрольный запрос, B — «чужая»). */
let bodyIssue: string;
/** Задача D проекта P1 — цель контрольного «создать связь» (связь с B изменила бы «чужую» задачу B). */
let linkTarget: string;

const cfg = () => loadConfig();
const savedConfig = {} as { webhooks: ReturnType<typeof loadConfig>["webhooks"]; recurringEnabled: boolean };

/* ---------------- фикстура ---------------- */

function mpText(filename: string, text: string) {
  const b = `----taskira${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${b}--\r\n`,
    "utf8",
  );
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

async function call(token: string, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { ...auth(token), ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function ok(token: string, method: string, url: string, payload?: unknown, headers?: Record<string, string>) {
  const res = await call(token, method, url, payload, headers);
  if (res.statusCode >= 300) throw new Error(`фикстура: ${method} ${url} → ${res.statusCode} ${res.body}`);
  return res;
}

const latest = async (sql: string, params: unknown[]) => {
  const rows = await q<{ id: string }>(sql, params);
  if (!rows[0]) throw new Error(`фикстура: нет строки для ${sql}`);
  return rows[0].id;
};

async function seedIssueChildren(project: string, issue: string, token: string) {
  const base = `/api/projects/${project}/issues/${issue}`;
  const file = mpText("note.txt", "just a log line\n");
  await ok(token, "POST", `${base}/attachments`, file.payload, file.headers);
  await ok(token, "POST", `${base}/checklist`, { text: "step" });
  const target = (await ok(token, "POST", `/api/projects/${project}/issues`, newIssue({ title: "link target" }))).json<{ id: string }>().id;
  await ok(token, "POST", `${base}/links`, { linkedIssueId: target, type: "relates" });
  return {
    attachment: await latest(`SELECT id FROM attachments WHERE issue_id = $1`, [issue]),
    checklistItem: await latest(`SELECT id FROM checklist_items WHERE issue_id = $1`, [issue]),
    // Связь хранится в одном направлении, какое выберет сервер.
    link: await latest(`SELECT id FROM issue_links WHERE $1 IN (issue_id, linked_issue_id)`, [issue]),
  };
}

/** Полный набор вложенных объектов проекта: задача с детьми, поля, шаблон, веха, вебхук с доставкой, переход, спринт,
 *  правило повтора и сохранённый фильтр mgr1 (у P2 — тоже mgr1: «бывший участник, чьи строки остались в P2»). */
async function seedProject(project: string, issue: string, token: string): Promise<Objects> {
  const p = `/api/projects/${project}`;
  const children = await seedIssueChildren(project, issue, token);
  await ok(token, "POST", `${p}/custom-fields`, { name: "Field", fieldType: "text" });
  const customField = await latest(`SELECT id FROM custom_fields WHERE project_id = $1`, [project]);
  await ok(token, "PUT", `${p}/issues/${issue}/custom-fields/${customField}`, { value: "v" });
  await ok(token, "POST", `${p}/issue-templates`, { name: "Tpl", typeId: "task", priorityId: "medium", title: "t" });
  const issueTemplate = await latest(`SELECT id FROM issue_templates WHERE project_id = $1`, [project]);
  await ok(token, "POST", `${p}/milestones`, { name: "M", date: "2026-12-01" });
  const milestone = await latest(`SELECT id FROM project_milestones WHERE project_id = $1`, [project]);
  await ok(token, "POST", `${p}/sprints`, { name: "S" });
  const sprint = await latest(`SELECT id FROM sprints WHERE project_id = $1`, [project]);
  await ok(token, "POST", `${p}/recurring`, {
    name: "Daily", templateId: issueTemplate, schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC",
    startDate: new Date().toISOString().slice(0, 10),
  });
  const recurringRule = await latest(`SELECT id FROM recurring_rules WHERE project_id = $1`, [project]);
  await ok(tokens.admin, "POST", `${p}/webhooks`, { name: "Hook", url: "http://hooks.corp.local/h", events: ["issue.created"] });
  const webhook = await latest(`SELECT id FROM webhooks WHERE project_id = $1`, [project]);
  const delivery = await latest(
    `WITH ev AS (INSERT INTO integration_events (project_id, type, dedupe_key, payload, dispatched_at)
                 VALUES ($1, 'ping', gen_random_uuid()::text, '{"type":"ping"}'::jsonb, now()) RETURNING id)
     INSERT INTO webhook_deliveries (webhook_id, event_id, state) SELECT $2, id, 'failed' FROM ev RETURNING id`,
    [project, webhook],
  );
  const transition = await latest(`SELECT id FROM workflow_transitions WHERE project_id = $1 LIMIT 1`, [project]);
  const savedView = await latest(
    `INSERT INTO saved_views (user_id, project_id, name, filter_json) VALUES ($1, $2, 'mine', '{}') RETURNING id`,
    [fx.users.mgr1, project],
  );
  return { issue, ...children, customField, issueTemplate, milestone, sprint, recurringRule, webhook, delivery, transition, savedView };
}

beforeAll(async () => {
  app = await getApp();
  await resetDb();
  fx = await seedFixture();
  savedConfig.webhooks = { ...cfg().webhooks };
  savedConfig.recurringEnabled = cfg().recurring.enabled;
  // Модули, которые иначе отвечают 404/409 до поиска объекта, — включены, чтобы 404 означал именно «не ваш объект».
  Object.assign(cfg().webhooks, {
    enabled: true, secretKey: Buffer.alloc(32, 7), allowHttp: true, allowedTargets: parseTargetRules("*.corp.local"), denyCidrs: [],
  });
  cfg().recurring.enabled = true;
  _allowLoopbackForTests(true);
  _setWebhookLookupForTests(async () => [{ address: "127.0.0.1", family: 4 }]);
  await q(`UPDATE projects SET sprints_enabled = true WHERE id = ANY($1)`, [[fx.projects.p1, fx.projects.p2]]);

  tokens.admin = await login(app, "admin");
  tokens.mgr1 = await login(app, "mgr1");
  tokens.mgr2 = await login(app, "mgr2");
  const issueOf = async (project: string, token: string, title: string) =>
    (await ok(token, "POST", `/api/projects/${project}/issues`, newIssue({ title }))).json<{ id: string }>().id;

  const issueA = await issueOf(fx.projects.p1, tokens.mgr1, "A");
  const issueB = await issueOf(fx.projects.p1, tokens.mgr1, "B");
  objs.p1 = await seedProject(fx.projects.p1, issueA, tokens.admin);
  objs.p1b = { issue: issueB, ...(await seedIssueChildren(fx.projects.p1, issueB, tokens.mgr1)) };
  objs.p2 = await seedProject(fx.projects.p2, fx.issues.p2issue, tokens.admin);
  bodyIssue = await issueOf(fx.projects.p1, tokens.mgr1, "C");
  linkTarget = await issueOf(fx.projects.p1, tokens.mgr1, "D");
  p2Status = await latest(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = 'inprogress'`, [fx.projects.p2]);
});

afterAll(async () => {
  await stopWebhookDispatch();
  _setWebhookLookupForTests(undefined);
  _allowLoopbackForTests(false);
  Object.assign(cfg().webhooks, savedConfig.webhooks);
  cfg().recurring.enabled = savedConfig.recurringEnabled;
  await stopApp();
});

/* ---------------- снимок «чужих» данных ---------------- */

const ISSUE_TABLES = [
  "activity", "attachments", "checklist_items", "comments", "custom_field_values", "issue_assignees",
  "issue_collaborators", "issue_links", "issue_watchers",
] as const;
const PROJECT_ISSUES = "SELECT id FROM issues WHERE project_id = $1";
/** Всё, что принадлежит проекту $1: строка проекта, задачи с детьми и объекты проекта. */
const PROJECT_SCOPE: ReadonlyArray<readonly [string, string]> = [
  ["projects", "id = $1"],
  ["issues", "project_id = $1"],
  ...ISSUE_TABLES.map((t) => [t, `issue_id IN (${PROJECT_ISSUES})`] as const),
  ["issue_links", `linked_issue_id IN (${PROJECT_ISSUES})`],
  ...["custom_fields", "issue_templates", "integration_events", "project_milestones", "recurring_rules", "saved_views", "sprints",
    "webhooks", "workflow_statuses", "workflow_transitions"].map((t) => [t, "project_id = $1"] as const),
  ["recurring_runs", "rule_id IN (SELECT id FROM recurring_rules WHERE project_id = $1)"],
  ["webhook_deliveries", "webhook_id IN (SELECT id FROM webhooks WHERE project_id = $1)"],
];
/** Задача $1 и её дети. */
const ISSUE_SCOPE: ReadonlyArray<readonly [string, string]> = [
  ["issues", "id = $1"],
  ...ISSUE_TABLES.map((t) => [t, "issue_id = $1"] as const),
  ["issue_links", "linked_issue_id = $1"],
];

async function digest(scope: ReadonlyArray<readonly [string, string]>, id: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [table, where] of scope) {
    const [row] = await q<{ d: string }>(
      `SELECT count(*) || ':' || md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text), '')) AS d
         FROM ${table} t WHERE ${where}`,
      [id],
    );
    out[`${table} WHERE ${where}`] = row.d;
  }
  return out;
}
const foreignState = async () => ({
  p2: await digest(PROJECT_SCOPE, fx.projects.p2),
  issueB: await digest(ISSUE_SCOPE, objs.p1b.issue),
});

/** Ссылки из данных P1 на объекты P2 — их не должно быть никогда. */
async function crossReferences(): Promise<Array<{ what: string; n: number }>> {
  return q<{ what: string; n: number }>(
    `SELECT what, n FROM (
       SELECT 'issues.parent_id/epic_id/sprint_id/status_id' AS what, count(*)::int AS n FROM issues i
        WHERE i.project_id = $1 AND (
          i.parent_id IN (SELECT id FROM issues WHERE project_id = $2) OR i.epic_id IN (SELECT id FROM issues WHERE project_id = $2)
          OR i.sprint_id IN (SELECT id FROM sprints WHERE project_id = $2)
          OR i.status_id IN (SELECT id FROM workflow_statuses WHERE project_id = $2))
       UNION ALL
       SELECT 'issue_links', count(*)::int FROM issue_links
        WHERE issue_id IN (SELECT id FROM issues WHERE project_id = $1) AND linked_issue_id IN (SELECT id FROM issues WHERE project_id = $2)
       UNION ALL
       SELECT 'custom_field_values', count(*)::int FROM custom_field_values
        WHERE issue_id IN (SELECT id FROM issues WHERE project_id = $1) AND custom_field_id IN (SELECT id FROM custom_fields WHERE project_id = $2)
       UNION ALL
       SELECT 'workflow_transitions', count(*)::int FROM workflow_transitions
        WHERE project_id = $1 AND (from_status_id IN (SELECT id FROM workflow_statuses WHERE project_id = $2)
                                   OR to_status_id IN (SELECT id FROM workflow_statuses WHERE project_id = $2))
       UNION ALL
       SELECT 'issue_templates.status_id', count(*)::int FROM issue_templates
        WHERE project_id = $1 AND status_id IN (SELECT id FROM workflow_statuses WHERE project_id = $2)
       UNION ALL
       SELECT 'recurring_rules.template_id', count(*)::int FROM recurring_rules
        WHERE project_id = $1 AND template_id IN (SELECT id FROM issue_templates WHERE project_id = $2)
       UNION ALL
       SELECT 'project_dependencies', count(*)::int FROM project_dependencies
        WHERE dependent_project_id = $1 AND source_project_id = $2
     ) x WHERE n > 0`,
    [fx.projects.p1, fx.projects.p2],
  );
}

/* ---------------- маршруты с вложенными объектами ---------------- */

interface Case { key: string; method: string; template: string; params: Param[]; actor: keyof typeof tokens }

const CASES: Case[] = Object.keys(ROUTES)
  .filter((key) => key.split(" ")[1].startsWith(PROJECT_PREFIX))
  .map((key) => {
    const [method, template] = key.split(" ", 2) as [string, string];
    const params = nestedParams(template).filter((p) => p.key in OWNED);
    // Основной исполнитель и контроль — глобальный админ: у mgr1 нет editWorkflow и прав на вебхуки, а контроль
    // должен пройти. Исключение — личные сохранённые фильтры: их видит только владелец (mgr1).
    const actor = params.some((p) => OWNED[p.key] === "savedView") ? "mgr1" as const : "admin" as const;
    return { key, method, template, params, actor };
  })
  .filter((c) => c.params.length > 0)
  // Сначала чтение и изменение, удаления — в конце, от глубоких путей к коротким (правило повтора раньше шаблона,
  // на который оно ссылается): контрольный запрос удаления уничтожает объект P1, нужный остальным.
  .sort((a, b) => {
    const del = Number(a.method === "DELETE") - Number(b.method === "DELETE");
    if (del !== 0) return del;
    if (a.method !== "DELETE") return a.key < b.key ? -1 : 1;
    const depth = b.template.split("/").length - a.template.split("/").length;
    return depth !== 0 ? depth : a.key < b.key ? 1 : -1;
  });

/** Тела вместо BODIES: где тело ссылается на объект (контролю нужен настоящий объект P1) или это файл. */
const CASE_BODIES: Readonly<Record<string, () => { payload: unknown; headers?: Record<string, string> }>> = {
  "POST /api/projects/:projectId/issues/:id/attachments": () => mpText("control.txt", "control\n"),
  "POST /api/projects/:projectId/issues/:id/links": () => ({ payload: { linkedIssueId: linkTarget, type: "blocks" } }),
  "POST /api/projects/:projectId/issues/:id/transition": () => ({ payload: { to: fx.p1status.inprogress } }),
};

function fill(value: unknown): unknown {
  if (value === "$uuid") return randomUUID();
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
  return value;
}

function urlFor(c: Case, pick: (param: Param, index: number) => string): string {
  let i = 0;
  return c.template.replace(/:(\w+)/g, (_m, name: string) => {
    if (name === "projectId") return fx.projects.p1;
    const param = c.params.find((p) => p.name === name);
    if (!param) return name === "userId" ? fx.users.mgr2 : name === "size" ? "sm" : name === "sourceProjectId" ? fx.projects.p2 : randomUUID();
    return pick(param, i++);
  });
}

describe("межпроектный IDOR: вложенные объекты по пути своего проекта", () => {
  test("каждый вложенный параметр манифеста классифицирован (OWNED / NOT_OWNED / OTHER_NESTED)", () => {
    const problems: string[] = [];
    for (const key of Object.keys(ROUTES)) {
      const template = key.split(" ")[1];
      const params = nestedParams(template);
      if (template.startsWith(PROJECT_PREFIX)) {
        for (const p of params) {
          if (!(p.key in OWNED) && !(p.key in NOT_OWNED)) {
            problems.push(`${key}: параметр «${p.key}» — добавьте его в OWNED (и засейте объект в seedProject) или в NOT_OWNED с причиной`);
          }
        }
      } else if (params.length > 1 && !(key in OTHER_NESTED)) {
        problems.push(`${key}: вложенный ресурс вне проекта — проверьте «объект другого родителя» и добавьте в OTHER_NESTED`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
    expect(CASES.length).toBeGreaterThan(40);
  });

  test.each(CASES.map((c) => [c.key, c] as const))("%s", async (_key, c) => {
    // Тело собирается заново на каждый запрос: multipart-буфер одноразовый.
    const send = (actor: keyof typeof tokens, url: string) => {
      const custom = CASE_BODIES[c.key]?.();
      return call(tokens[actor], c.method, url, custom ? custom.payload : fill(BODIES[c.key]), custom?.headers);
    };
    type Pick = (param: Param, index: number) => string;
    const last = c.params.length - 1;
    const variants: Array<[string, Pick]> = [["чужой проект (родители P1, объект P2)", (p, i) => (i === last ? objs.p2 : objs.p1)[OWNED[p.key]]]];
    if (c.params.length > 1) variants.push(["все вложенные объекты из P2", (p) => objs.p2[OWNED[p.key]]]);
    const leafKind = OWNED[c.params[last].key];
    if (ISSUE_CHILDREN.has(leafKind)) {
      variants.push(["соседняя задача (путь задачи A, объект задачи B)", (p, i) => (i === last ? objs.p1b[leafKind as "link"] : objs.p1[OWNED[p.key]])]);
    }
    // Злоумышленник из тикета — участник P1 без доступа к P2 (mgr1). Админ дополнительно: он видит P2, поэтому 404 ему
    // может дать только привязка объекта к пути. mgr1 без нужного права получает 403 раньше поиска объекта — это не утечка,
    // но ответ всё равно обязан совпасть с ответом на несуществующий id.
    const actors: Array<keyof typeof tokens> = c.actor === "admin" ? ["admin", "mgr1"] : [c.actor];
    const missingId = randomUUID();
    const shape = (res: Awaited<ReturnType<typeof send>>, id: string) => ({ status: res.statusCode, body: res.body.split(id).join("<id>") });

    const before = await foreignState();
    for (const actor of actors) {
      for (const [label, pick] of variants) {
        const url = urlFor(c, pick);
        const leafId = pick(c.params[last], last);
        const res = await send(actor, url);
        const where = `${label} [${actor}]: ${c.method} ${url} → ${res.statusCode} ${res.body.slice(0, 200)}`;
        if (actor === c.actor) expect(res.statusCode, where).toBe(404);
        else expect([403, 404], where).toContain(res.statusCode);
        expect(await foreignState(), `${where}: изменены чужие данные`).toEqual(before);
        // Ответ неотличим от ответа на несуществующий объект с теми же родителями.
        const missing = await send(actor, urlFor(c, (p, i) => (i === last ? missingId : pick(p, i))));
        expect(shape(res, leafId), `${where}: ответ отличается от ответа на несуществующий id`).toEqual(shape(missing, missingId));
      }
    }

    // Контроль: с объектами P1 маршрут доходит до обработчика — 404 выше означал «не ваш объект», а не «маршрута нет».
    const controlUrl = urlFor(c, (p) => objs.p1[OWNED[p.key]]);
    const control = await send(c.actor, controlUrl);
    const where = `контроль: ${c.method} ${controlUrl} → ${control.statusCode} ${control.body.slice(0, 200)}`;
    expect([401, 403, 404], where).not.toContain(control.statusCode);
    expect(control.statusCode, where).toBeLessThan(500);
    expect(await foreignState(), `${where} изменил данные P2 или задачи B`).toEqual(before);
  });
});

/* ---------------- идентификаторы чужого проекта в теле запроса ---------------- */

describe("межпроектный IDOR: идентификаторы P2 в теле запроса по пути P1", () => {
  const p1 = () => `/api/projects/${fx.projects.p1}`;
  const issueC = () => `${p1()}/issues/${bodyIssue}`;
  // Действует участник P1 без доступа к P2 (mgr1); маршруты только для администратора — от глобального админа.
  // Ожидание: отказ (400/404), неотличимый от отказа на несуществующий id, — объект P2 не «узнаётся» по ответу;
  // данные P2 не меняются; в данных P1 не появляется ссылка на P2.
  type BodyCase = readonly [label: string, actor: keyof typeof tokens, method: string, url: () => string, body: (id: string) => unknown, p2Id: () => string];
  const recurringBody = (templateId: string) => ({
    name: "R", templateId, schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: new Date().toISOString().slice(0, 10),
  });
  const BODY_CASES: ReadonlyArray<BodyCase> = [
    ["связь с задачей P2", "mgr1", "POST", () => `${issueC()}/links`, (id) => ({ linkedIssueId: id, type: "relates" }), () => fx.issues.p2issue],
    ["переход в статус P2", "mgr1", "POST", () => `${issueC()}/transition`, (id) => ({ to: id }), () => p2Status],
    ["спринт P2", "mgr1", "PATCH", () => `${issueC()}/sprint`, (id) => ({ sprintId: id }), () => objs.p2.sprint],
    ["родитель — задача P2", "mgr1", "PATCH", issueC, (id) => ({ parentId: id }), () => fx.issues.p2issue],
    ["направление (эпик) — задача P2", "mgr1", "PATCH", issueC, (id) => ({ epicId: id }), () => fx.issues.p2issue],
    ["новая задача с родителем из P2", "mgr1", "POST", () => `${p1()}/issues`, (id) => newIssue({ parentId: id }), () => fx.issues.p2issue],
    ["новая задача с эпиком из P2", "mgr1", "POST", () => `${p1()}/issues`, (id) => newIssue({ epicId: id }), () => fx.issues.p2issue],
    ["правило повтора по шаблону P2", "mgr1", "POST", () => `${p1()}/recurring`, recurringBody, () => objs.p2.issueTemplate],
    ["зависимость от невидимого проекта P2", "mgr1", "POST", () => `${p1()}/dependencies`, (id) => ({ sourceProjectId: id }), () => fx.projects.p2],
    ["переход workflow в статус P2", "admin", "POST", () => `${p1()}/workflow/transitions`, (id) => ({ from: fx.p1status.todo, to: id }), () => p2Status],
    ["переход workflow из статуса P2", "admin", "POST", () => `${p1()}/workflow/transitions`, (id) => ({ from: id, to: fx.p1status.inprogress }), () => p2Status],
    ["шаблон задачи со статусом P2", "admin", "POST", () => `${p1()}/issue-templates`,
      (id) => ({ name: "X", typeId: "task", priorityId: "medium", title: "t", statusId: id }), () => p2Status],
  ];

  test.each(BODY_CASES.map((row) => [row[0], row] as const))("%s", async (_label, [label, actor, method, url, body, p2Id]) => {
    const before = await foreignState();
    const foreign = await call(tokens[actor], method, url(), body(p2Id()));
    const where = `${label}: ${method} ${url()} → ${foreign.statusCode} ${foreign.body.slice(0, 200)}`;
    expect([400, 404], where).toContain(foreign.statusCode);
    expect(await foreignState(), `${label}: изменились данные P2`).toEqual(before);
    expect(await crossReferences(), `${label}: в данных P1 появилась ссылка на объект P2`).toEqual([]);
    const missingId = randomUUID();
    const missing = await call(tokens[actor], method, url(), body(missingId));
    const shape = (res: typeof foreign, id: string) => ({ status: res.statusCode, body: res.body.split(id).join("<id>") });
    expect(shape(foreign, p2Id()), `${label}: ответ на объект P2 отличается от ответа на несуществующий id`).toEqual(shape(missing, missingId));
  });

  test("массовые действия по задаче P2 из пути P1 её не трогают", async () => {
    const before = await foreignState();
    for (const payload of [
      { action: "status", issueIds: [fx.issues.p2issue], statusId: fx.p1status.inprogress },
      { action: "priority", issueIds: [fx.issues.p2issue], priorityId: "low" },
      { action: "assignee", issueIds: [fx.issues.p2issue], assigneeId: fx.users.mgr1 },
      { action: "delete", issueIds: [fx.issues.p2issue] },
    ]) {
      const res = await call(tokens.mgr1, "PATCH", `${p1()}/issues/bulk`, payload);
      expect(res.statusCode, `${payload.action}: ${res.body.slice(0, 200)}`).toBeLessThan(500);
      expect([200, 400, 404], `${payload.action}: ${res.statusCode}`).toContain(res.statusCode);
      expect(await foreignState(), `bulk ${payload.action}: изменились данные P2`).toEqual(before);
    }
  });

  test("инвариант: после всех запросов файла в данных P1 нет ссылок на объекты P2", async () => {
    expect(await crossReferences()).toEqual([]);
  });
});

/* ---------------- вложенные ресурсы вне проекта ---------------- */

describe("объект другого родителя вне проекта", () => {
  test("токен другого сервисного аккаунта: отзыв по пути своего аккаунта — 404, токен жив", async () => {
    const svc = async (username: string) => {
      await ok(tokens.admin, "POST", "/api/admin/service-accounts", { username, name: username });
      return latest(`SELECT id FROM users WHERE username = $1`, [username]);
    };
    const own = await svc("svc-own");
    const other = await svc("svc-other");
    await ok(tokens.admin, "POST", `/api/admin/service-accounts/${other}/tokens`, { name: "ci", scope: "read" });
    const token = await latest(`SELECT id FROM api_tokens WHERE user_id = $1`, [other]);
    const res = await call(tokens.admin, "DELETE", `/api/admin/service-accounts/${own}/tokens/${token}`);
    expect(res.statusCode, res.body).toBe(404);
    expect((await q<{ revoked_at: Date | null }>(`SELECT revoked_at FROM api_tokens WHERE id = $1`, [token]))[0].revoked_at).toBeNull();
    // Контроль: по своему пути отзывается.
    expect((await call(tokens.admin, "DELETE", `/api/admin/service-accounts/${other}/tokens/${token}`)).statusCode).toBe(204);
  });
});
