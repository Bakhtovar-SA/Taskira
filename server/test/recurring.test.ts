import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { LIMITS } from "../src/contract.js";
import { _resetMetrics, refreshBackgroundQueueMetrics, renderMetrics } from "../src/metrics.js";
import { runMaintenanceOnce } from "../src/services/maintenance.js";
import { runRecurringOnce } from "../src/services/recurring.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance, fx: Fixture, manager: string, admin: string, templateId: string;
const day = (date: Date) => date.toISOString().slice(0, 10);
const clock = () => { const date = new Date(); date.setUTCHours(12, 0, 0, 0); return date; };
const daysAgo = (days: number) => new Date(clock().getTime() - days * 86_400_000);
const url = () => `/api/projects/${fx.projects.p1}/recurring`;
const body = (overrides: Record<string, unknown> = {}) => ({ name: "Weekly", templateId,
  schedule: { kind: "daily", every: 1 }, timeOfDay: "09:00", timeZone: "UTC", startDate: day(daysAgo(10)),
  assigneeIds: [fx.users.emp1], dueInDays: 2, skipIfOpen: false, ...overrides });
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, token = manager, payload?: unknown) =>
  app.inject({ method, url: path, headers: auth(token), ...(payload === undefined ? {} : { payload }) });
const create = async (overrides: Record<string, unknown> = {}, token = manager) => {
  const response = await call("POST", url(), token, body(overrides));
  expect(response.statusCode, response.body).toBe(201); return response.json();
};
async function due(id: string, days = 0) {
  const date = daysAgo(days); date.setUTCHours(9, 0, 0, 0);
  await q(`UPDATE recurring_rules SET next_run_at = $2 WHERE id = $1`, [id, date]);
  return date;
}
beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb(); fx = await seedFixture(); _resetMetrics();
  loadConfig().recurring.enabled = true;
  loadConfig().maintenance.batchPauseMs = 0;
  manager = await login(app, "mgr1"); admin = await login(app, "admin");
  templateId = (await q<{ id: string }>(`INSERT INTO issue_templates
    (project_id, name, type_id, priority_id, title, description, position)
    VALUES ($1, 'Weekly', 'task', 'high', 'Report {date}', 'Template description', 0) RETURNING id`, [fx.projects.p1]))[0].id;
});

test.each(["emp1", "viw1"])("%s читает правила и preview, но не управляет ими", async username => {
  const token = await login(app, username), rule = await create();
  expect((await call("GET", url(), token)).statusCode).toBe(200);
  const preview = await call("POST", `${url()}/preview`, token, body());
  expect(preview.statusCode).toBe(200); expect(preview.json().next).toHaveLength(5);
  expect((await call("POST", url(), token, body({ name: "Other" }))).statusCode).toBe(403);
  expect((await call("PATCH", `${url()}/${rule.id}`, token, { name: "Other" })).statusCode).toBe(403);
  for (const action of ["pause", "resume", "run-now"])
    expect((await call("POST", `${url()}/${rule.id}/${action}`, token)).statusCode).toBe(403);
  expect((await call("DELETE", `${url()}/${rule.id}`, token)).statusCode).toBe(403);
});

test("admin создаёт правило без членства, config требует входа", async () => {
  const rule = await create({}, admin); expect(rule.ownerId).toBe(fx.users.admin);
  const config = await call("GET", "/api/recurring/config", manager);
  expect(config.json()).toEqual({ enabled: true, defaultTimeZone: loadConfig().reminders.timeZone });
  expect((await app.inject({ url: "/api/recurring/config" })).statusCode).toBe(401);
});

test("сохранение проверяет пояс, дату, шаблон проекта, исполнителей и уникальность имени", async () => {
  const other = (await q<{ id: string }>(`INSERT INTO issue_templates (project_id, name, type_id, priority_id, position)
    VALUES ($1, 'Other', 'task', 'medium', 0) RETURNING id`, [fx.projects.p2]))[0].id;
  expect((await call("POST", url(), manager, body({ templateId: other }))).statusCode).toBe(404);
  for (const patch of [{ timeZone: "Unknown/Zone" }, { startDate: "2027-02-30" }, { assigneeIds: [fx.users.outsider] }])
    expect((await call("POST", url(), manager, body(patch))).statusCode).toBe(400);
  await create();
  expect((await call("POST", url(), manager, body({ name: "weekly" }))).json().error.code).toBe("CONFLICT");
});

