/** Полный экспорт инсталляции (ТЗ 3.5, план v2 Трек 3): GET /api/admin/export.
 *  NDJSON — каждая строка валидный JSON, первая строка — meta/schemaVersion. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { addDeptMember, auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { BATCH } from "../src/routes/dataExport.js";
import { withClient } from "../src/db.js";

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

const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });

const p1 = () => fx.projects.p1;

/** Разбирает NDJSON-тело в массив записей, группированных по `type`. */
function parseNdjson(body: string): Record<string, Record<string, unknown>[]> {
  const byType: Record<string, Record<string, unknown>[]> = {};
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown> & { type: string };
    (byType[row.type] ??= []).push(row);
  }
  return byType;
}

describe("GET /admin/export — доступ", () => {
  test("только глобальный admin — manager/employee/viewer/outsider получают 403", async () => {
    for (const username of ["mgr1", "emp1", "viw1", "outsider"]) {
      const token = await login(app, username);
      const r = await app.inject({ url: "/api/admin/export", headers: auth(token) });
      expect(r.statusCode).toBe(403);
    }
  });

  test("admin получает 200, NDJSON content-type, вложение с именем файла", async () => {
    const admin = await login(app, "admin");
    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/x-ndjson");
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="taskira-export-.*\.jsonl"/);
  });
});

