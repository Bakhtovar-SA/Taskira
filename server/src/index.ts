/** Точка входа: конфиг → миграции → seed → старт HTTP/WS. */
import { initConfig } from "./config.js";
import { closePool, initPool, migrate } from "./db.js";
import { seedAdmin } from "./seed.js";
import { seedProject } from "./seedProject.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const cfg = initConfig(); // конфиг загружается один раз и кэшируется (fix 3a)
  initPool(cfg.databaseUrl);
  await migrate();
  await seedAdmin();
  await seedProject(); // проект CORP + дефолтный workflow (идемпотентно)

  const app = buildApp();
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(`[taskira] API слушает http://${cfg.host}:${cfg.port}`);

  const shutdown = async (sig: string) => {
    console.log(`[taskira] получен ${sig}, останавливаемся…`);
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
