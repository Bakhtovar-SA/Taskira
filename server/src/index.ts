/** Точка входа: конфиг → миграции → seed → старт HTTP/WS. */
import { loadConfig } from "./config.js";
import { closePool, initPool, migrate } from "./db.js";
import { seedAdmin } from "./seed.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  initPool(cfg.databaseUrl);
  await migrate();
  await seedAdmin();

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
