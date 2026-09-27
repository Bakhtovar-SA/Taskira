/** ТЗ 5.10 — шаблоны проектов. Проверки из ТЗ:
 *  - проект из каждого встроенного шаблона получает ровно заданную конфигурацию;
 *  - сбой посреди применения не оставляет полупроекта (искусственная ошибка);
 *  - права на «сохранить как шаблон» проверяются сервером;
 *  - экспорт (ТЗ 3.5) включает шаблоны организации. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { BUILTIN_TEMPLATES } from "../src/services/projectTemplates.js";
import type { ProjectBootstrapDto, ProjectTemplateDto } from "../src/contract.js";

let app: FastifyInstance;
let fx: Fixture;
let adm: string;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  adm = await login(app, "admin");
});

const create = (payload: Record<string, unknown>, token = adm) =>
  app.inject({ method: "POST", url: "/api/projects", headers: auth(token), payload: { departmentId: fx.depts.d1, ...payload } });
const boot = async (id: string) => JSON.parse((await app.inject({ url: `/api/projects/${id}`, headers: auth(adm) })).body) as ProjectBootstrapDto;

/** Конфигурация проекта в виде спецификации шаблона — для сравнения «ровно заданной». */
function configOf(b: ProjectBootstrapDto) {
  const sid = new Map(b.workflow.statuses.map((s) => [s.id, s.sid]));
  return {
    statuses: b.workflow.statuses.map((s) => ({ sid: s.sid, name: s.name, category: s.category })),
    transitions: b.workflow.transitions.map((t) => `${sid.get(t.from)}>${sid.get(t.to)}`).sort(),
    customFields: b.customFields.map((f) => ({ name: f.name, fieldType: f.fieldType, options: f.options })),
    issueTemplates: b.issueTemplates.map((t) => ({ name: t.name, typeId: t.typeId, priorityId: t.priorityId, title: t.title, description: t.description, statusSid: t.statusId ? sid.get(t.statusId) : null })),
    defaultView: b.project.defaultView,
    labels: b.project.suggestedLabels,
    sprintsEnabled: b.project.sprintsEnabled,
  };
}
const expected = (spec: ProjectTemplateDto["spec"]) => ({
  statuses: spec.statuses,
  transitions: spec.transitions.map(([a, b]) => `${a}>${b}`).sort(),
  customFields: spec.customFields.map((f) => ({ ...f, options: f.fieldType === "select" ? f.options : [] })),
  issueTemplates: spec.issueTemplates,
  defaultView: spec.defaultView,
  labels: spec.labels,
  sprintsEnabled: spec.sprintsEnabled,
});

describe("встроенные шаблоны", () => {
  test("их пять, id уникальны, каждый проходит схему (иначе модуль не загрузился бы)", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(["builtin:blank", "builtin:marketing", "builtin:hr", "builtin:support", "builtin:approval"]);
  });

  test("GET /api/project-templates — встроенные для админа, 403 остальным", async () => {
    const r = await app.inject({ url: "/api/project-templates", headers: auth(adm) });
    expect(r.statusCode).toBe(200);
    expect((JSON.parse(r.body) as ProjectTemplateDto[]).filter((t) => t.builtin)).toHaveLength(5);
    const mgr = await login(app, "mgr1");
    expect((await app.inject({ url: "/api/project-templates", headers: auth(mgr) })).statusCode).toBe(403);
  });

  for (const tpl of BUILTIN_TEMPLATES) {
    test(`проект из шаблона «${tpl.name}» получает ровно заданную конфигурацию`, async () => {
      const key = `T${tpl.id.slice(8, 12).toUpperCase().replace(/[^A-Z]/g, "X")}`;
      const r = await create({ key, name: tpl.name, templateId: tpl.id });
      expect(r.statusCode).toBe(201);
      const project = JSON.parse(r.body) as { id: string; defaultView: string };
      expect(project.defaultView).toBe(tpl.spec.defaultView);
      expect(configOf(await boot(project.id))).toEqual(expected(tpl.spec));
    });
  }
});

