/** Точка входа: конфиг → миграции → seed → старт HTTP/WS. */
import { initConfig } from "./config.js";
import { closePool, initPool, migrate } from "./db.js";
import { runStartupSeeds } from "./seedStartup.js";
import { buildApp } from "./app.js";
import { startNotifier, stopNotifier } from "./services/notifier.js";
import { startMaintenance, stopMaintenance } from "./services/maintenance.js";
import { startLicenseCheck, stopLicenseCheck } from "./services/license.js";
import { acquireApiLease } from "./services/apiLease.js";
import { closeWithDeadline } from "./services/shutdown.js";

async function main(): Promise<void> {
  const cfg = initConfig(); // конфиг загружается один раз и кэшируется (fix 3a)
  let shutdownOnLeaseLoss: (() => void) | undefined;
  const releaseApiLease = await acquireApiLease(cfg.databaseUrl, () => {
    console.error("[taskira] API ownership connection lost; stopping to preserve single-process session revocation");
    if (shutdownOnLeaseLoss) shutdownOnLeaseLoss();
    else process.exit(1); // Startup has no serving HTTP requests to drain yet.
  });
  initPool(cfg.databaseUrl, cfg.pgPoolMax, cfg.pgPoolIdleTimeoutMs);
  await migrate();
  await runStartupSeeds(); // первый админ + проект CORP с workflow + instance (ТЗ 4.1); под блокировкой (см. seedStartup.ts)

  const app = buildApp();
  let stopping = false;
  const shutdown = async (sig: string, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    console.log(`[taskira] получен ${sig}, останавливаемся…`);
    stopNotifier();
    stopMaintenance();
    stopLicenseCheck();
    try {
      await closeWithDeadline(async () => {
        await app.close();
        await closePool();
        await releaseApiLease();
      });
      process.exit(exitCode);
    } catch (error) {
      console.error("[taskira] shutdown failed; exiting to release API ownership:", error);
      process.exit(1); // OS closes the lease connection, even if WS/pool cleanup stalled.
    }
  };
  shutdownOnLeaseLoss = () => void shutdown("API ownership lost", 1);
  await app.listen({ port: cfg.port, host: cfg.host });
  if (stopping) return;
  console.log(`[taskira] сервер запущен, версия ${cfg.version}`);
  if (cfg.notify.emailEnabled && cfg.notify.workerEnabled) startNotifier();
  startMaintenance();
  startLicenseCheck();
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[taskira] фатальная ошибка при запуске:", e);
  process.exit(1);
});
