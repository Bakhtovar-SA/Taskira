/** ТЗ 5.11 — онбординг. Проверки из ТЗ:
 *  - шаги «Начала работы» отмечаются от реальных действий (тест на каждый);
 *  - удаление демо-проекта не оставляет строк в БД. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import type { OnboardingDto, SetupStatusDto } from "../src/contract.js";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const onboarding = async (token: string) => JSON.parse((await app.inject({ url: "/api/me/onboarding", headers: auth(token) })).body) as OnboardingDto;
const P1 = () => `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`;

describe("«Начало работы»: шаги отмечаются от реальных действий", () => {
  test("новый пользователь — ничего не отмечено, карточка не скрыта", async () => {
    expect(await onboarding(await login(app, "emp1"))).toEqual({ done: [], hidden: false, hints: [] });
  });

  test("открыть свою задачу — да; чужую — нет", async () => {
    const mgr = await login(app, "mgr1"); // не исполнитель p1issue
    await app.inject({ url: P1(), headers: auth(mgr) });
    expect((await onboarding(mgr)).done).toEqual([]);
    const emp = await login(app, "emp1"); // исполнитель
    expect((await app.inject({ url: P1(), headers: auth(emp) })).statusCode).toBe(200);
    expect((await onboarding(emp)).done).toEqual(["open_issue"]);
  });

  test("сменить статус", async () => {
    const emp = await login(app, "emp1");
    const r = await app.inject({ method: "POST", url: `${P1()}/transition`, headers: auth(emp), payload: { to: fx.p1status.inprogress } });
    expect(r.statusCode).toBe(200);
    expect((await onboarding(emp)).done).toContain("change_status");
  });

  test("неудачная смена статуса (против схемы) шаг не отмечает", async () => {
    const emp = await login(app, "emp1");
    const [done] = await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = 'review'`, [fx.projects.p1]);
    const r = await app.inject({ method: "POST", url: `${P1()}/transition`, headers: auth(emp), payload: { to: done.id } });
    expect(r.statusCode).toBe(409);
    expect((await onboarding(emp)).done).not.toContain("change_status");
  });

  test("оставить комментарий", async () => {
    const emp = await login(app, "emp1");
    const r = await app.inject({ method: "POST", url: `${P1()}/comments`, headers: auth(emp), payload: { body: "Беру в работу" } });
    expect(r.statusCode).toBe(201);
    expect((await onboarding(emp)).done).toContain("comment");
  });

  test("настроить уведомления", async () => {
    const emp = await login(app, "emp1");
    await app.inject({ method: "PATCH", url: "/api/notifications/prefs", headers: auth(emp), payload: { email: "daily" } });
    expect((await onboarding(emp)).done).toContain("notifications");
  });

  test("тема — единственный шаг, о котором сообщает клиент; остальные так не отметить", async () => {
    const emp = await login(app, "emp1");
    expect((await app.inject({ method: "POST", url: "/api/me/onboarding/steps", headers: auth(emp), payload: { step: "comment" } })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/me/onboarding/steps", headers: auth(emp), payload: { step: "theme" } });
    expect((JSON.parse(r.body) as OnboardingDto).done).toEqual(["theme"]);
    // Повтор не дублирует.
    await app.inject({ method: "POST", url: "/api/me/onboarding/steps", headers: auth(emp), payload: { step: "theme" } });
    expect((await onboarding(emp)).done).toEqual(["theme"]);
  });

  test("карточку можно скрыть навсегда; подсказки закрываются по одной и не повторяются", async () => {
    const emp = await login(app, "emp1");
    expect((await app.inject({ method: "POST", url: "/api/me/onboarding/hide", headers: auth(emp) })).statusCode).toBe(204);
    for (const id of ["saved-views", "palette", "saved-views"]) await app.inject({ method: "POST", url: `/api/me/hints/${id}/dismiss`, headers: auth(emp) });
    expect((await app.inject({ method: "POST", url: "/api/me/hints/Bad Id/dismiss", headers: auth(emp) })).statusCode).toBe(400);
    const o = await onboarding(emp);
    expect(o.hidden).toBe(true);
    expect(o.hints).toEqual(["palette", "saved-views"]);
    // Прогресс другого пользователя не задет.
    expect(await onboarding(await login(app, "mgr1"))).toEqual({ done: [], hidden: false, hints: [] });
  });
});

describe("первичная настройка администратора", () => {
  const setup = async (token: string) => JSON.parse((await app.inject({ url: "/api/admin/setup", headers: auth(token) })).body) as SetupStatusDto;

  test("новая инсталляция: не пройдена → название → готово; не администратору — 403", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Taskira')`);
    const adm = await login(app, "admin");
    const s0 = await setup(adm);
    expect(s0.completed).toBe(false);
    expect(s0.projects).toBe(2);
    const p = await app.inject({ method: "PATCH", url: "/api/admin/setup", headers: auth(adm), payload: { instanceName: "ООО «Вектор»" } });
    expect((JSON.parse(p.body) as SetupStatusDto).instanceName).toBe("ООО «Вектор»");
    const c = await app.inject({ method: "POST", url: "/api/admin/setup/complete", headers: auth(adm) });
    expect((JSON.parse(c.body) as SetupStatusDto).completed).toBe(true);
    const emp = await login(app, "emp1");
    expect((await app.inject({ url: "/api/admin/setup", headers: auth(emp) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/demo-project", headers: auth(emp) })).statusCode).toBe(403);
  });
});

describe("демо-проект", () => {
  /** Число строк в каждой таблице схемы (кроме журнала миграций). */
  async function snapshot(): Promise<Record<string, number>> {
    const tables = await q<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`);
    const out: Record<string, number> = {};
    for (const { t } of tables) out[t] = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
    return out;
  }

  test("создаётся с правдоподобными данными, помечен как демо, второй — 409", async () => {
    const adm = await login(app, "admin");
    const r = await app.inject({ method: "POST", url: "/api/admin/demo-project", headers: auth(adm) });
    expect(r.statusCode).toBe(201);
    const { id } = JSON.parse(r.body) as { id: string };
    const boot = JSON.parse((await app.inject({ url: `/api/projects/${id}`, headers: auth(adm) })).body);
    expect(boot.project.isDemo).toBe(true);
    expect(boot.workflow.statuses.map((s: { sid: string }) => s.sid)).toContain("waiting");
    const issues = JSON.parse((await app.inject({ url: `/api/projects/${id}/issues`, headers: auth(adm) })).body);
    expect(issues.items.length).toBeGreaterThanOrEqual(10);
    expect((await app.inject({ method: "POST", url: "/api/admin/demo-project", headers: auth(adm) })).statusCode).toBe(409);
    const st = JSON.parse((await app.inject({ url: "/api/admin/setup", headers: auth(adm) })).body) as SetupStatusDto;
    expect(st.demoProjectId).toBe(id);
    expect(st.projects).toBe(2); // демо не считается «первым проектом»
  });

  test("удаление не оставляет строк в БД — даже после работы с демо-задачами", async () => {
    const adm = await login(app, "admin");
    const before = await snapshot();
    const { id } = JSON.parse((await app.inject({ method: "POST", url: "/api/admin/demo-project", headers: auth(adm) })).body) as { id: string };
    // Поработать: комментарий (активность, подписка, аудит), смена статуса, избранное.
    const issues = JSON.parse((await app.inject({ url: `/api/projects/${id}/issues`, headers: auth(adm) })).body).items as { id: string }[];
    await app.inject({ method: "POST", url: `/api/projects/${id}/issues/${issues[0].id}/comments`, headers: auth(adm), payload: { body: "Проверяю демо" } });
    await app.inject({ method: "PUT", url: `/api/projects/${id}/favorite`, headers: auth(adm) });
    const del = await app.inject({ method: "DELETE", url: "/api/admin/demo-project", headers: auth(adm) });
    expect(del.statusCode).toBe(204);
    const after = await snapshot();
    // user_onboarding — прогресс самого администратора («оставил комментарий»), не данные демо.
    delete after.user_onboarding;
    delete before.user_onboarding;
    expect(after).toEqual(before);
  });
});
