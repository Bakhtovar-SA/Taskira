import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let fx: Fixture, templateId: string;
beforeAll(async () => { await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fx = await seedFixture();
  templateId = (await q<{ id: string }>(
    `INSERT INTO issue_templates (project_id, name, type_id, priority_id, position)
     VALUES ($1, 'Weekly', 'task', 'medium', 0) RETURNING id`, [fx.projects.p1],
  ))[0].id;
});

async function rule(name = "Weekly") {
  return (await q<{ id: string }>(
    `INSERT INTO recurring_rules (project_id, template_id, name, schedule, time_of_day, time_zone, start_date, next_run_at, owner_id)
     VALUES ($1, $2, $3, '{"kind":"daily","every":1}', '09:00', 'Europe/Moscow', '2026-10-01', '2026-10-07T06:00Z', $4)
     RETURNING id`, [fx.projects.p1, templateId, name, fx.users.mgr1],
  ))[0].id;
}

test("имя правила уникально в проекте без учёта регистра", async () => {
  await rule(); await expect(rule("weekly")).rejects.toMatchObject({ code: "23505" });
});

test("active требует следующего запуска, paused — причины", async () => {
  const id = await rule();
  await expect(q(`UPDATE recurring_rules SET next_run_at = NULL WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
  await expect(q(`UPDATE recurring_rules SET state = 'paused' WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
  await q(`UPDATE recurring_rules SET state = 'paused', paused_reason = 'manual', next_run_at = NULL WHERE id = $1`, [id]);
  await expect(q(`UPDATE recurring_rules SET state = 'active', next_run_at = now() WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
});

test("используемый шаблон нельзя удалить", async () => {
  await rule();
  await expect(q(`DELETE FROM issue_templates WHERE id = $1`, [templateId])).rejects.toMatchObject({ code: "23001" });
});

test("HTTP-удаление используемого шаблона возвращает 409 TEMPLATE_IN_USE", async () => {
  await rule();
  const app = await getApp(), token = await login(app, "admin");
  const response = await app.inject({ method: "DELETE",
    url: `/api/projects/${fx.projects.p1}/issue-templates/${templateId}`, headers: auth(token) });
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toMatchObject({ code: "TEMPLATE_IN_USE", reason: expect.stringContaining("Weekly") });
  expect(await q(`SELECT id FROM issue_templates WHERE id = $1`, [templateId])).toEqual([{ id: templateId }]);
});

test("удаление проекта убирает правила, исполнителей и запуски", async () => {
  const id = await rule();
  await q(`INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES ($1, $2)`, [id, fx.users.emp1]);
  await q(`INSERT INTO recurring_runs (rule_id, scheduled_for, result) VALUES ($1, now(), 'created')`, [id]);
  await q(`DELETE FROM projects WHERE id = $1`, [fx.projects.p1]);
  expect(await q(`SELECT 1 FROM recurring_rules WHERE id = $1`, [id])).toEqual([]);
  expect(await q(`SELECT 1 FROM recurring_rule_assignees WHERE rule_id = $1`, [id])).toEqual([]);
  expect(await q(`SELECT 1 FROM recurring_runs WHERE rule_id = $1`, [id])).toEqual([]);
});

test("запуск уникален по правилу и наступлению, удаление задачи сохраняет историю", async () => {
  const id = await rule();
  const insert = () => q(`INSERT INTO recurring_runs (rule_id, scheduled_for, result, issue_id)
    VALUES ($1, '2026-10-07T06:00Z', 'created', $2)`, [id, fx.issues.p1issue]);
  await insert(); await expect(insert()).rejects.toMatchObject({ code: "23505" });
  await q(`DELETE FROM issues WHERE id = $1`, [fx.issues.p1issue]);
  expect(await q(`SELECT result, issue_id FROM recurring_runs WHERE rule_id = $1`, [id]))
    .toEqual([{ result: "created", issue_id: null }]);
});