test("частичный PATCH сохраняет остальные поля, pause/resume не догоняют паузу", async () => {
  const rule = await create({ skipIfOpen: true, title: "Own {date}" });
  const renamed = await call("PATCH", `${url()}/${rule.id}`, admin, { name: "Renamed" });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json()).toMatchObject({ name: "Renamed", ownerId: fx.users.admin, skipIfOpen: true,
    title: "Own {date}", assigneeIds: [fx.users.emp1], dueInDays: 2, schedule: { kind: "daily", every: 1 } });
  expect((await q<{ details: unknown }>(`SELECT details FROM audit_log WHERE action = 'recurring.update' AND entity_id = $1`, [rule.id]))[0].details)
    .toMatchObject({ previousOwnerId: fx.users.mgr1, ownerId: fx.users.admin });
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, {})).statusCode).toBe(400);
  const paused = await call("POST", `${url()}/${rule.id}/pause`);
  expect(paused.json()).toMatchObject({ state: "paused", pausedReason: "manual", nextRunAt: null });
  const resumed = await call("POST", `${url()}/${rule.id}/resume`);
  expect(resumed.json()).toMatchObject({ state: "active", pausedReason: null, ownerId: fx.users.mgr1 });
  expect(Date.parse(resumed.json().nextRunAt)).toBeGreaterThan(Date.now());
});

test("переименование старого правила допускает выпавшего исполнителя, новые значения проверяются", async () => {
  const rule = await create();
  const oldStart = day(daysAgo(1200));
  await q(`UPDATE recurring_rules SET start_date = $2 WHERE id = $1`, [rule.id, oldStart]);
  await q(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [fx.projects.p1, fx.users.emp1]);
  const renamed = await call("PATCH", `${url()}/${rule.id}`, admin, { name: "Renamed" });
  expect(renamed.statusCode, renamed.body).toBe(200);
  expect(renamed.json()).toMatchObject({ startDate: oldStart, assigneeIds: [fx.users.emp1], ownerId: fx.users.admin });
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, { assigneeIds: [fx.users.emp1] })).statusCode).toBe(400);
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, { startDate: oldStart })).statusCode).toBe(200);
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, { startDate: day(daysAgo(1201)) })).statusCode).toBe(400);
  const preview = await call("POST", `${url()}/preview`, manager, body({ startDate: oldStart }));
  expect(preview.statusCode).toBe(200); expect(preview.json().next).toHaveLength(5);
  const other = (await q<{ id: string }>(`INSERT INTO issue_templates (project_id, name, type_id, priority_id, position)
    VALUES ($1, 'Other', 'task', 'medium', 0) RETURNING id`, [fx.projects.p2]))[0].id;
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, { templateId: other })).statusCode).toBe(404);
  await due(rule.id);
  expect((await runRecurringOnce(clock())).created).toBe(1);
  const history = (await call("GET", `${url()}/${rule.id}/runs`)).json();
  expect(history[0].details.droppedAssignees).toEqual([fx.users.emp1]);
});

