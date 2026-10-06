/**
 * SEC-IDOR-01, часть 2: табличный прогон матрицы доступа на реальной БД.
 *
 * Фикстура — две команды, два проекта (seedFixture) + пользователи каждого типа (см. SCENARIOS в манифесте).
 * Каждая запись routes.manifest.ts выполняется под шестью сценариями; ожидание — из политики записи.
 * Отказы ничего не меняют; «ALLOW»-записи, меняющие состояние, безобидны (комментарий, избранное, свой токен…) и
 * идемпотентны по отношению к проверкам, поэтому фикстура одна на файл.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "../helpers.js";
import { invalidateUserCache } from "../../src/middleware.js";
import { generateToken } from "../../src/services/apiTokens.js";
import { BODIES, QUERIES, RELOGIN_AFTER, ROUTES, SCENARIOS, type Scenario } from "./routes.manifest.js";

let app: FastifyInstance;
let fx: Fixture;

interface Ctx {
  project: string;
  issue: string;
  /** Заголовки аутентификации; пусто для anon. */
  headers: () => Record<string, string>;
  /** Перелогин (для маршрутов, гасящих сессию вызывающего). */
  relogin?: () => Promise<void>;
}
const ctx = {} as Record<Scenario, Ctx>;
const shared = {} as { dashboard: string; view: string; foreignToken: string };

async function mkMember(username: string): Promise<string> {
  const hash = await bcrypt.hash(fx.pass, 4);
  const [row] = await q<{ id: string }>(
    `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role)
     VALUES ($1, $2, $1, 'XX', '#334455', 'qa', 'member') RETURNING id`,
    [username, hash],
  );
  return row.id;
}

beforeAll(async () => {
  app = await getApp();
  await resetDb();
  fx = await seedFixture();
  const json = (res: { statusCode: number; body: string }, status: number) => {
    if (res.statusCode !== status) throw new Error(`fixture: ожидали ${status}, получили ${res.statusCode}: ${res.body}`);
    return JSON.parse(res.body) as { id: string };
  };

  const mgr1 = await login(app, "mgr1");
  // «Чужая» задача P1: автор mgr1, исполнителей нет — emp1 её не редактирует.
  const foreignIssue = json(
    await app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/issues`, headers: auth(mgr1), payload: newIssue() }),
    201,
  ).id;
  // Чужие личные ресурсы mgr1: дашборд, сохранённый фильтр проекта, API-токен.
  shared.dashboard = json(await app.inject({ method: "POST", url: "/api/dashboards", headers: auth(mgr1), payload: { name: "mgr1 personal" } }), 201).id;
  shared.view = json(
    await app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/saved-views`, headers: auth(mgr1), payload: { name: "mgr1 view", filter: {} } }),
    201,
  ).id;
  const created = JSON.parse((await app.inject({ method: "POST", url: "/api/me/tokens", headers: auth(mgr1), payload: { name: "mgr1", scope: "read" } })).body);
  shared.foreignToken = created.token.id;

  // collabOther: приглашён к p1issue, ходит на foreignIssue.
  const collab = await mkMember("collab1");
  await q(`INSERT INTO issue_collaborators (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p1issue, collab]);

  // deactivated: был employee P1, сессия выдана до деактивации.
  const gone = await mkMember("gone1");
  await q(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'employee')`, [fx.projects.p1, gone]);
  const goneToken = await login(app, "gone1");
  await q(`UPDATE users SET is_active = false WHERE id = $1`, [gone]);
  invalidateUserCache(gone);

  // tokenOutOfScope: токен read пользователя emp1 (employee P1) против проекта P2.
  const generated = generateToken();
  await q(
    `INSERT INTO api_tokens (user_id, name, prefix, secret_hash, scope, created_by, expires_at)
     VALUES ($1, 'matrix', $2, $3, 'read', $1, now() + interval '1 day')`,
    [fx.users.emp1, generated.prefix, generated.hash],
  );

  const session = (username: string, c: Pick<Ctx, "project" | "issue">): Ctx => {
    let token = "";
    const self: Ctx = { ...c, headers: () => auth(token), relogin: async () => void (token = await login(app, username)) };
    return self;
  };
  const withToken = async (username: string, c: Pick<Ctx, "project" | "issue">) => {
    const s = session(username, c);
    await s.relogin!();
    return s;
  };

  ctx.anon = { project: fx.projects.p1, issue: fx.issues.p1issue, headers: () => ({}) };
  ctx.outsider = await withToken("outsider", { project: fx.projects.p1, issue: fx.issues.p1issue });
  ctx.empForeign = await withToken("emp1", { project: fx.projects.p1, issue: foreignIssue });
  ctx.collabOther = await withToken("collab1", { project: fx.projects.p1, issue: foreignIssue });
  ctx.deactivated = { project: fx.projects.p1, issue: fx.issues.p1issue, headers: () => auth(goneToken) };
  ctx.tokenOutOfScope = { project: fx.projects.p2, issue: fx.issues.p2issue, headers: () => auth(generated.token) };
});
afterAll(async () => {
  await stopApp();
});

