/** Создание первого администратора из env (если таблица users пуста). Идемпотентно. */
import bcrypt from "bcryptjs";
import { loadConfig } from "./config.js";
import { one, q } from "./db.js";

export async function seedAdmin(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.admin) {
    console.log("[seed] ADMIN_USERNAME/ADMIN_PASSWORD не заданы — пропускаем создание администратора");
    return;
  }
  const existing = await one<{ n: string }>(`SELECT count(*)::text AS n FROM users`);
  if (existing && Number(existing.n) > 0) {
    console.log("[seed] пользователи уже есть — первый администратор не создаётся");
    return;
  }
  const hash = await bcrypt.hash(cfg.admin.password, 10);
  const initials = cfg.admin.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "АД";
  await q(
    `INSERT INTO users (username, password_hash, name, initials, color, job_role, access_role)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin')`,
    [cfg.admin.username, hash, cfg.admin.name, initials, "#B42318", "администратор"],
  );
  console.log(`[seed] создан первый администратор: ${cfg.admin.username}`);
}

/* Запуск как скрипт: npm run seed */
const isMain = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isMain) {
  const { initPool, migrate, closePool } = await import("./db.js");
  const { seedProject } = await import("./seedProject.js");
  initPool(loadConfig().databaseUrl);
  await migrate();
  await seedAdmin();
  await seedProject();
  await closePool();
}
