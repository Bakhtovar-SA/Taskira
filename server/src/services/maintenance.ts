/** Фоновое обслуживание (аудит LIFE-03 / PERF-05, MAINT-01).
 *
 *  Три независимых джоба на общем таймер-хелпере (startJob ниже):
 *   1) архив + audit_log, каждый intervalMs (по умолчанию раз в час):
 *      - автоархив — задачам с done_at старше config.maintenance.archiveAfterDays
 *        проставляется archived_at. Это НЕ удаление: строка остаётся, задача
 *        открывается по прямой ссылке, ищется (?archived=all) и участвует в
 *        отчётах. Она лишь уходит из активного набора проекта, чтобы доска и
 *        «Список задач» не росли бесконечно.
 *      - уборка audit_log — строки старше auditRetentionDays удаляются
 *        (0 = хранить вечно).
 *      Обе части идут ПАЧКАМИ (batchSize строк, пауза batchPauseMs, потолок maxPerRun за проход): каждая пачка —
 *      отдельный оператор в своей транзакции, поэтому блокировка строк держится на время пачки, а не всего прохода;
 *      id в память не читаются, считается только число строк.
 *   2) сборщик осиротевших объектов Storage (storageSweeper.ts), каждый
 *      storageSweepIntervalMs (по умолчанию раз в сутки — реже, чем архив:
 *      полный листинг бакета/каталога дороже одного UPDATE).
 *   3) ресинк членства в департаментах из LDAP-групп (departmentSync.ts),
 *      каждый ldap.resyncIntervalMs (по умолчанию раз в 6 часов). Только при
 *      AUTH_MODE=ldap и настроенном сервис-аккаунте (LDAP_BIND_DN) — до этого
 *      членство обновлялось только JIT при логине и вручную (POST
 *      /api/ldap/resync); без периодического прохода уволенный/переведённый
 *      сотрудник держал старый доступ до следующего входа.
 *
 *  Каждый — отдельный таймер, а не дополнительная ветка в одном тике: разная
 *  стоимость и каданс, и ни один не должен запускаться на каждый прогон
 *  runMaintenanceOnce() в тестах архивации.
 *
 *  Первый проход — НЕ сразу при старте, а через maintenance.startDelayMs (по умолчанию 5 минут): рестарт или
 *  деплой в час пик не должен запускать работу. sweep и LDAP идут после этой задержки со своим сдвигом (+15 с,
 *  +30 с), чтобы не стартовать залпом в одну секунду.
 *
 *  Один исполнитель на кластер: каждый тик берёт pg_try_advisory_lock джоба (runJobLocked); процесс, не получивший
 *  лок, пропускает тик (метрика result="skipped"). Ручной запуск (POST /api/maintenance/run) берёт тот же лок.
 *  Каждый тик виден в /metrics (taskira_background_job_*) и в getMaintenanceStatus(); реальный проход с работой
 *  оставляет запись audit_log `maintenance.run`. Метрики и статус — по процессу, не по кластеру.
 *
 *  Все три стартуют вместе, но независимо, а не второй проход в notifier:
 *  тот стартует только при включённом email (NOTIFY_EMAIL_ENABLED), а архив
 *  нужен всегда. MAINTENANCE_ENABLED=false отключает джобы в этом процессе.
 */
import type pg from "pg";
import { q, withAdvisoryLock, withClient } from "../db.js";
import { audit } from "../audit.js";
import { ApiHttpError } from "../errors.js";
import { loadConfig, type MaintenanceConfig } from "../config.js";
import { addMaintenanceWork, recordBackgroundJob, setBackgroundJobRunning } from "../metrics.js";
import { getStorage } from "./storage.js";
import { runStorageSweepOnce } from "./storageSweeper.js";
import { resyncAllLdapUsers } from "./departmentSync.js";

export interface MaintenanceStats {
  archived: number;
  auditPurged: number;
  /** Упёрлись в MAINTENANCE_MAX_PER_RUN: остаток обработают следующие проходы. При dryRun — «столько строк не
   *  поместится в один проход». */
  capped: boolean;
  dryRun: boolean;
}

export interface MaintenanceOptions {
  /** Только посчитать, что будет сделано; данные не меняются, метрики и аудит не пишутся. */
  dryRun?: boolean;
  /** Кто запустил (id администратора при ручном запуске; null — по расписанию). */
  actorId?: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Условия «пора» — одни и те же для пачек и для dry-run, чтобы они не разошлись. */
const ARCHIVE_WHERE = `done_at IS NOT NULL AND archived_at IS NULL AND done_at < now() - make_interval(days => $1::int)`;
const PURGE_WHERE = `created_at < now() - make_interval(days => $1::int)`;

/**
 * Выполняет пачки одного оператора, пока пачка полная и не достигнут потолок за проход. Каждая пачка — отдельный
 * оператор в собственной транзакции. Возвращает число затронутых строк (id в память не читаются).
 */
async function inBatches(
  client: pg.PoolClient,
  sql: string,
  days: number,
  cfg: MaintenanceConfig,
): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  while (count < cfg.maxPerRun) {
    const limit = Math.min(cfg.batchSize, cfg.maxPerRun - count);
    const r = await client.query(sql, [days, limit]);
    const n = r.rowCount ?? 0;
    count += n;
    if (n < limit) return { count, capped: false };
    if (cfg.batchPauseMs > 0) await sleep(cfg.batchPauseMs);
  }
  return { count, capped: true };
}

