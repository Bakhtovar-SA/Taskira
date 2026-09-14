/** Шаблоны задач проекта (issue_templates, миграция 022). Определения —
 *  право editWorkflow (тем же правом, что схема workflow/custom-fields);
 *  применение шаблона — client-side, здесь не тестируется (нет роута). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { createIssueTemplate } from "../src/services/issueTemplates.js";

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

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const templatesUrl = () => `/api/projects/${p1()}/issue-templates`;

const body = (over: Record<string, unknown> = {}) => ({
  name: "Баг-репорт",
  typeId: "bug",
  priorityId: "high",
  title: "Баг: ",
  description: "Шаги воспроизведения:\n1.\n2.",
  ...over,
});

async function createTemplate(token: string, over: Record<string, unknown> = {}) {
  const r = await post(templatesUrl(), token, body(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("шаблоны задач: определения", () => {
  test("admin создаёт шаблон — виден в GET и в bootstrap проекта", async () => {
    const admin = await login(app, "admin");
    const t = await createTemplate(admin);
    expect(t.name).toBe("Баг-репорт");
    expect(t.typeId).toBe("bug");

    const list = JSON.parse((await g(templatesUrl(), admin)).body);
    expect(list).toHaveLength(1);

    const boot = JSON.parse((await g(`/api/projects/${p1()}`, admin)).body);
    expect(boot.issueTemplates).toHaveLength(1);
  });

  test("manager/employee/viewer/outsider не могут создавать шаблоны — 403", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const viw = await login(app, "viw1");
    const out = await login(app, "outsider");
    for (const token of [mgr, emp, viw, out]) {
      expect((await post(templatesUrl(), token, body())).statusCode).toBe(403);
    }
  });

  test("дубликат названия (без учёта регистра) — 400", async () => {
    const admin = await login(app, "admin");
    await createTemplate(admin, { name: "Баг-репорт" });
    expect((await post(templatesUrl(), admin, body({ name: "баг-репорт" }))).statusCode).toBe(400);
  });

  test("PATCH переименование в уже занятое в проекте имя (без учёта регистра) — 400", async () => {
    // Раньше PATCH вообще не проверял дубль имени (в отличие от POST) — падал
    // неперехваченным 500 на UNIQUE-ограничении БД (ревью PR #47).
    const admin = await login(app, "admin");
    await createTemplate(admin, { name: "Баг-репорт" });
    const other = await createTemplate(admin, { name: "Другой шаблон" });
    expect((await patch(`${templatesUrl()}/${other.id}`, admin, body({ name: "баг-репорт" }))).statusCode).toBe(400);
  });

  test("createIssueTemplate() — БД отклоняет дубликат имени без учёта регистра (23505), в обход app-level пре-чека", async () => {
    // Реальная гонка (два конкурентных POST через HTTP-слой) в этом тестовом
    // окружении не воспроизводится детерминированно: app.inject выполняется
    // в одном процессе, и SELECT-пречек второго запроса на практике почти
    // всегда видит уже закоммиченную INSERT первого (тот же класс ограничения,
    // что и у гонки WS-хендшейка/checklist-TOCTOU в этой сессии — см. их
    // тесты) — 400 из пречека маскирует настоящую гонку раньше, чем она
    // успевает проявиться. Проверяем сам защитный слой напрямую: вызываем
    // сервис в обход роута (там нет пречека вообще) — issue_templates_name_uk
    // (миграция 022) обязана сама отклонить второй INSERT с тем же именем в
    // другом регистре кодом 23505, который templateConflict() в роуте ловит
    // и превращает в 409 (ревью PR #47, пункты b/c).
    const project = p1();
    const args = { typeId: "bug", priorityId: "high", title: "", description: "", statusId: null } as const;
    await createIssueTemplate(project, { ...args, name: "Гонка" });
    let caught: unknown;
    try {
      await createIssueTemplate(project, { ...args, name: "гонка" });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe("23505");
  });

  test("PATCH правит шаблон целиком, DELETE удаляет", async () => {
    const admin = await login(app, "admin");
    const t = await createTemplate(admin);

    const r1 = await patch(`${templatesUrl()}/${t.id}`, admin, body({ name: "Баг-репорт v2", priorityId: "critical" }));
    expect(r1.statusCode).toBe(200);
    const updated = JSON.parse(r1.body);
    expect(updated.name).toBe("Баг-репорт v2");
    expect(updated.priorityId).toBe("critical");

    const r2 = await del(`${templatesUrl()}/${t.id}`, admin);
    expect(r2.statusCode).toBe(204);
    expect(JSON.parse((await g(templatesUrl(), admin)).body)).toHaveLength(0);
  });

  test("statusId — реальный статус проекта принимается, чужой/несуществующий — 404", async () => {
    const admin = await login(app, "admin");
    const wf = JSON.parse((await g(`/api/projects/${p1()}/workflow`, admin)).body);
    const statusId = wf.statuses[0].id;

    const ok = await createTemplate(admin, { statusId });
    expect(ok.statusId).toBe(statusId);

    const fakeId = "00000000-0000-0000-0000-000000000000";
    expect((await post(templatesUrl(), admin, body({ name: "другой", statusId: fakeId }))).statusCode).toBe(404);
  });

  test("лимит шаблонов на проект — 400 после LIMITS.issueTemplatesPerProject", async () => {
    const admin = await login(app, "admin");
    for (let i = 0; i < 30; i++) {
      expect((await post(templatesUrl(), admin, body({ name: `шаблон ${i}` }))).statusCode).toBe(201);
    }
    expect((await post(templatesUrl(), admin, body({ name: "31-й" }))).statusCode).toBe(400);
  });

  test("GET /projects/:id всегда содержит массив issueTemplates", async () => {
    const admin = await login(app, "admin");
    const boot = JSON.parse((await g(`/api/projects/${p1()}`, admin)).body);
    expect(Array.isArray(boot.issueTemplates)).toBe(true);
  });
});