describe("GET /admin/export — содержимое", () => {
  test("все таблицы читаются из одного снимка при конкурентном изменении данных", async () => {
    const admin = await login(app, "admin");
    await addDeptMember(fx.depts.d1, fx.users.mgr1);
    const response = await withClient(async (gate) => {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE issue_templates IN ACCESS EXCLUSIVE MODE");
      const pending = app.inject({ url: "/api/admin/export", headers: auth(admin) }).then((r) => r);
      try {
        let blocked = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT%FROM issue_templates%'`);
          if (n > 0) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await q(`DELETE FROM department_members WHERE department_id = $1 AND user_id = $2`, [fx.depts.d1, fx.users.mgr1]);
      } finally {
        await gate.query("ROLLBACK");
        await pending;
      }
      return pending;
    });
    expect(response.statusCode).toBe(200);
    expect(parseNdjson(response.body).departmentMember).toContainEqual(expect.objectContaining({ departmentId: fx.depts.d1, userId: fx.users.mgr1 }));
    expect(await q(`SELECT * FROM department_members WHERE department_id = $1 AND user_id = $2`, [fx.depts.d1, fx.users.mgr1])).toHaveLength(0);
  });
  test("экспортирует созданный через API шаблон задачи со всеми полями", async () => {
    const admin = await login(app, "admin");
    const template = { name: "Экспорт шаблона", typeId: "bug", priorityId: "high", title: "Ошибка", description: "Описание", statusId: fx.p1status.todo };
    const created = await post(`/api/projects/${p1()}/issue-templates`, admin, template);
    expect(created.statusCode).toBe(201);
    const dto = JSON.parse(created.body);
    const exported = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    expect(parseNdjson(exported.body).issueTemplate).toContainEqual(expect.objectContaining({ ...template, id: dto.id, projectId: p1(), position: dto.position, createdAt: expect.any(String) }));
  });
  test("первая строка — meta со schemaVersion; каждая строка — валидный JSON", async () => {
    const admin = await login(app, "admin");
    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const lines = r.body.split("\n").filter((l) => l.trim());
    const meta = JSON.parse(lines[0]);
    expect(meta.type).toBe("meta");
    expect(typeof meta.schemaVersion).toBe("number");
    expect(typeof meta.exportedAt).toBe("string");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  test("содержит все перечисленные в ТЗ сущности (фикстура даёт минимум по одному в каждой)", async () => {
    const admin = await login(app, "admin");
    const mgr = await login(app, "mgr1");
    // Обогащаем фикстуру недостающими сущностями, чтобы каждая появилась хотя бы раз
    // (seedFixture не создаёт department_members — это LDAP-sync/admin-only таблица).
    await addDeptMember(fx.depts.d1, fx.users.mgr1);
    const issue = await post(`/api/projects/${p1()}/issues`, admin, newIssue({ title: "экспорт" }));
    expect(issue.statusCode).toBe(201);
    const issueId = JSON.parse(issue.body).id as string;
    await post(`/api/projects/${p1()}/issues/${issueId}/comments`, admin, { body: "комментарий для экспорта" });
    await post(`/api/projects/${p1()}/issues/${issueId}/checklist`, admin, { text: "пункт чек-листа" });
    const cf = await post(`/api/projects/${p1()}/custom-fields`, admin, { name: "Поле", fieldType: "text", options: [] });
    expect(cf.statusCode).toBe(201);
    const fieldId = JSON.parse(cf.body).id as string;
    await app.inject({ method: "PUT", url: `/api/projects/${p1()}/issues/${issueId}/custom-fields/${fieldId}`, headers: auth(admin), payload: { value: "значение" } });
    const issue2 = await post(`/api/projects/${p1()}/issues`, admin, newIssue({ title: "связанная" }));
    const issue2Id = JSON.parse(issue2.body).id as string;
    const link = await post(`/api/projects/${p1()}/issues/${issueId}/links`, admin, { linkedIssueId: issue2Id, type: "relates" });
    expect(link.statusCode).toBe(200);

    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const byType = parseNdjson(r.body);

    const expectedTypes = [
      "meta", "department", "user", "project", "workflowStatus", "workflowTransition",
      "customField", "customFieldValue", "issue", "issueLink", "checklistItem", "comment",
      "activity", "departmentMember", "projectMember", "issueAssignee",
    ];
    for (const type of expectedTypes) {
      expect(byType[type]?.length ?? 0, `тип "${type}" должен встречаться хотя бы раз`).toBeGreaterThan(0);
    }
    void mgr;
  });

  test("password_hash не встречается нигде в ответе (буквальное требование ТЗ)", async () => {
    const admin = await login(app, "admin");
    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const byType = parseNdjson(r.body);
    expect(byType.user.length).toBeGreaterThan(0);
    for (const u of byType.user) expect(u).not.toHaveProperty("passwordHash");
    // Сам хеш (bcrypt-строка) не должен появиться нигде в сыром теле ответа —
    // на случай, если бы он утёк через какое-то другое поле/таблицу.
    const hashRow = await q<{ password_hash: string }>(`SELECT password_hash FROM users LIMIT 1`);
    expect(r.body).not.toContain(hashRow[0].password_hash);
  });

  test("заархивированная задача всё равно попадает в экспорт (архив — не удаление)", async () => {
    const admin = await login(app, "admin");
    const created = await post(`/api/projects/${p1()}/issues`, admin, newIssue({ title: "архивная" }));
    const id = JSON.parse(created.body).id as string;
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [id]);
    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const byType = parseNdjson(r.body);
    expect(byType.issue.some((i) => i.id === id)).toBe(true);
  });

  test("аудит: запрос экспорта сам попадает в audit_log", async () => {
    const admin = await login(app, "admin");
    await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const rows = await q<{ action: string }>(`SELECT action FROM audit_log WHERE action = 'admin.export'`);
    expect(rows).toHaveLength(1);
  });
});

describe("GET /admin/export — пагинация (граница BATCH)", () => {
  test("таблица с BATCH+50 строками отдаёт их все, без дублей и пропусков (keyset-пагинация)", async () => {
    const admin = await login(app, "admin");
    // departments — самая дешёвая таблица для вставки большого числа строк
    // одним запросом; проверяет ровно ту границу (rows.length < BATCH), от
    // которой зависит корректность постраничного обхода.
    await q(
      `INSERT INTO departments (name) SELECT 'dept-' || g FROM generate_series(1, $1) AS g`,
      [BATCH + 50],
    );
    const r = await app.inject({ url: "/api/admin/export", headers: auth(admin) });
    const byType = parseNdjson(r.body);
    // +2: департаменты из seedFixture (d1, d2).
    expect(byType.department).toHaveLength(BATCH + 50 + 2);
    const ids = byType.department.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length); // без дублей
  }, 30_000);
});