/** Один проход архив + audit_log. Экспортируется для тестов, ручного запуска и dry-run. */
export async function runMaintenanceOnce(opts: MaintenanceOptions = {}): Promise<MaintenanceStats> {
  const cfg = loadConfig().maintenance;

  if (opts.dryRun === true) {
    const [a] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM issues WHERE ${ARCHIVE_WHERE}`, [cfg.archiveAfterDays]);
    const [p] =
      cfg.auditRetentionDays > 0
        ? await q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE ${PURGE_WHERE}`, [cfg.auditRetentionDays])
        : [{ n: 0 }];
    return { archived: a.n, auditPurged: p.n, capped: a.n > cfg.maxPerRun || p.n > cfg.maxPerRun, dryRun: true };
  }

  const done = await withClient(async (client) => {
    // make_interval, а не строковая склейка: число дней в SQL не подставляем текстом. SKIP LOCKED: строку, которую
    // в эту секунду правит пользователь, не ждём — заберём следующим проходом.
    const archived = await inBatches(
      client,
      `WITH picked AS (
         SELECT id FROM issues WHERE ${ARCHIVE_WHERE} LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       UPDATE issues i SET archived_at = now() FROM picked WHERE i.id = picked.id`,
      cfg.archiveAfterDays,
      cfg,
    );
    const purged =
      cfg.auditRetentionDays > 0
        ? await inBatches(
            client,
            `DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE ${PURGE_WHERE} LIMIT $2)`,
            cfg.auditRetentionDays,
            cfg,
          )
        : { count: 0, capped: false };
    // Остатки лимитера входа по IP (сам лимитер чистит только «свой» IP при следующей попытке).
    await client.query(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'`);
    return { archived, purged };
  });

  const stats: MaintenanceStats = {
    archived: done.archived.count,
    auditPurged: done.purged.count,
    capped: done.archived.capped || done.purged.capped,
    dryRun: false,
  };
  addMaintenanceWork(stats.archived, stats.auditPurged);
  // След в данных: массовая архивация не должна быть заметна только по пропавшим с доски задачам.
  if (stats.archived > 0 || stats.auditPurged > 0) {
    await audit(opts.actorId ?? null, "maintenance.run", "system", null, {
      archived: stats.archived,
      auditPurged: stats.auditPurged,
      capped: stats.capped,
      trigger: opts.actorId ? "manual" : "schedule",
    });
  }
  return stats;
}

/** Состояние джоба в ЭТОМ процессе (`skipped` — лок в последний тик держал другой процесс). */
export interface JobStatus {
  name: string;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastResult: "success" | "error" | "skipped" | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastDetail: unknown;
  nextRunAt: string | null;
}

const jobStatus = new Map<string, JobStatus>();

function statusOf(name: string, intervalMs = 0): JobStatus {
  let s = jobStatus.get(name);
  if (!s) {
    s = { name, intervalMs, running: false, lastRunAt: null, lastResult: null, lastDurationMs: null, lastError: null, lastDetail: null, nextRunAt: null };
    jobStatus.set(name, s);
  }
  return s;
}

export function getMaintenanceStatus(): { enabled: boolean; jobs: JobStatus[] } {
  return { enabled: loadConfig().maintenance.enabled, jobs: [...jobStatus.values()] };
}

/** Один тик под межпроцессным локом джоба; занято — молча пропустить. Вынесено, чтобы проверять без таймеров. */
export async function runJobLocked(name: string, run: () => Promise<void>): Promise<boolean> {
  const r = await withAdvisoryLock(`taskira:job:${name}`, { wait: false }, run);
  return r.acquired;
}

/** Тик с учётом в метриках и статусе: и по расписанию, и вручную. Возвращает false, если лок держит другой. */
export async function trackedTick(name: string, run: () => Promise<unknown>): Promise<boolean> {
  const st = statusOf(name);
  const t0 = performance.now();
  st.running = true;
  setBackgroundJobRunning(name, true);
  let detail: unknown = null;
  try {
    const acquired = await runJobLocked(name, async () => {
      detail = await run();
    });
    st.lastRunAt = new Date().toISOString();
    if (!acquired) {
      st.lastResult = "skipped";
      recordBackgroundJob(name, "skipped");
      return false;
    }
    const sec = (performance.now() - t0) / 1000;
    st.lastResult = "success";
    st.lastDurationMs = Math.round(sec * 1000);
    st.lastError = null;
    st.lastDetail = detail;
    recordBackgroundJob(name, "success", sec);
    return true;
  } catch (e) {
    const sec = (performance.now() - t0) / 1000;
    st.lastRunAt = new Date().toISOString();
    st.lastResult = "error";
    st.lastDurationMs = Math.round(sec * 1000);
    st.lastError = e instanceof Error ? e.message : String(e);
    recordBackgroundJob(name, "error", sec);
    throw e;
  } finally {
    st.running = false;
    setBackgroundJobRunning(name, false);
  }
}

