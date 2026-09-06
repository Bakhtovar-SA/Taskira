/** Конфигурация — только из env. Секретов в коде нет и не будет.
 *  При старте подгружаем server/.env в process.env (Node сам файл .env не читает).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpires: string;
  corsOrigin: string[] | "*";
  admin: { username: string; password: string; name: string } | null;
}

function fail(msg: string): never {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

/** Простой парсер KEY=VALUE (без внешних зависимостей). Не перезаписывает уже заданные env. */
function loadDotEnv(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"), // server/src → server/.env
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    console.log(`[config] загружен ${path}`);
    return;
  }
  console.warn("[config] файл .env не найден — используются только системные переменные окружения");
}

let cached: Config | null = null;

/** Загружает конфиг ЕДИНОЖДЫ при старте процесса (index.ts) и кэширует. */
export function initConfig(): Config {
  loadDotEnv();
  cached = buildConfig();
  return cached;
}

/** Возвращает кэшированный конфиг; при отсутствии кэша (тесты, seed) — собирает. */
export function loadConfig(): Config {
  if (!cached) {
    loadDotEnv();
    cached = buildConfig();
  }
  return cached;
}

function buildConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("Не задан DATABASE_URL (например postgresql://user:pass@db:5432/taskira)");

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) fail("JWT_SECRET должен быть не короче 32 символов — см. .env.example");

  const corsRaw = (process.env.CORS_ORIGIN ?? "http://localhost:5173").trim();

  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD;

  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    databaseUrl,
    jwtSecret,
    jwtExpires: process.env.JWT_EXPIRES ?? "12h",
    corsOrigin: corsRaw === "*" ? "*" : corsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    admin:
      adminUser && adminPass
        ? {
            username: adminUser,
            password: adminPass,
            name: process.env.ADMIN_NAME?.trim() || "Администратор",
          }
        : null,
  };
}
