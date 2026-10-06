/** INT-14: реальные агрегаты, права доступа, независимые отказы, дедлайн и scrape операций хоста. */
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as db from "../src/db.js";
import * as readiness from "../src/services/readiness.js";
import * as maintenance from "../src/services/maintenance.js";
import * as license from "../src/services/license.js";
import { loadConfig } from "../src/config.js";
import { OpsRunDto, SystemStatusDto, type SystemCheck } from "../src/contract.js";
import { clearSystemStatusCache, getSystemStatus, systemChecks } from "../src/services/systemStatus.js";
import { opsState } from "../src/services/opsStatus.js";
import { generateToken, invalidateUserTokens } from "../src/services/apiTokens.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance, fx: Fixture, adm: string;
const cfg = loadConfig();
const saved = { notify: { ...cfg.notify }, webhooks: { ...cfg.webhooks }, recurring: { ...cfg.recurring }, authMode: cfg.authMode, ldap: cfg.ldap };
beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await stopApp(); });
beforeEach(async () => {
  await resetDb(); fx = await seedFixture(); adm = await login(app, "admin"); clearSystemStatusCache();
  cfg.notify.emailEnabled = false; cfg.webhooks.enabled = false; cfg.recurring.enabled = true;
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); clearSystemStatusCache(); maintenance.stopMaintenance();
  Object.assign(cfg.notify, saved.notify); Object.assign(cfg.webhooks, saved.webhooks); Object.assign(cfg.recurring, saved.recurring);
  cfg.authMode = saved.authMode; cfg.ldap = saved.ldap;
  invalidateUserTokens(fx.users.admin);
});
const status = () => app.inject({ method: "GET", url: "/api/admin/status", headers: auth(adm) });
async function record(kind: "backup" | "restore_drill", result: "running" | "success" | "failure", hours: number, archive = "/private/backups/fixture.tar.gz") {
  await q(`INSERT INTO ops_runs(kind,result,started_at,finished_at,archive)
    VALUES($1,$2,now()-make_interval(secs=>$3),CASE WHEN $2='running' THEN NULL ELSE now()-make_interval(secs=>$3) END,$4)`, [kind, result, hours * 3600, archive]);
}

