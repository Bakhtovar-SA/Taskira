/**
 * MAINT-01: обслуживание пачками, dry-run, метрики и статус джобов, лок на ручной запуск, отложенный старт.
 * Настройки пачек меняются на кэшированном конфиге на время теста (loadConfig() отдаёт один и тот же объект).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { withAdvisoryLock, withClient } from "../src/db.js";
import { _resetMetrics, renderMetrics } from "../src/metrics.js";
import {
  getMaintenanceStatus,
  runMaintenanceManual,
  runMaintenanceOnce,
  startMaintenance,
  stopMaintenance,
  trackedTick,
} from "../src/services/maintenance.js";

let app: FastifyInstance;
let fx: Fixture;
let adm: string;

const cfg = () => loadConfig().maintenance;
const saved = { ...loadConfig().maintenance };

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
  _resetMetrics();
  Object.assign(cfg(), saved, { batchSize: 10, batchPauseMs: 0, maxPerRun: 1000 });
});
afterEach(() => {
  stopMaintenance();
  Object.assign(cfg(), saved);
});

/** n закрытых 40 дней назад задач CORP (архивации подлежат). */
async function oldClosed(n: number, tag = "old"): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${fx.projects.p1}/issues`,
      headers: auth(adm),
      payload: newIssue({ title: `${tag}-${i}` }),
    });
    expect(res.statusCode).toBe(201);
    ids.push(JSON.parse(res.body).id);
  }
  await q(`UPDATE issues SET done_at = now() - interval '40 days' WHERE title LIKE $1`, [`${tag}-%`]);
  return ids;
}
const archivedCount = async () =>
  Number((await q<{ n: string }>(`SELECT count(*) AS n FROM issues WHERE archived_at IS NOT NULL`))[0].n);
const auditRuns = () => q<{ details: Record<string, unknown> }>(`SELECT details FROM audit_log WHERE action = 'maintenance.run'`);

describe("пачки и потолок за проход", () => {
  test("60 подходящих при потолке 25: 25 → 25 → 10, capped только пока остаток мог остаться", async () => {
    await oldClosed(60);
    cfg().maxPerRun = 25;
    const a = await runMaintenanceOnce();
    expect([a.archived, a.capped]).toEqual([25, true]);
    expect(await archivedCount()).toBe(25);
    const b = await runMaintenanceOnce();
    expect([b.archived, b.capped]).toEqual([25, true]);
    const c = await runMaintenanceOnce();
    expect([c.archived, c.capped]).toEqual([10, false]);
    expect(await archivedCount()).toBe(60);
    expect((await runMaintenanceOnce()).archived).toBe(0);
  });

  test("строка, заблокированная другой транзакцией, пропускается (SKIP LOCKED), проход не ждёт и не висит", async () => {
    const ids = await oldClosed(12);
    await withClient(async (other) => {
      await other.query("BEGIN");
      await other.query(`SELECT id FROM issues WHERE id = $1 FOR UPDATE`, [ids[0]]); // «пользователь правит эту задачу»
      const t0 = Date.now();
      const s = await runMaintenanceOnce();
      expect(Date.now() - t0).toBeLessThan(3000); // без SKIP LOCKED проход стоял бы до COMMIT
      expect(s.archived).toBe(11);
      await other.query("ROLLBACK");
    });
    expect((await q<{ archived_at: Date | null }>(`SELECT archived_at FROM issues WHERE id = $1`, [ids[0]]))[0].archived_at).toBeNull();
    expect((await runMaintenanceOnce()).archived).toBe(1); // забрана следующим проходом
  });

  test("уборка audit_log идёт теми же пачками и тем же потолком", async () => {
    cfg().auditRetentionDays = 30;
    await q(
      `INSERT INTO audit_log (action, entity, created_at) SELECT 'old.event', 'x', now() - interval '90 days' FROM generate_series(1, 35)`,
    );
    cfg().maxPerRun = 20;
    const a = await runMaintenanceOnce();
    expect([a.auditPurged, a.capped]).toEqual([20, true]);
    const b = await runMaintenanceOnce();
    // старые аудиты: 15 из первой партии + строка `maintenance.run` — свежая, не удаляется
    expect([b.auditPurged, b.capped]).toEqual([15, false]);
  });
});

describe("dry-run", () => {
  test("считает и ничего не меняет: ни архива, ни аудита, ни метрик", async () => {
    await oldClosed(7);
    const s = await runMaintenanceOnce({ dryRun: true });
    expect(s).toMatchObject({ archived: 7, auditPurged: 0, dryRun: true, capped: false });
    expect(await archivedCount()).toBe(0);
    expect(await auditRuns()).toHaveLength(0);
    expect(renderMetrics(0)).toContain("taskira_maintenance_archived_issues_total 0");
  });

  test("capped показывает, что работа не поместится в один проход", async () => {
    await oldClosed(7);
    cfg().maxPerRun = 5;
    expect(await runMaintenanceOnce({ dryRun: true })).toMatchObject({ archived: 7, capped: true });
  });
});

describe("след в данных и метриках", () => {
  test("проход с работой пишет audit_log `maintenance.run`; пустой проход — нет", async () => {
    await runMaintenanceOnce();
    expect(await auditRuns()).toHaveLength(0);
    await oldClosed(3);
    await runMaintenanceOnce();
    const rows = await auditRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ archived: 3, auditPurged: 0, capped: false, trigger: "schedule" });
  });

  test("успешный тик: метрики runs/duration/last_success/running и счётчик архивированных", async () => {
    await oldClosed(4);
    expect(await trackedTick("maintenance", async () => runMaintenanceOnce())).toBe(true);
    const m = renderMetrics(0);
    expect(m).toContain('taskira_background_job_runs_total{job="maintenance",result="success"} 1');
    expect(m).toMatch(/taskira_background_job_duration_seconds_count\{job="maintenance"\} 1/);
    expect(m).toMatch(/taskira_background_job_last_success_timestamp_seconds\{job="maintenance"\} \d+/);
    expect(m).toContain('taskira_background_job_running{job="maintenance"} 0');
    expect(m).toContain("taskira_maintenance_archived_issues_total 4");
    const st = getMaintenanceStatus().jobs.find((j) => j.name === "maintenance")!;
    expect(st).toMatchObject({ lastResult: "success", running: false, lastError: null });
    expect(st.lastDetail).toMatchObject({ archived: 4 });
  });

  test("упавший тик: result=error, last_success не появляется, ошибка в статусе", async () => {
    await expect(
      trackedTick("maintenance", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const m = renderMetrics(0);
    expect(m).toContain('taskira_background_job_runs_total{job="maintenance",result="error"} 1');
    expect(m).not.toContain("taskira_background_job_last_success_timestamp_seconds{");
    expect(getMaintenanceStatus().jobs.find((j) => j.name === "maintenance")).toMatchObject({ lastResult: "error", lastError: "boom" });
  });

  test("тик при чужом локе: result=skipped, работа не выполняется, длительность не пишется", async () => {
    let ran = false;
    await withAdvisoryLock("taskira:job:maintenance", { wait: false }, async () => {
      expect(
        await trackedTick("maintenance", async () => {
          ran = true;
        }),
      ).toBe(false);
    });
    expect(ran).toBe(false);
    const m = renderMetrics(0);
    expect(m).toContain('taskira_background_job_runs_total{job="maintenance",result="skipped"} 1');
    expect(m).not.toContain("taskira_background_job_duration_seconds_count");
  });
});

describe("ручной запуск", () => {
  test("реальный запуск при занятом локе — 409, данные не тронуты; dry-run лока не требует", async () => {
    await oldClosed(3);
    await withAdvisoryLock("taskira:job:maintenance", { wait: false }, async () => {
      await expect(runMaintenanceManual({ dryRun: false, actorId: fx.users.admin })).rejects.toMatchObject({ statusCode: 409, code: "maintenance_busy" });
      expect(await runMaintenanceManual({ dryRun: true, actorId: fx.users.admin })).toMatchObject({ archived: 3, dryRun: true });
    });
    expect(await archivedCount()).toBe(0);
  });

  test("эндпоинты: dryRun обязателен; не админ — 403; dryRun=true считает, dryRun=false архивирует и пишет actor в аудит", async () => {
    await oldClosed(5);
    const emp = await login(app, "emp1");
    const call = (method: "GET" | "POST", url: string, token: string) => app.inject({ method, url, headers: auth(token) });

    expect((await call("GET", "/api/maintenance", emp)).statusCode).toBe(403);
    expect((await call("POST", "/api/maintenance/run?dryRun=true", emp)).statusCode).toBe(403);
    expect((await call("POST", "/api/maintenance/run", adm)).statusCode).toBe(400);
    expect((await call("POST", "/api/maintenance/run?dryRun=maybe", adm)).statusCode).toBe(400);

    const dry = await call("POST", "/api/maintenance/run?dryRun=true", adm);
    expect(dry.statusCode).toBe(200);
    expect(JSON.parse(dry.body)).toMatchObject({ archived: 5, dryRun: true });
    expect(await archivedCount()).toBe(0);

    const real = await call("POST", "/api/maintenance/run?dryRun=false", adm);
    expect(real.statusCode).toBe(200);
    expect(JSON.parse(real.body)).toMatchObject({ archived: 5, dryRun: false });
    expect(await archivedCount()).toBe(5);
    const [row] = await q<{ actor_id: string; details: { trigger: string } }>(
      `SELECT actor_id, details FROM audit_log WHERE action = 'maintenance.run'`,
    );
    expect(row.actor_id).toBe(fx.users.admin);
    expect(row.details.trigger).toBe("manual");

    const status = JSON.parse((await call("GET", "/api/maintenance", adm)).body);
    expect(status.settings).toMatchObject({ batchSize: 10, maxPerRun: 1000, archiveAfterDays: 30 });
    expect(status.jobs.find((j: { name: string }) => j.name === "maintenance")).toMatchObject({ lastResult: "success" });
  });
});

describe("отложенный старт", () => {
  test("после startMaintenance первый проход не выполняется сразу: lastRunAt пуст, nextRunAt — не раньше задержки", async () => {
    await oldClosed(2);
    Object.assign(cfg(), { enabled: true, startDelayMs: 60_000, storageSweepEnabled: false });
    const before = Date.now();
    startMaintenance();
    await new Promise((r) => setTimeout(r, 300));
    const job = getMaintenanceStatus().jobs.find((j) => j.name === "maintenance")!;
    expect(job.lastRunAt).toBeNull();
    expect(new Date(job.nextRunAt!).getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(await archivedCount()).toBe(0); // рестарт ничего не архивировал
  });
});
