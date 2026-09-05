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

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("Не задан DATABASE_URL (например postgresql://user:pass@db:5432/taskira)");

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) fail("JWT_SECRET должен быть не короче 32 символов — см. .env.example");

  const corsRaw = (process.env.CORS_ORIGIN ?? "*").trim();

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
