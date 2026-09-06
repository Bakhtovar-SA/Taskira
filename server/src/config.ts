/** Конфигурация — только из env. Секретов в коде нет и не будет. */

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

let cached: Config | null = null;

/** Загружает конфиг ЕДИНОЖДЫ при старте процесса (index.ts) и кэширует. */
export function initConfig(): Config {
  cached = buildConfig();
  return cached;
}

/** Возвращает кэшированный конфиг; при отсутствии кэша (тесты, seed) — собирает. */
export function loadConfig(): Config {
  return cached ?? (cached = buildConfig());
}

function buildConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("Не задан DATABASE_URL (например postgresql://user:pass@db:5432/taskira)");

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) fail("JWT_SECRET должен быть не короче 32 символов — см. .env.example");

  // По умолчанию — только локальный фронтенд. Явное «*» поддерживается, но не подразумевается.
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
    admin: adminUser && adminPass ? { username: adminUser, password: adminPass, name: process.env.ADMIN_NAME?.trim() || "Администратор" } : null,
  };
}
