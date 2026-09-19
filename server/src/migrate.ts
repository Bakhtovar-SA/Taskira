/** Одноразовый entrypoint для upgrade.sh: только миграции, без HTTP и seed. */
import { initConfig } from "./config.js";
import { closePool, initPool, migrate } from "./db.js";

const cfg = initConfig();
initPool(cfg.databaseUrl, cfg.pgPoolMax);
try {
  await migrate();
} finally {
  await closePool();
}