test("один тик создаёт задачу с датой, сроком, исполнителем, автором и событием правила", async () => {
  const rule = await create(), scheduled = await due(rule.id);
  expect(await runRecurringOnce(clock())).toMatchObject({ created: 1, processed: 1 });
  const run = (await q<{ issue_id: string; scheduled_for: Date; missed_count: number }>(
    `SELECT issue_id, scheduled_for, missed_count FROM recurring_runs WHERE rule_id = $1`, [rule.id]))[0];
  expect(run.scheduled_for).toEqual(scheduled); expect(run.missed_count).toBe(0);
  expect((await q(`SELECT title, description, reporter_id, due_date, priority_id FROM issues WHERE id = $1`, [run.issue_id]))[0])
    .toEqual({ title: `Report ${day(scheduled)}`, description: "Template description", reporter_id: fx.users.mgr1,
      due_date: day(new Date(scheduled.getTime() + 2 * 86_400_000)), priority_id: "high" });
  expect(await q(`SELECT user_id FROM issue_assignees WHERE issue_id = $1`, [run.issue_id])).toEqual([{ user_id: fx.users.emp1 }]);
  expect((await q<{ payload: unknown }>(`SELECT payload FROM activity WHERE issue_id = $1 AND kind = 'created'`, [run.issue_id]))[0].payload)
    .toEqual({ ruleId: rule.id, ruleName: "Weekly" });
  const list = (await call("GET", url())).json();
  expect(list[0]).toMatchObject({ lastResult: "created", timeOfDay: "09:00" });
  expect(Date.parse(list[0].nextRunAt)).toBeGreaterThan(clock().getTime());
  expect(renderMetrics(0)).toContain('taskira_recurring_runs_total{result="created"} 1');
});

test("три пропущенных наступления дают одну задачу за последнее и missed_count=2", async () => {
  const rule = await create(); await due(rule.id, 2);
  await runRecurringOnce(clock());
  const runs = await q<{ missed_count: number; scheduled_for: Date }>(`SELECT missed_count, scheduled_for FROM recurring_runs WHERE rule_id = $1`, [rule.id]);
  expect(runs).toHaveLength(1); expect(runs[0].missed_count).toBe(2);
  expect(day(runs[0].scheduled_for)).toBe(day(clock()));
});

test("простой больше 1000 дней всё равно догоняет последнее наступление", async () => {
  const rule = await create(); const start = await due(rule.id, 1200);
  await q(`UPDATE recurring_rules SET start_date = $2 WHERE id = $1`, [rule.id, day(start)]);
  await runRecurringOnce(clock());
  const run = (await q<{ missed_count: number; scheduled_for: Date }>(`SELECT missed_count, scheduled_for FROM recurring_runs WHERE rule_id = $1`, [rule.id]))[0];
  expect(run.missed_count).toBe(1200); expect(day(run.scheduled_for)).toBe(day(clock()));
});

test("параллельные тики и повтор после записанного запуска не создают дублей", async () => {
  const rule = await create(), scheduled = await due(rule.id);
  await Promise.all([runRecurringOnce(clock()), runRecurringOnce(clock())]);
  expect(await q(`SELECT id FROM recurring_runs WHERE rule_id = $1`, [rule.id])).toHaveLength(1);
  await q(`UPDATE recurring_rules SET next_run_at = $2 WHERE id = $1`, [rule.id, scheduled]);
  expect((await runRecurringOnce(clock())).created).toBe(0);
  expect(await q(`SELECT id FROM recurring_runs WHERE rule_id = $1`, [rule.id])).toHaveLength(1);
});

