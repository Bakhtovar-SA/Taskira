/** Пользовательские поля проекта (custom_fields/custom_field_values, миграция 020).
 *  Определения — право editWorkflow (тем же правом, что и схема workflow, MATRIX
 *  admin-only); значение на конкретной задаче — тем же `edit`, что и остальные поля. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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
const put = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PUT", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

const p1 = () => fx.projects.p1;
const fieldsUrl = () => `/api/projects/${p1()}/custom-fields`;
const issueUrl = (issueId: string) => `/api/projects/${p1()}/issues/${issueId}`;

async function createField(token: string, body: unknown): Promise<{ id: string; name: string }> {
  const r = await post(fieldsUrl(), token, body);
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("custom fields: определения", () => {
  test("admin создаёт текстовое поле — видно в GET /custom-fields и в bootstrap проекта", async () => {
    const admin = await login(app, "admin");
    const field = await createField(admin, { name: "Клиент", fieldType: "text" });
    expect(field.name).toBe("Клиент");

    const list = JSON.parse((await g(fieldsUrl(), admin)).body);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(field.id);

    const boot = JSON.parse((await g(`/api/projects/${p1()}`, admin)).body);
    expect(boot.customFields).toHaveLength(1);
  });

  test("manager/employee/viewer/outsider не могут создавать поля — 403", async () => {
    const mgr = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const viw = await login(app, "viw1");
    const out = await login(app, "outsider");
    for (const token of [mgr, emp, viw, out]) {
      expect((await post(fieldsUrl(), token, { name: "x", fieldType: "text" })).statusCode).toBe(403);
    }
  });

  test("select без вариантов — 400", async () => {
    const admin = await login(app, "admin");
    expect((await post(fieldsUrl(), admin, { name: "Статус X", fieldType: "select", options: [] })).statusCode).toBe(400);
  });

  test("дубликат названия (без учёта регистра) — 400", async () => {
    const admin = await login(app, "admin");
    await createField(admin, { name: "Клиент", fieldType: "text" });
    expect((await post(fieldsUrl(), admin, { name: "клиент", fieldType: "text" })).statusCode).toBe(400);
  });

  test("PATCH переименовывает, DELETE удаляет", async () => {
    const admin = await login(app, "admin");
    const field = await createField(admin, { name: "Клиент", fieldType: "text" });

    const r1 = await patch(`${fieldsUrl()}/${field.id}`, admin, { name: "Заказчик" });
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).name).toBe("Заказчик");

    const r2 = await del(`${fieldsUrl()}/${field.id}`, admin);
    expect(r2.statusCode).toBe(204);
    expect(JSON.parse((await g(fieldsUrl(), admin)).body)).toHaveLength(0);
  });

  test("лимит полей на проект — 400 после LIMITS.customFieldsPerProject", async () => {
    const admin = await login(app, "admin");
    for (let i = 0; i < 30; i++) {
      expect((await post(fieldsUrl(), admin, { name: `Поле ${i}`, fieldType: "text" })).statusCode).toBe(201);
    }
    expect((await post(fieldsUrl(), admin, { name: "31-е", fieldType: "text" })).statusCode).toBe(400);
  });
});

describe("custom fields: значения на задаче", () => {
  test("manager задаёт текстовое значение — видно в GET /:id", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    const field = await createField(admin, { name: "Клиент", fieldType: "text" });
    const issue = fx.issues.p1issue;

    const r = await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "ООО Ромашка" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).values).toEqual([{ fieldId: field.id, value: "ООО Ромашка" }]);

    const detail = JSON.parse((await g(issueUrl(issue), mgr)).body);
    expect(detail.customFieldValues).toEqual([{ fieldId: field.id, value: "ООО Ромашка" }]);
  });

  test("value=null снимает значение", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    const field = await createField(admin, { name: "Клиент", fieldType: "text" });
    const issue = fx.issues.p1issue;
    await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "x" });

    const r = await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: null });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).values).toEqual([]);
  });

  test("number: нечисловое значение — 400, валидное — принято", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    const field = await createField(admin, { name: "Оценка часов", fieldType: "number" });
    const issue = fx.issues.p1issue;
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "abc" })).statusCode).toBe(400);
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "4.5" })).statusCode).toBe(200);
  });

  test("select: значение вне списка вариантов — 400", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    const field = await createField(admin, { name: "Регион", fieldType: "select", options: ["РФ", "СНГ"] });
    const issue = fx.issues.p1issue;
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "США" })).statusCode).toBe(400);
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "СНГ" })).statusCode).toBe(200);
  });

  test("checkbox: только true/false", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    const field = await createField(admin, { name: "Срочно", fieldType: "checkbox" });
    const issue = fx.issues.p1issue;
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "yes" })).statusCode).toBe(400);
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, mgr, { value: "true" })).statusCode).toBe(200);
  });

  test("employee задаёт значение на своей задаче; viewer — 403", async () => {
    const admin = await login(app, "admin");
    const emp = await login(app, "emp1"); // reporter+assignee p1issue
    const viw = await login(app, "viw1");
    const field = await createField(admin, { name: "Клиент", fieldType: "text" });
    const issue = fx.issues.p1issue;
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, emp, { value: "своя" })).statusCode).toBe(200);
    expect((await put(`${issueUrl(issue)}/custom-fields/${field.id}`, viw, { value: "чужая" })).statusCode).toBe(403);
  });

  test("несуществующее поле — 404", async () => {
    const mgr = await login(app, "mgr1");
    const issue = fx.issues.p1issue;
    const fakeId = "00000000-0000-0000-0000-000000000000";
    expect((await put(`${issueUrl(issue)}/custom-fields/${fakeId}`, mgr, { value: "x" })).statusCode).toBe(404);
  });

  test("GET /:id всегда содержит массив customFieldValues", async () => {
    const mgr = await login(app, "mgr1");
    const detail = JSON.parse((await g(issueUrl(fx.issues.p1issue), mgr)).body);
    expect(Array.isArray(detail.customFieldValues)).toBe(true);
  });
});