describe("создание проекта", () => {
  test("без шаблона — стандартная схема, как раньше", async () => {
    const r = await create({ key: "PLAIN", name: "Обычный" });
    expect(r.statusCode).toBe(201);
    const b = await boot(JSON.parse(r.body).id);
    expect(b.workflow.statuses.map((s) => s.sid)).toEqual(["todo", "inprogress", "review", "done"]);
    expect(b.workflow.transitions).toHaveLength(8);
    expect(b.project.defaultView).toBeNull();
  });

  test("неизвестный шаблон — 400, проекта нет", async () => {
    const r = await create({ key: "NOPE", name: "Нет", templateId: "builtin:nope" });
    expect(r.statusCode).toBe(400);
    expect(await q(`SELECT 1 FROM projects WHERE key = 'NOPE'`)).toHaveLength(0);
  });

  test("участники добавляются в той же транзакции", async () => {
    const r = await create({ key: "MEMB", name: "С участниками", templateId: "builtin:support", members: [{ userId: fx.users.emp1, role: "employee" }, { userId: fx.users.mgr2, role: "manager" }] });
    expect(r.statusCode).toBe(201);
    const b = await boot(JSON.parse(r.body).id);
    expect(b.members.map((m) => `${m.userId}:${m.role}`).sort()).toEqual([`${fx.users.emp1}:employee`, `${fx.users.mgr2}:manager`].sort());
  });

  test("сбой посреди применения не оставляет полупроекта: ни проекта, ни статусов, ни участников", async () => {
    // Искусственная ошибка: шаблон организации, записанный в обход схемы, с полем недопустимого типа —
    // CHECK в custom_fields падает ПОСЛЕ вставки проекта, статусов и переходов.
    const spec = { ...BUILTIN_TEMPLATES[1].spec, customFields: [{ name: "Сломанное поле", fieldType: "bogus", options: [] }] };
    const [{ id }] = await q<{ id: string }>(`INSERT INTO project_templates (name, spec) VALUES ('Сломанный', $1::jsonb) RETURNING id`, [JSON.stringify(spec)]);
    const before = await q<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_statuses`);
    const r = await create({ key: "HALF", name: "Полупроект", templateId: id, members: [{ userId: fx.users.emp1, role: "employee" }] });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(await q(`SELECT 1 FROM projects WHERE key = 'HALF'`)).toHaveLength(0);
    expect(await q<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_statuses`)).toEqual(before);
    expect(await q(`SELECT 1 FROM project_members pm LEFT JOIN projects p ON p.id = pm.project_id WHERE p.id IS NULL`)).toHaveLength(0);
  });

  test("сброс схемы у проекта со своими статусами — 409, переходы на месте", async () => {
    const r = await create({ key: "DOCS", name: "Документы", templateId: "builtin:approval" });
    const id = JSON.parse(r.body).id;
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/workflow/reset`, headers: auth(adm) });
    expect(res.statusCode).toBe(409);
    expect((await boot(id)).workflow.transitions).toHaveLength(BUILTIN_TEMPLATES[4].spec.transitions.length);
  });
});

describe("сохранить проект как шаблон", () => {
  const save = (projectId: string, token: string, name = "Наш процесс") =>
    app.inject({ method: "POST", url: `/api/projects/${projectId}/save-as-template`, headers: auth(token), payload: { name, description: "Из проекта CORP" } });

  test("право проверяет сервер: менеджер и сотрудник проекта — 403", async () => {
    for (const u of ["mgr1", "emp1", "viw1"]) {
      const token = await login(app, u);
      expect((await save(fx.projects.p1, token)).statusCode).toBe(403);
    }
    expect(await q(`SELECT 1 FROM project_templates`)).toHaveLength(0);
  });

  test("админ сохраняет; новый проект из сохранённого шаблона повторяет конфигурацию исходного", async () => {
    const src = JSON.parse((await create({ key: "SRC", name: "Исходный", templateId: "builtin:hr" })).body).id;
    const r = await save(src, adm);
    expect(r.statusCode).toBe(201);
    const tpl = JSON.parse(r.body) as ProjectTemplateDto;
    expect(tpl.builtin).toBe(false);
    expect((await save(src, adm)).statusCode).toBe(409); // то же название
    const copy = JSON.parse((await create({ key: "COPY", name: "Копия", templateId: tpl.id })).body).id;
    expect(configOf(await boot(copy))).toEqual(configOf(await boot(src)));
    const del = await app.inject({ method: "DELETE", url: `/api/project-templates/${tpl.id}`, headers: auth(adm) });
    expect(del.statusCode).toBe(204);
  });

  test("экспорт инсталляции включает шаблоны организации", async () => {
    await save(fx.projects.p1, adm, "Для экспорта");
    const r = await app.inject({ url: "/api/admin/export", headers: auth(adm) });
    const lines = r.body.trim().split("\n").map((l) => JSON.parse(l) as { type: string; data?: { name?: string } });
    const tpl = lines.filter((l) => l.type === "projectTemplate");
    expect(tpl).toHaveLength(1);
    expect(JSON.stringify(tpl[0])).toContain("Для экспорта");
  });
});