test("skip_if_open пропускает открытую задачу и создаёт после её закрытия", async () => {
  const rule = await create({ skipIfOpen: true }); await due(rule.id, 1);
  await runRecurringOnce(daysAgo(1));
  const created = (await q<{ issue_id: string }>(`SELECT issue_id FROM recurring_runs WHERE rule_id = $1`, [rule.id]))[0];
  await due(rule.id); expect((await runRecurringOnce(clock())).skippedOpen).toBe(1);
  const [done] = await q<{ id: string }>(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND category = 'done'`, [fx.projects.p1]);
  await q(`UPDATE issues SET status_id = $2, done_at = now() WHERE id = $1`, [created.issue_id, done.id]);
  const tomorrow = new Date(clock().getTime() + 86_400_000);
  expect((await runRecurringOnce(tomorrow)).created).toBe(1);
});

test.each(["inactive", "removed"])("потеря доступа владельца (%s) ставит правило на паузу", async change => {
  const rule = await create(); await due(rule.id);
  if (change === "inactive") await q(`UPDATE users SET is_active = false WHERE id = $1`, [fx.users.mgr1]);
  else await q(`DELETE FROM project_members WHERE user_id = $1 AND project_id = $2`, [fx.users.mgr1, fx.projects.p1]);
  expect((await runRecurringOnce(clock())).paused).toBe(1);
  expect((await q(`SELECT state, paused_reason, next_run_at FROM recurring_rules WHERE id = $1`, [rule.id]))[0])
    .toEqual({ state: "paused", paused_reason: "owner_lost_access", next_run_at: null });
  expect(await q(`SELECT id FROM recurring_runs WHERE rule_id = $1`, [rule.id])).toEqual([]);
  expect(await q(`SELECT id FROM audit_log WHERE action = 'recurring.auto_pause' AND entity_id = $1`, [rule.id])).toHaveLength(1);
});

test("выпавший исполнитель исключается и фиксируется без текста задачи", async () => {
  const rule = await create(); await due(rule.id);
  await q(`DELETE FROM project_members WHERE user_id = $1 AND project_id = $2`, [fx.users.emp1, fx.projects.p1]);
  await runRecurringOnce(clock());
  const [run] = await q<{ issue_id: string; details: unknown }>(`SELECT issue_id, details FROM recurring_runs WHERE rule_id = $1`, [rule.id]);
  expect(run.details).toEqual({ droppedAssignees: [fx.users.emp1] });
  const history = await call("GET", `${url()}/${rule.id}/runs`);
  expect(history.statusCode).toBe(200);
  expect(history.json()[0].details).toEqual({ droppedAssignees: [fx.users.emp1] });
  expect(await q(`SELECT user_id FROM issue_assignees WHERE issue_id = $1`, [run.issue_id])).toEqual([]);
});

test("ошибка создания записывает failed, откатывает номер и сдвигает расписание", async () => {
  const rule = await create(); await due(rule.id);
  await q(`UPDATE workflow_statuses SET category = 'inprogress' WHERE project_id = $1 AND category = 'todo'`, [fx.projects.p1]);
  expect((await runRecurringOnce(clock())).failed).toBe(1);
  expect((await q(`SELECT result, error_code FROM recurring_runs WHERE rule_id = $1`, [rule.id]))[0])
    .toEqual({ result: "failed", error_code: "NOT_FOUND" });
  expect(await q(`SELECT next_num FROM project_counters WHERE project_id = $1`, [fx.projects.p1])).toEqual([{ next_num: 2 }]);
});

test("испорченное расписание останавливает только одно правило, остальные выполняются", async () => {
  const broken = await create(), good = await create({ name: "Good" });
  await due(broken.id); await due(good.id);
  await q(`UPDATE recurring_rules SET time_zone = 'Unknown/Zone' WHERE id = $1`, [broken.id]);
  expect(await runRecurringOnce(clock())).toMatchObject({ created: 1, failed: 1, paused: 1, processed: 2 });
  const rules = (await call("GET", url())).json();
  expect(rules.find((rule: { id: string }) => rule.id === broken.id))
    .toMatchObject({ state: "paused", pausedReason: "invalid_timing", lastResult: "failed" });
});

test("длина заголовка проверяется после подстановки даты, включая изменение шаблона", async () => {
  const long = "X".repeat(LIMITS.title.max - 6) + "{date}";
  expect((await call("POST", url(), manager, body({ title: long }))).statusCode).toBe(400);
  await q(`UPDATE issue_templates SET title = $2 WHERE id = $1`, [templateId, long]);
  expect((await call("POST", url(), manager, body())).statusCode).toBe(400);
  const override = await create({ title: "Valid", name: "Override" });
  expect((await call("PATCH", `${url()}/${override.id}`, manager, { title: long })).statusCode).toBe(400);
  await q(`UPDATE issue_templates SET title = 'Report {date}' WHERE id = $1`, [templateId]);
  const rule = await create(); await due(rule.id);
  await q(`UPDATE issue_templates SET title = $2 WHERE id = $1`, [templateId, long]);
  expect((await runRecurringOnce(clock())).failed).toBe(1);
  expect((await call("GET", `${url()}/${rule.id}/runs`)).json()[0])
    .toMatchObject({ result: "failed", errorCode: "VALIDATION", issueId: null });
});

test("ошибка вне создания задачи останавливает одно правило и не блокирует следующие", async () => {
  const broken = await create({ skipIfOpen: true }); await due(broken.id, 2);
  await runRecurringOnce(daysAgo(2));
  const good = await create({ name: "Good" });
  await due(broken.id, 1); await due(good.id);
  await q(`CREATE FUNCTION test_recurring_skip_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.result = 'skipped_open' THEN RAISE EXCEPTION 'test skip failure'; END IF; RETURN NEW; END $$`);
  await q(`CREATE TRIGGER test_recurring_skip_failure BEFORE INSERT ON recurring_runs
    FOR EACH ROW EXECUTE FUNCTION test_recurring_skip_failure()`);
  try {
    expect(await runRecurringOnce(clock())).toMatchObject({ processed: 2, created: 1, failed: 1, paused: 1 });
    const rows = (await call("GET", url())).json();
    expect(rows.find((rule: { id: string }) => rule.id === broken.id))
      .toMatchObject({ state: "paused", pausedReason: "run_failed" });
    expect((await call("GET", `${url()}/${broken.id}/runs`)).json()[0])
      .toMatchObject({ result: "failed", errorCode: "internal", scheduledFor: day(clock()) + "T09:00:00.000Z" });
  } finally {
    await q(`DROP TRIGGER test_recurring_skip_failure ON recurring_runs`);
    await q(`DROP FUNCTION test_recurring_skip_failure()`);
  }
});

test("run-now уникален по минуте и сохраняет next_run_at", async () => {
  const rule = await create();
  const responses = await Promise.all([call("POST", `${url()}/${rule.id}/run-now`), call("POST", `${url()}/${rule.id}/run-now`)]);
  expect(responses.map(response => response.statusCode).sort()).toEqual([201, 409]);
  const first = responses.find(response => response.statusCode === 201)!;
  expect(first.statusCode, first.body).toBe(201); expect(first.json()).toMatchObject({ manual: true, result: "created" });
  const second = responses.find(response => response.statusCode === 409)!;
  expect(second.statusCode).toBe(409); expect(second.json().error.code).toBe("RECURRING_ALREADY_RAN");
  expect((await call("GET", url())).json()[0].nextRunAt).toBe(rule.nextRunAt);
});

test("чужое правило нельзя читать или менять через другой проект", async () => {
  const rule = await create();
  const other = `/api/projects/${fx.projects.p2}/recurring/${rule.id}`;
  expect((await call("GET", `${other}/runs`, admin)).statusCode).toBe(404);
  expect((await call("PATCH", other, admin, { name: "Stolen" })).statusCode).toBe(404);
  for (const action of ["pause", "resume", "run-now"])
    expect((await call("POST", `${other}/${action}`, admin)).statusCode).toBe(404);
  expect((await call("DELETE", other, admin)).statusCode).toBe(404);
  expect((await call("GET", url())).json()[0]).toMatchObject({ name: "Weekly", state: "active" });
});

test("сервисный участник не может стать исполнителем правила", async () => {
  await q(`UPDATE users SET auth_source = 'service', password_hash = NULL, ldap_dn = NULL WHERE id = $1`, [fx.users.emp1]);
  expect((await call("POST", url(), manager, body())).statusCode).toBe(400);
  const rule = await create({ assigneeIds: [] });
  expect((await call("PATCH", `${url()}/${rule.id}`, manager, { assigneeIds: [fx.users.emp1] })).statusCode).toBe(400);
});

test("все изменения правил записывают аудит с вызывающим", async () => {
  const rule = await create();
  await call("PATCH", `${url()}/${rule.id}`, manager, { name: "Renamed" });
  await call("POST", `${url()}/${rule.id}/pause`);
  await call("POST", `${url()}/${rule.id}/resume`);
  await call("POST", `${url()}/${rule.id}/run-now`);
  expect((await call("DELETE", `${url()}/${rule.id}`)).statusCode).toBe(204);
  const rows = await q<{ action: string; actor_id: string }>(`SELECT action, actor_id FROM audit_log
    WHERE entity_id = $1 AND action LIKE 'recurring.%'`, [rule.id]);
  expect(rows.map(row => row.action).sort()).toEqual([
    "recurring.create", "recurring.delete", "recurring.pause", "recurring.resume", "recurring.run_now", "recurring.update",
  ]);
  expect(rows.every(row => row.actor_id === fx.users.mgr1)).toBe(true);
});

test("лимит 50 правил сериализует два конкурентных создания", async () => {
  const rule = await create();
  await q(`INSERT INTO recurring_rules (project_id, template_id, name, schedule, time_of_day, time_zone, start_date, owner_id, next_run_at)
    SELECT project_id, template_id, 'Rule ' || n, schedule, time_of_day, time_zone, start_date, owner_id, next_run_at
    FROM recurring_rules CROSS JOIN generate_series(2,49) AS n WHERE id = $1`, [rule.id]);
  const responses = await Promise.all([call("POST", url(), manager, body({ name: "A" })), call("POST", url(), manager, body({ name: "B" }))]);
  expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409]);
  expect(responses.find(r => r.statusCode === 409)!.json().error.code).toBe("RECURRING_LIMIT");
  expect((await call("GET", url())).json()).toHaveLength(50);
});

test("созданная правилом задача даёт обычный issue.created вебхука", async () => {
  const rule = await create(); await due(rule.id);
  await q(`INSERT INTO webhooks (project_id, name, url_enc, url_display, secret_enc, events)
    VALUES ($1, 'Fixture', 'fixture', 'https://example.test/hook', 'fixture', ARRAY['issue.created'])`, [fx.projects.p1]);
  await runRecurringOnce(clock());
  const [event] = await q<{ type: string; changes: unknown }>(`SELECT type, changes FROM integration_events WHERE project_id = $1`, [fx.projects.p1]);
  expect(event.type).toBe("issue.created"); expect(event.changes).toEqual([{ kind: "created", ruleId: rule.id, ruleName: "Weekly" }]);
});

test("один тик обрабатывает максимум 20 правил, следующий забирает остаток", async () => {
  const rule = await create(); await due(rule.id);
  await q(`INSERT INTO recurring_rules (project_id, template_id, name, schedule, time_of_day, time_zone, start_date, owner_id, next_run_at)
    SELECT project_id, template_id, 'Rule ' || n, schedule, time_of_day, time_zone, start_date, owner_id, next_run_at
    FROM recurring_rules CROSS JOIN generate_series(2,22) AS n WHERE id = $1`, [rule.id]);
  expect(await runRecurringOnce(clock())).toMatchObject({ processed: 20, created: 20 });
  expect(await runRecurringOnce(clock())).toMatchObject({ processed: 2, created: 2 });
});

test("выключенное задание не создаёт задач, метрика задержки и очистка истории работают", async () => {
  const rule = await create(); await due(rule.id, 1);
  loadConfig().recurring.enabled = false;
  expect((await runRecurringOnce(clock())).skipped).toBe(true);
  expect(await q(`SELECT id FROM recurring_runs WHERE rule_id = $1`, [rule.id])).toEqual([]);
  await refreshBackgroundQueueMetrics(); expect(renderMetrics(0)).toMatch(/taskira_recurring_lag_seconds [1-9]/);
  await q(`INSERT INTO recurring_runs (rule_id, scheduled_for, ran_at, result)
    SELECT $1, now() - n * interval '1 day', now() - n * interval '1 day', 'skipped_open' FROM generate_series(0,209) n`, [rule.id]);
  await q(`INSERT INTO recurring_runs (rule_id, scheduled_for, ran_at, result)
    VALUES ($1, now() - interval '400 days', now() - interval '400 days', 'failed')`, [rule.id]);
  await runMaintenanceOnce();
  expect(await q(`SELECT id FROM recurring_runs WHERE rule_id = $1`, [rule.id])).toHaveLength(200);
  expect((await q<{ details: { recurringRunsPurged: number } }>(`SELECT details FROM audit_log WHERE action = 'maintenance.run'`))[0].details.recurringRunsPurged).toBe(11);
});
