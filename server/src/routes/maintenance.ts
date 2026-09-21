/** Управление фоновым обслуживанием (MAINT-01): статус и ручной запуск, только глобальный админ. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { requireGlobalAdmin, zquery } from "../middleware.js";
import { getMaintenanceStatus, runMaintenanceManual } from "../services/maintenance.js";

// dryRun обязателен и без значения по умолчанию: реальный запуск — осознанное действие, а не пропущенный параметр.
const RunQuery = z.object({ dryRun: z.enum(["true", "false"]) });

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  /** Состояние джобов В ЭТОМ процессе и действующие настройки. При нескольких инстансах лидер тика — тот, у кого
   *  lastResult != "skipped"; сводка по кластеру — в /metrics каждого процесса. */
  app.get("/", { preHandler: requireGlobalAdmin }, async () => {
    const cfg = loadConfig().maintenance;
    return {
      ...getMaintenanceStatus(),
      settings: {
        intervalMs: cfg.intervalMs,
        startDelayMs: cfg.startDelayMs,
        batchSize: cfg.batchSize,
        batchPauseMs: cfg.batchPauseMs,
        maxPerRun: cfg.maxPerRun,
        archiveAfterDays: cfg.archiveAfterDays,
        auditRetentionDays: cfg.auditRetentionDays,
      },
    };
  });

  /** `?dryRun=true` — сколько задач будет архивировано и записей аудита удалено, без изменений. `?dryRun=false` —
   *  выполнить проход сейчас (тот же лок, что у расписания; 409, если проход уже идёт). */
  app.post("/run", { preHandler: requireGlobalAdmin, preValidation: zquery(RunQuery) }, async (req) => {
    const { dryRun } = RunQuery.parse(req.query);
    return runMaintenanceManual({ dryRun: dryRun === "true", actorId: req.user.sub });
  });
}