/**
 * Ручной запуск (админ-эндпоинт). dryRun не меняет данных и лока не берёт; реальный запуск берёт тот же лок
 * джоба, что и расписание, — параллельно с плановым проходом (в этом или другом процессе) он не идёт: 409.
 */
export async function runMaintenanceManual(opts: { dryRun: boolean; actorId: string }): Promise<MaintenanceStats> {
  if (opts.dryRun) return runMaintenanceOnce({ dryRun: true });
  let stats: MaintenanceStats | null = null;
  const acquired = await trackedTick("maintenance", async () => {
    stats = await runMaintenanceOnce({ actorId: opts.actorId });
    return stats;
  });
  if (!acquired || !stats) throw new ApiHttpError(409, "maintenance_busy", "Проход обслуживания уже выполняется");
  return stats;
}

/**
 * Один периодический джоб: реентрантность (тики не перекрываются), setInterval
 * + unref (не держит процесс живым сам по себе), первый прогон через startDelayMs, лог только исключений —
 * успех джоб логирует сам через `run()`, если хочет. stop() гарантированно снимает флаг "выполняется"
 * — без этого второй start() после stop() посреди прогона молча блокировался бы своим же guard'ом навсегда.
 * Каждый тик исполняется одним процессом на кластер (advisory-лок, см. runJobLocked) и попадает в метрики.
 */
function startJob(name: string, intervalMs: number, startDelayMs: number, run: () => Promise<unknown>) {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let startTimer: NodeJS.Timeout | null = null;
  const st = statusOf(name, intervalMs);
  st.intervalMs = intervalMs;
  st.nextRunAt = new Date(Date.now() + startDelayMs).toISOString();

  const tick = (): void => {
    if (running) return;
    running = true;
    void trackedTick(name, run)
      .catch((e) => console.error(`[${name}] проход не удался`, e))
      .finally(() => {
        running = false;
        st.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      });
  };

  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  startTimer = setTimeout(tick, startDelayMs);
  if (typeof startTimer.unref === "function") startTimer.unref();

  return {
    stop(): void {
      if (timer) clearInterval(timer);
      if (startTimer) clearTimeout(startTimer);
      timer = null;
      startTimer = null;
      running = false; // иначе следующий start() бессрочно блокируется собственным guard'ом
    },
  };
}

let jobs: { stop(): void }[] = [];

export function startMaintenance(): void {
  if (jobs.length > 0) return; // уже запущено
  const full = loadConfig();
  const cfg = full.maintenance;
  if (!cfg.enabled) return;

  jobs.push(
    startJob("maintenance", cfg.intervalMs, cfg.startDelayMs, async () => {
      const s = await runMaintenanceOnce();
      if (s.archived > 0 || s.auditPurged > 0)
        console.log(
          `[maintenance] архивировано задач: ${s.archived}, удалено записей аудита: ${s.auditPurged}${
            s.capped ? " (достигнут потолок за проход, остаток — в следующих)" : ""
          }`,
        );
      return s;
    }),
  );

  if (cfg.storageSweepEnabled) {
    jobs.push(
      startJob("storage-sweep", cfg.storageSweepIntervalMs, cfg.startDelayMs + 15_000, async () => {
        const storage = await getStorage(full);
        const s = await runStorageSweepOnce(storage, full.storage.driver, cfg.storageSweepGraceMs);
        if (s.deleted > 0 || s.failed > 0)
          console.log(`[storage-sweep] осиротевших: ${s.orphaned}, удалено: ${s.deleted}, не удалось: ${s.failed}`);
        return s;
      }),
    );
  }

  if (full.authMode === "ldap" && full.ldap?.resyncEnabled && full.ldap.bindDn) {
    jobs.push(
      startJob("ldap-resync", full.ldap.resyncIntervalMs, cfg.startDelayMs + 30_000, async () => {
        const r = await resyncAllLdapUsers(null);
        if (r.synced > 0 || r.notFound.length > 0 || r.errors.length > 0)
          console.log(
            `[ldap-resync] обработано: ${r.total}, синхронизировано: ${r.synced}, не найдено: ${r.notFound.length}, ошибок: ${r.errors.length}`,
          );
        return { total: r.total, synced: r.synced, notFound: r.notFound.length, errors: r.errors.length };
      }),
    );
  }
}

export function stopMaintenance(): void {
  for (const job of jobs) job.stop();
  jobs = [];
  jobStatus.clear();
}
