/** Фоновое обслуживание (аудит LIFE-03 / PERF-05).
 *
 *  Два прохода, оба идемпотентные и безопасные для повторного запуска:
 *   1) автоархив — задачам с done_at старше config.maintenance.archiveAfterDays
 *      проставляется archived_at. Это НЕ удаление: строка остаётся, задача
 *      открывается по прямой ссылке, ищется (?archived=all) и участвует в
 *      отчётах. Она лишь уходит из активного набора проекта, чтобы доска и
 *      «Список задач» не росли бесконечно.
 *   2) уборка audit_log — строки старше auditRetentionDays удаляются
 *      (0 = хранить вечно).
 *
 *  Отдельный луп, а не второй проход в notifier: тот стартует только при
 *  включённом email (NOTIFY_EMAIL_ENABLED), а архив нужен всегда.
 *  Как и notifier, при нескольких инстансах включать ровно на одном
 *  (MAINTENANCE_ENABLED=false на остальных).
 */
import { q } from "../db.js";
import { loadConfig } from "../config.js";

export interface MaintenanceStats {
  archived: number;
  auditPurged: number;
}

/** Один проход. Экспортируется для тестов и ручного прогона. */
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
let running = false;

export function startMaintenance(): void {
  const cfg = loadConfig().maintenance;
  if (!cfg.enabled || timer) return;

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

export function stopMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
