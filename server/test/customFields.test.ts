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

describe("фильтр списка по своему полю (ROUTE-02)", () => {
  /** Четыре задачи CORP с разными значениями поля; возвращает ключи задач, которые отдаёт список с условием. */
  async function setup(fieldType: string, values: (string | null)[], options?: string[]) {
    const admin = await login(app, "admin");
    const field = await createField(admin, { name: "Поле", fieldType, ...(options ? { options } : {}) });
    const ids = [fx.issues.p1issue];
    for (let i = 1; i < values.length; i++) {
      const r = await post(`/api/projects/${p1()}/issues`, admin, { title: `Задача ${i}`, typeId: "task", priorityId: "medium", epicId: null, complexity: null, dueDate: null, parentId: null });
      expect(r.statusCode).toBe(201);
      ids.push(JSON.parse(r.body).id);
    }
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== null) expect((await put(`${issueUrl(ids[i])}/custom-fields/${field.id}`, admin, { value: values[i] })).statusCode).toBe(200);
    }
    const keys = async (qs: Record<string, string>) => {
      const r = await g(`/api/projects/${p1()}/issues?${new URLSearchParams({ cf: field.id, sort: "key", ...qs })}`, admin);
      expect(r.statusCode).toBe(200);
      return (JSON.parse(r.body).items as { id: string }[]).map((x) => ids.indexOf(x.id)).sort();
    };
    const counts = (qs: Record<string, string>) => g(`/api/projects/${p1()}/issues/counts?${new URLSearchParams({ cf: field.id, ...qs })}`, admin);
    return { field, admin, keys, counts };
  }

  test("select: точное совпадение; «не задано»; счётчики считают тот же набор", async () => {
    const { keys, counts } = await setup("select", ["Москва", "Казань", "Москва", null], ["Москва", "Казань"]);
    expect(await keys({ cfValue: "Москва" })).toEqual([0, 2]);
    expect(await keys({ cfEmpty: "1" })).toEqual([3]);
    expect(JSON.parse((await counts({ cfValue: "Казань" })).body).total).toBe(1);
  });

  test("number: диапазон с одной и двумя границами", async () => {
    const { keys } = await setup("number", ["5", "12.5", "40", null]);
    expect(await keys({ cfFrom: "10" })).toEqual([1, 2]);
    expect(await keys({ cfTo: "12.5" })).toEqual([0, 1]);
    expect(await keys({ cfFrom: "6", cfTo: "39" })).toEqual([1]);
  });

  test("date: диапазон; text: подстрока без учёта регистра; checkbox: снят = не задан или false", async () => {
    const d = await setup("date", ["2026-01-10", "2026-02-01", "2026-03-15", null]);
    expect(await d.keys({ cfFrom: "2026-01-15", cfTo: "2026-03-15" })).toEqual([1, 2]);
    await resetDb();
    fx = await seedFixture();
    const tx = await setup("text", ["ООО Ромашка", "ИП Лютик", "ромашковое поле", null]);
    expect(await tx.keys({ cfValue: "РОМАШК" })).toEqual([0, 2]);
    await resetDb();
    fx = await seedFixture();
    const cb = await setup("checkbox", ["true", "false", null, "true"]);
    expect(await cb.keys({ cfValue: "true" })).toEqual([0, 3]);
    expect(await cb.keys({ cfValue: "false" })).toEqual([1, 2]);
  });

  test("неверная граница — 400; поле из чужого проекта или удалённое — пустой список, а не ошибка", async () => {
    const { field, admin, keys } = await setup("number", ["1", "2"]);
    const bad = await g(`/api/projects/${p1()}/issues?cf=${field.id}&cfFrom=abc`, admin);
    expect(bad.statusCode).toBe(400);
    expect((await del(`${fieldsUrl()}/${field.id}`, admin)).statusCode).toBe(204);
    expect(await keys({ cfFrom: "0" })).toEqual([]);
  });

  test("условие по полю сохраняется в сохранённом фильтре", async () => {
    const { field, admin } = await setup("select", ["А"], ["А", "Б"]);
    const r = await post(`/api/projects/${p1()}/saved-views`, admin, { name: "Только А", filter: { cf: field.id, cfValue: "А" } });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).filter).toEqual({ cf: field.id, cfValue: "А" });
  });
});
