/** Фоновое обслуживание (аудит LIFE-03 / PERF-05).
 *
 *  Два независимых лупа:
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
 *      полный листинг бакета/каталога дороже одного UPDATE). Отдельный таймер,
 *      а не третья ветка в том же тике: разная стоимость и каданс, и сборщик
 *      не должен запускаться на каждый прогон runMaintenanceOnce() в тестах.
 *
 *  Оба лупа стартуют вместе, но независимо, а не второй проход в notifier:
 *  тот стартует только при включённом email (NOTIFY_EMAIL_ENABLED), а архив
 *  нужен всегда. Как и notifier, при нескольких инстансах включать ровно на
 *  одном (MAINTENANCE_ENABLED=false на остальных).
 */
import { q } from "../db.js";
import { loadConfig } from "../config.js";
import { makeStorage } from "./storage.js";
import { runStorageSweepOnce } from "./storageSweeper.js";

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

  return { archived: archivedRows.length, auditPurged };
}

let timer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let running = false;
let sweeping = false;

export function startMaintenance(): void {
  const cfg = loadConfig().maintenance;
  if (!cfg.enabled) return;

  if (!timer) {
    const tick = (): void => {
      if (running) return; // тики не перекрываются
      running = true;
      void runMaintenanceOnce()
        .then((s) => {
          if (s.archived > 0 || s.auditPurged > 0)
            console.log(`[maintenance] архивировано задач: ${s.archived}, удалено записей аудита: ${s.auditPurged}`);
        })
        .catch((e) => console.error("[maintenance] проход не удался", e))
        .finally(() => {
          running = false;
        });
    };

    timer = setInterval(tick, cfg.intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    tick(); // первый проход сразу на старте, не через час
  }

  if (!sweepTimer && cfg.storageSweepEnabled) {
    const sweepTick = (): void => {
      if (sweeping) return;
      sweeping = true;
      void makeStorage(loadConfig())
        .then((storage) => runStorageSweepOnce(storage, loadConfig().storage.driver, cfg.storageSweepGraceMs))
        .catch((e) => {
          console.error("[storage-sweep] проход не удался", e);
          return null;
        })
        .finally(() => {
          sweeping = false;
        });
    };

    sweepTimer = setInterval(sweepTick, cfg.storageSweepIntervalMs);
    if (typeof sweepTimer.unref === "function") sweepTimer.unref();
    sweepTick(); // первый проход сразу на старте, не через сутки
  }
}

export function stopMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
