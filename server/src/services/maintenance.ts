/** Фоновое обслуживание (аудит LIFE-03 / PERF-05).
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
 *  runMaintenanceOnce() в тестах архивации. Первый прогон каждого — сразу на
 *  старте (не ждать полный интервал), но со сдвигом друг относительно друга
 *  (startDelayMs), чтобы деплой/рестарт не запускал листинг всего Storage,
 *  полный обход LDAP-каталога и архивный проход одним залпом в одну и ту же
 *  секунду.
 *
 *  Все три стартуют вместе, но независимо, а не второй проход в notifier:
 *  тот стартует только при включённом email (NOTIFY_EMAIL_ENABLED), а архив
 *  нужен всегда. Как и notifier, при нескольких инстансах включать ровно на
 *  одном (MAINTENANCE_ENABLED=false на остальных).
 */
import { q, withAdvisoryLock } from "../db.js";
import { loadConfig } from "../config.js";
import { getStorage } from "./storage.js";
import { runStorageSweepOnce } from "./storageSweeper.js";
import { resyncAllLdapUsers } from "./departmentSync.js";

export interface MaintenanceStats {
  archived: number;
  auditPurged: number;
}

/** Один проход архив + audit_log. Экспортируется для тестов и ручного прогона. */
export async function runMaintenanceOnce(): Promise<MaintenanceStats> {
  const cfg = loadConfig().maintenance;

  // make_interval, а не строковая склейка: число дней в SQL не подставляем текстом.
  const archivedRows = await q<{ id: string }>(
    `UPDATE issues
        SET archived_at = now()
      WHERE done_at IS NOT NULL
        AND archived_at IS NULL
        AND done_at < now() - make_interval(days => $1::int)
      RETURNING id`,
    [cfg.archiveAfterDays],
  );

  let auditPurged = 0;
  if (cfg.auditRetentionDays > 0) {
    const purged = await q<{ id: string }>(
      `DELETE FROM audit_log
        WHERE created_at < now() - make_interval(days => $1::int)
        RETURNING id`,
      [cfg.auditRetentionDays],
    );
    auditPurged = purged.length;
  }

  // Остатки лимитера входа по IP (сам лимитер чистит только «свой» IP при следующей попытке).
  await q(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'`);

  return { archived: archivedRows.length, auditPurged };
}

/**
 * Один периодический джоб: реентрантность (тики не перекрываются), setInterval
 * + unref (не держит процесс живым сам по себе), первый прогон сразу (со
 * сдвигом startDelayMs), лог только исключений — успех джоб логирует сам
 * через `run()`, если хочет. stop() гарантированно снимает флаг "выполняется"
 * — без этого второй start() после stop() посреди прогона молча блокировался
 * бы своим же guard'ом навсегда, ни разу не выполнившись.
 */
/** Один тик под межпроцессным локом джоба; занято — молча пропустить. Вынесено, чтобы проверять без таймеров. */
export async function runJobLocked(name: string, run: () => Promise<void>): Promise<boolean> {
  const r = await withAdvisoryLock(`taskira:job:${name}`, { wait: false }, run);
  return r.acquired;
}

function startJob(name: string, intervalMs: number, startDelayMs: number, run: () => Promise<void>) {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let startTimer: NodeJS.Timeout | null = null;

  const tick = (): void => {
    if (running) return;
    running = true;
    // Межпроцессный лидер: каждый джоб исполняется одним процессом за тик (второй экземпляр на той же БД
    // пропускает тик). Иначе архив/уборка делались бы дважды, а LDAP-ресинк — двумя полными обходами каталога.
    void runJobLocked(name, run)
      .catch((e) => console.error(`[${name}] проход не удался`, e))
      .finally(() => {
        running = false;
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
    startJob("maintenance", cfg.intervalMs, 0, async () => {
      const s = await runMaintenanceOnce();
      if (s.archived > 0 || s.auditPurged > 0)
        console.log(`[maintenance] архивировано задач: ${s.archived}, удалено записей аудита: ${s.auditPurged}`);
    }),
  );

  if (cfg.storageSweepEnabled) {
    jobs.push(
      startJob("storage-sweep", cfg.storageSweepIntervalMs, 15_000, async () => {
        const storage = await getStorage(full);
        const s = await runStorageSweepOnce(storage, full.storage.driver, cfg.storageSweepGraceMs);
        if (s.deleted > 0 || s.failed > 0)
          console.log(`[storage-sweep] осиротевших: ${s.orphaned}, удалено: ${s.deleted}, не удалось: ${s.failed}`);
      }),
    );
  }

  if (full.authMode === "ldap" && full.ldap?.resyncEnabled && full.ldap.bindDn) {
    jobs.push(
      startJob("ldap-resync", full.ldap.resyncIntervalMs, 30_000, async () => {
        const r = await resyncAllLdapUsers(null);
        if (r.synced > 0 || r.notFound.length > 0 || r.errors.length > 0)
          console.log(
            `[ldap-resync] обработано: ${r.total}, синхронизировано: ${r.synced}, не найдено: ${r.notFound.length}, ошибок: ${r.errors.length}`,
          );
      }),
    );
  }
}

export function stopMaintenance(): void {
  for (const job of jobs) job.stop();
  jobs = [];
}