test("глобальный администратор: все 11 проверок в порядке контракта; /ready сохраняет ответ", async () => {
  const response = await status(); expect(response.statusCode).toBe(200);
  const dto = SystemStatusDto.parse(response.json());
  expect(dto.checks.map(check => check.id)).toEqual(["database", "storage", "mail", "ldap", "jobs", "license", "search", "backup", "restoreDrill", "webhooks", "recurring"]);
  expect(dto.checks.find(check => check.id === "database")?.state).toBe("ok");
  expect(dto.checks.find(check => check.id === "backup")?.state).toBe("unknown");
  expect(dto.version).toBe(cfg.version); expect(Date.parse(dto.checkedAt)).toBeGreaterThan(0);
  const ready = await app.inject({ method: "GET", url: "/ready" });
  expect(ready.statusCode).toBe(200); expect(ready.json()).toMatchObject({ ok: true, db: true, checks: { db: true, migrations: true, storage: true }, version: cfg.version });
});
test("участники, менеджеры проекта и API-токен администратора не читают статус и историю", async () => {
  const generated = generateToken();
  await q(`INSERT INTO api_tokens(user_id,name,prefix,secret_hash,scope,created_by,expires_at)
    VALUES($1,'Status test',$2,$3,'read',$1,now()+interval '1 day')`, [fx.users.admin, generated.prefix, generated.hash]);
  for (const credential of [await login(app, "emp1"), await login(app, "mgr1"), generated.token]) {
    for (const url of ["/api/admin/status", "/api/admin/ops-runs?kind=backup"]) {
      const response = await app.inject({ method: "GET", url, headers: auth(credential) });
      expect(response.statusCode).toBe(403);
      if (credential === generated.token) expect(response.json().error.code).toBe("TOKEN_NOT_ALLOWED");
    }
  }
});
test.each([
  ["backup", 1, "ok"], ["backup", 30, "warn"], ["backup", 60, "fail"],
  ["restore_drill", 24, "ok"], ["restore_drill", 9 * 24, "warn"], ["restore_drill", 16 * 24, "fail"],
] as const)("%s: успех %i часов назад → %s", async (kind, hours, state) => {
  await record(kind, "success", hours, "C:\\backups\\safe.tar.gz");
  const check = kind === "backup" ? await systemChecks.backup() : await systemChecks.restoreDrill();
  expect(check.state).toBe(state); expect(check.facts.archive).toBe("safe.tar.gz"); expect(check.facts.lastResult).toBe("success");
});
test.each(["backup", "restore_drill"] as const)("%s: последняя ошибка и зависший запуск преобладают над свежим успехом", async kind => {
  await record(kind, "success", 8);
  await record(kind, "failure", 7.5);
  const check = () => kind === "backup" ? systemChecks.backup() : systemChecks.restoreDrill();
  expect((await check()).state).toBe("fail");
  await record(kind, "running", 7);
  expect(await check()).toMatchObject({ state: "fail", facts: { lastResult: "interrupted" } });
  await record(kind, "running", 0.1);
  expect(await check()).toMatchObject({ state: "ok", facts: { lastResult: "running" } });
});
test("история: только нужный вид, последние пять, ограничение 50 и basename", async () => {
  for (let n = 1; n <= 6; n++) await record("backup", "success", n);
  await record("restore_drill", "running", 7);
  const response = await app.inject({ method: "GET", url: "/api/admin/ops-runs?kind=backup", headers: auth(adm) });
  const runs = OpsRunDto.array().parse(response.json());
  expect(response.statusCode).toBe(200); expect(runs).toHaveLength(5);
  expect(runs.every(run => run.kind === "backup" && run.archive === "fixture.tar.gz")).toBe(true);
  expect(Date.parse(runs[0].startedAt)).toBeGreaterThan(Date.parse(runs[1].startedAt));
  for (const query of ["kind=backup&limit=51", "kind=backup&limit=0", "kind=other", "limit=5", "kind=backup&extra=x"]) {
    expect((await app.inject({ method: "GET", url: "/api/admin/ops-runs?" + query, headers: auth(adm) })).statusCode).toBe(400);
  }
  const interrupted = await app.inject({ method: "GET", url: "/api/admin/ops-runs?kind=restore_drill", headers: auth(adm) });
  expect(interrupted.json()[0].result).toBe("interrupted");
});
test("почта: off, нет SMTP, старое ожидание и реальное время окончательного отказа", async () => {
  expect((await systemChecks.mail()).state).toBe("off");
  cfg.notify.emailEnabled = true; cfg.notify.smtp = null;
  expect((await systemChecks.mail()).state).toBe("fail");
  cfg.notify.smtp = { host: "fixture", port: 25, user: null, pass: null, from: "fixture@example.test", secure: false, tlsRejectUnauthorized: true };
  await q(`INSERT INTO notifications(user_id,type,created_at,email_state,email_failed_at)
    VALUES($1,'issue.assigned',now()-interval '40 minutes','pending',NULL),
      ($1,'issue.assigned',now()-interval '3 days','failed',now()),
      ($1,'issue.assigned',now(),'failed',now()-interval '2 days'),
      ($1,'issue.assigned',now(),'failed',NULL)`, [fx.users.emp1]);
  expect(await systemChecks.mail()).toMatchObject({ state: "warn", facts: { pending: 1, failed24h: 1 } });
  expect((await systemChecks.mail()).facts.oldestPendingSec).toBeGreaterThan(2300);
});
test("вебхуки: выключенная пустая функция off; disabled, старая очередь и свежий отказ warn", async () => {
  expect((await systemChecks.webhooks()).state).toBe("off");
  const [hook] = await q<{ id: string }>(`INSERT INTO webhooks(project_id,name,url_enc,url_display,secret_enc,events,state,disabled_reason)
    VALUES($1,'Fixture','sealed','https://fixture.example','sealed',ARRAY['issue.created'],'disabled','failing') RETURNING id`, [fx.projects.p1]);
  expect(await systemChecks.webhooks()).toMatchObject({ state: "warn", facts: { disabled: 1 } });
  await q(`UPDATE webhooks SET state='active',disabled_reason=NULL WHERE id=$1`, [hook.id]); cfg.webhooks.enabled = true;
  const [event] = await q<{ id: string }>(`INSERT INTO integration_events(type,project_id,dedupe_key)
    VALUES('issue.created',$1,'status-fixture') RETURNING id`, [fx.projects.p1]);
  await q(`INSERT INTO webhook_deliveries(webhook_id,event_id,manual,state,created_at,updated_at)
    VALUES($1,$2,true,'pending',now()-interval '20 minutes',now()),
      ($1,$2,true,'failed',now()-interval '2 days',now()),
      ($1,$2,true,'failed',now(),now()-interval '2 days')`, [hook.id, event.id]);
  expect(await systemChecks.webhooks()).toMatchObject({ state: "warn", facts: { active: 1, pending: 1, failed24h: 1 } });
});
test("повторы: пусто/off, потерявший доступ владелец, суточные ошибки", async () => {
  expect((await systemChecks.recurring()).state).toBe("off");
  const [template] = await q<{ id: string }>(`INSERT INTO issue_templates(project_id,name,fields) VALUES($1,'Status','{}') RETURNING id`, [fx.projects.p1]);
  const [rule] = await q<{ id: string }>(`INSERT INTO recurring_rules(project_id,template_id,name,schedule,time_of_day,time_zone,start_date,state,paused_reason)
    VALUES($1,$2,'Status','{"freq":"daily","every":1}','09:00','UTC',current_date,'paused','owner_lost_access') RETURNING id`, [fx.projects.p1, template.id]);
  await q(`INSERT INTO recurring_runs(rule_id,scheduled_for,ran_at,result) VALUES
    ($1,now(),now(),'failed'),($1,now()-interval '2 days',now()-interval '2 days','failed')`, [rule.id]);
  expect(await systemChecks.recurring()).toMatchObject({ state: "warn", facts: { paused: 1, ownerLostAccess: 1, failed24h: 1 } });
  cfg.recurring.enabled = false; expect((await systemChecks.recurring()).state).toBe("off");
});
test("БД: задержка, неприменённая миграция и недоступность", async () => {
  const probe = vi.spyOn(readiness, "checkDatabaseReadiness");
  probe.mockResolvedValue({ db: true, migrations: true, pending: [], latencyMs: 201 });
  expect((await systemChecks.database()).state).toBe("warn");
  probe.mockResolvedValue({ db: true, migrations: false, pending: ["pending.sql"], latencyMs: 2 });
  expect(await systemChecks.database()).toMatchObject({ state: "fail", facts: { pendingMigrations: ["pending.sql"] } });
  probe.mockResolvedValue({ db: false, migrations: false, pending: [], latencyMs: null });
  expect((await systemChecks.database()).state).toBe("fail");
});
test("диск: абсолютные и относительные пороги; неготовность fail", async () => {
  vi.spyOn(readiness, "checkStorageReadiness").mockResolvedValue(true);
  const probe = vi.spyOn(fs, "statfs");
  for (const [free, total, expected] of [[4, 20, "ok"], [1, 20, "warn"], [4, 100, "warn"], [0.4, 20, "fail"], [3, 200, "fail"]] as const) {
    probe.mockResolvedValue({ bavail: free * 1024 ** 3, blocks: total * 1024 ** 3, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
    expect((await systemChecks.storage()).state).toBe(expected);
  }
  vi.mocked(readiness.checkStorageReadiness).mockResolvedValue(false);
  expect((await systemChecks.storage()).state).toBe("fail");
});
test("LDAP: ручной успешный ресинк, старый успех и ошибки без DN и текста исключения", async () => {
  cfg.authMode = "ldap"; cfg.ldap = { bindDn: "fixture", resyncIntervalMs: 3600_000 } as NonNullable<typeof cfg.ldap>;
  await q(`INSERT INTO audit_log(action,created_at,details) VALUES('ldap.resync',now()-interval '1 hour','{"errors":0,"notFound":0}')`);
  expect((await systemChecks.ldap()).state).toBe("ok");
  await q(`UPDATE audit_log SET created_at=now()-interval '4 hours' WHERE action='ldap.resync'`);
  expect((await systemChecks.ldap()).state).toBe("warn");
  await q(`INSERT INTO audit_log(action,details) VALUES('ldap.resync','{"errors":1,"notFound":0}')`);
  expect(await systemChecks.ldap()).toMatchObject({ state: "warn", facts: { lastError: "resync_failed" } });
});
test("задания: последний успех сохраняется после ошибки; стартовая задержка и три интервала", async () => {
  await maintenance.trackedTick("status-fixture", async () => undefined);
  const tracked = maintenance.getMaintenanceStatus().jobs[0]; const success = tracked.lastSuccessAt;
  await expect(maintenance.trackedTick("status-fixture", async () => { throw new Error("private bind password"); })).rejects.toThrow();
  expect(tracked.lastSuccessAt).toBe(success); expect((await systemChecks.jobs()).state).toBe("warn");
  const view = vi.spyOn(maintenance, "getMaintenanceStatus");
  const job = { ...tracked, lastResult: null, lastSuccessAt: null, intervalMs: 60_000, startDelayMs: 300_000 };
  view.mockReturnValue({ enabled: true, jobs: [job] }); vi.spyOn(process, "uptime").mockReturnValue(10);
  expect((await systemChecks.jobs()).state).toBe("ok");
  vi.mocked(process.uptime).mockReturnValue(400); expect((await systemChecks.jobs()).state).toBe("warn");
  job.lastSuccessAt = new Date(Date.now() - 181_000).toISOString(); expect((await systemChecks.jobs()).state).toBe("warn");
});
test("лицензия: unset, неверная подпись, срок, grace и места", async () => {
  const probe = vi.spyOn(license, "getLicenseStatus");
  probe.mockResolvedValue({ state: "unset" }); expect((await systemChecks.license()).state).toBe("warn");
  probe.mockResolvedValue({ state: "invalid", reason: "bad_signature" }); expect((await systemChecks.license()).state).toBe("fail");
  const claims = { plan: "fixture", features: [], maxSeats: 10, activeWindowDays: 30, iat: 1, exp: Date.now() / 1000 + 40 * 86400 };
  for (const [daysUntilExpiry, seatsOverLimit, expected] of [[40, false, "ok"], [30, false, "warn"], [40, true, "warn"]] as const) {
    probe.mockResolvedValue({ state: "active", claims, daysUntilExpiry, seatsUsed: 1, seatsOverLimit }); expect((await systemChecks.license()).state).toBe(expected);
  }
  probe.mockResolvedValue({ state: "expired", claims, daysSinceExpiry: 1, seatsUsed: 1, seatsOverLimit: false }); expect((await systemChecks.license()).state).toBe("warn");
});
test("отказ одной проверки: unknown с нулевыми фактами, остальные успешны; секрет не журналируется", async () => {
  vi.spyOn(systemChecks, "mail").mockRejectedValue(new Error("secret SMTP password")); const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dto = await getSystemStatus();
  expect(dto.checks.find(check => check.id === "mail")).toMatchObject({ state: "unknown", facts: { pending: 0, failed24h: 0 } });
  expect(dto.checks.find(check => check.id === "database")?.state).toBe("ok");
  expect(JSON.stringify(log.mock.calls)).not.toContain("password");
});
test("общий дедлайн: зависший источник unknown через 5 с; уже готовые проверки сохранены", async () => {
  const initial = await getSystemStatus(); clearSystemStatusCache();
  for (const check of initial.checks) vi.spyOn(systemChecks, check.id).mockImplementation(async () => check as never);
  vi.mocked(systemChecks.mail).mockImplementation(() => new Promise(() => undefined));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = getSystemStatus(); await vi.advanceTimersByTimeAsync(5000);
  const dto = await pending;
  expect(dto.checks.find(check => check.id === "mail")?.state).toBe("unknown");
  expect(dto.checks.find(check => check.id === "database")?.state).toBe("ok"); expect(log).toHaveBeenCalledWith("[system-status] mail check timed out");
});
test("кэш и одновременные запросы используют один набор чтений БД", async () => {
  const spy = vi.spyOn(db, "q");
  const [first, parallel] = await Promise.all([getSystemStatus(), getSystemStatus()]); const count = spy.mock.calls.length;
  expect(count).toBeGreaterThan(5); expect(parallel).toBe(first);
  expect(await getSystemStatus()).toBe(first); expect(spy).toHaveBeenCalledTimes(count);
});
test("scrape читает операции напрямую, текущий запуск сохраняет завершённый результат, зависший даёт 0", async () => {
  await record("backup", "success", 8);
  const scrape = async () => (await app.inject({ method: "GET", url: "/metrics" })).body;
  expect(await scrape()).toMatch(/taskira_ops_last_success_timestamp_seconds\{kind="backup"\} \d/);
  expect(await scrape()).toContain('taskira_ops_last_run_success{kind="backup"} 1');
  await record("backup", "running", 7); expect(await scrape()).toContain('taskira_ops_last_run_success{kind="backup"} 0');
  await record("backup", "running", 0.1); expect(await scrape()).toContain('taskira_ops_last_run_success{kind="backup"} 1');
  await record("backup", "failure", 0); expect(await scrape()).toContain('taskira_ops_last_run_success{kind="backup"} 0');
});
test("точные пороги операций и пустая история", () => {
  const now = Date.now(), facts = { lastSuccessAt: null, lastRunAt: null, lastResult: null, archive: null };
  expect(opsState(facts, "backup", now)).toBe("unknown");
  for (const [hours, expected] of [[25.99, "ok"], [26, "warn"], [50, "fail"]] as const) {
    expect(opsState({ ...facts, lastSuccessAt: new Date(now - hours * 3600_000).toISOString() }, "backup", now)).toBe(expected);
  }
});