function fill(value: unknown, c: Ctx): unknown {
  if (value === "$uuid") return randomUUID();
  if (value === "$issue") return c.issue;
  if (value === "$project") return c.project;
  if (Array.isArray(value)) return value.map((v) => fill(v, c));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, c)]));
  return value;
}

function buildUrl(key: string, c: Ctx): { method: string; url: string } {
  const [method, template] = key.split(" ", 2) as [string, string];
  const url = template.replace(/:(\w+)/g, (_m, name: string) => {
    switch (name) {
      case "projectId": return c.project;
      case "id": return template.includes("/issues/:id") ? c.issue : key === "DELETE /api/me/tokens/:id" ? shared.foreignToken : randomUUID();
      case "dashboardId": return shared.dashboard;
      case "viewId": return shared.view;
      case "userId": return fx.users.mgr2;
      case "size": return "sm";
      case "hintId": return "welcome";
      default: return randomUUID();
    }
  });
  const query = QUERIES[key];
  return { method, url: query ? `${url}?${query}` : url };
}

describe.each(SCENARIOS)("матрица доступа: %s", (scenario) => {
  test.each(Object.entries(ROUTES))("%s", async (key, policy) => {
    const expected = policy[scenario];
    if (expected === "N/A") return;
    const c = ctx[scenario];
    const { method, url } = buildUrl(key, c);
    const body = BODIES[key];
    const res = await app.inject({
      method: method as "GET",
      url,
      headers: c.headers(),
      ...(body === undefined ? {} : { payload: fill(body, c) as object }),
    });
    const where = `${method} ${url} [${scenario}] → ${res.statusCode} ${res.body.slice(0, 200)}`;
    const denied = res.statusCode === 401 || res.statusCode === 403;
    if (expected === "ALLOW") {
      expect(denied, `ожидался доступ, получен отказ: ${where}`).toBe(false);
      expect(res.statusCode, `ожидался доступ, получена ошибка сервера: ${where}`).toBeLessThan(500);
    } else {
      const hint =
        res.statusCode === 400
          ? "\nПохоже, валидация сработала раньше проверки прав: добавьте корректное тело/query в BODIES/QUERIES (routes.manifest.ts)."
          : "";
      expect(res.statusCode, `ожидался ${expected}: ${where}${hint}`).toBe(expected);
    }
    if (RELOGIN_AFTER.has(key)) await c.relogin?.();
  });
});

/* ---------------- 404 vs 403: что узнаёт посторонний о существовании ресурса ----------------
   Правило — docs/SECURITY_OVERVIEW.md, «Правило 404 / 403». Здесь закреплено фактическое поведение. */
describe("раскрытие существования ресурса", () => {
  const get = (c: Ctx, url: string) => app.inject({ method: "GET", url, headers: c.headers() });

  test("личные ресурсы: чужой и несуществующий неразличимы (404 с одним телом)", async () => {
    const c = ctx.outsider;
    const foreign = await get(c, `/api/dashboards/${shared.dashboard}`);
    const missing = await get(c, `/api/dashboards/${randomUUID()}`);
    expect([foreign.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(foreign.json()).toEqual(missing.json());
  });

  test("ключ задачи вне видимости: resolve отвечает так же, как на несуществующий ключ", async () => {
    const c = ctx.outsider;
    const hidden = await get(c, "/api/issues/resolve?key=CORP-1");
    const missing = await get(c, "/api/issues/resolve?key=NOPE-99");
    expect(hidden.statusCode).toBe(missing.statusCode);
    expect(hidden.json()).toEqual(missing.json());
    expect(hidden.body).not.toContain(fx.projects.p1);
  });

  test("поиск, «мои задачи», роадмап и список проектов не отдают чужие проекты и задачи", async () => {
    const c = ctx.outsider;
    for (const url of ["/api/issues/search?q=t", "/api/issues/assigned-to-me", "/api/roadmap", "/api/projects"]) {
      const res = await get(c, url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain(fx.projects.p1);
      expect(res.body, url).not.toContain(fx.issues.p1issue);
    }
  });

  test("задача другого проекта по пути своего проекта — 404, не 403 (участник P1 не узнаёт о задачах P2)", async () => {
    const res = await get(ctx.empForeign, `/api/projects/${fx.projects.p1}/issues/${fx.issues.p2issue}`);
    expect(res.statusCode).toBe(404);
  });

  // Известное отступление от правила (SEC-IDOR-02, docs/tickets/SEC-IDOR-02-project-existence-oracle.md, low):
  // по «не своему» :projectId существующий проект отвечает 403, несуществующий — 404. Идентификаторы — UUIDv4, их не
  // перебрать, поэтому severity низкая; тест фиксирует поведение, чтобы смена была осознанной (поменять ожидание
  // и правило в SECURITY_OVERVIEW одним PR).
  test("ИЗВЕСТНО: существование проекта и задачи по UUID различимо (403 против 404)", async () => {
    const c = ctx.outsider;
    expect((await get(c, `/api/projects/${fx.projects.p1}`)).statusCode).toBe(403);
    expect((await get(c, `/api/projects/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(c, `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`)).statusCode).toBe(403);
    expect((await get(c, `/api/projects/${fx.projects.p1}/issues/${randomUUID()}`)).statusCode).toBe(404);
  });
});
