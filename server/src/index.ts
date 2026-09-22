/** Точка входа: конфиг → миграции → seed → старт HTTP/WS. */
import { initConfig } from "./config.js";
import { closePool, initPool, migrate } from "./db.js";
import { runStartupSeeds } from "./seedStartup.js";
import { buildApp } from "./app.js";
import { startNotifier, stopNotifier } from "./services/notifier.js";
import { startMaintenance, stopMaintenance } from "./services/maintenance.js";

async function main(): Promise<void> {
  const cfg = initConfig(); // конфиг загружается один раз и кэшируется (fix 3a)
  initPool(cfg.databaseUrl, cfg.pgPoolMax, cfg.pgPoolIdleTimeoutMs);
  await migrate();
  await runStartupSeeds(); // первый админ + проект CORP с workflow + instance (ТЗ 4.1); под блокировкой (см. seedStartup.ts)

  const app = buildApp();
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(`[taskira] сервер запущен, версия ${cfg.version}`);

  // Фоновый воркер email-уведомлений — только если email включён и воркер разрешён
  // в этом процессе (NOTIFICATIONS_MIGRATION.md D4). In-app работает без него.
  if (cfg.notify.emailEnabled && cfg.notify.workerEnabled) startNotifier();

  // Обслуживание (автоархив закрытых задач, уборка аудита) — независимо от email.
  startMaintenance();

  const shutdown = async (sig: string) => {
    console.log(`[taskira] получен ${sig}, останавливаемся…`);
    stopNotifier();
    stopMaintenance();
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[taskira] фатальная ошибка при запуске:", e);
  process.exit(1);
});
