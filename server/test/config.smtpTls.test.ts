/** SMTP_TLS_REJECT_UNAUTHORIZED → NotifyConfig.smtp.tlsRejectUnauthorized (SMTP TLS fix).
 *  По умолчанию true (secure default); false — принять самоподписанный сертификат
 *  relay в закрытом контуре без доверенного CA. Каждый кейс грузит config.ts свежим
 *  модулем (vi.resetModules), т.к. loadConfig() кэширует Config на модуль-скоуп
 *  переменной и не пересобрал бы её при повторном импорте. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/taskira_test",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  NOTIFY_EMAIL_ENABLED: "true",
  APP_BASE_URL: "https://taskira.test",
  SMTP_HOST: "smtp.test.local",
  SMTP_PORT: "25",
  SMTP_FROM: "Taskira <noreply@taskira.test>",
};

const ENV_KEYS = [...Object.keys(REQUIRED_ENV), "SMTP_TLS_REJECT_UNAUTHORIZED"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function freshLoadConfig() {
  vi.resetModules();
  const mod = await import("../src/config.js");
  return mod.loadConfig();
}

describe("SMTP_TLS_REJECT_UNAUTHORIZED", () => {
  test("не задан → tlsRejectUnauthorized=true (безопасный дефолт)", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.SMTP_TLS_REJECT_UNAUTHORIZED;
    const cfg = await freshLoadConfig();
    expect(cfg.notify.smtp?.tlsRejectUnauthorized).toBe(true);
  });

  test("=false → tlsRejectUnauthorized=false (самоподписанный сертификат relay)", async () => {
    Object.assign(process.env, REQUIRED_ENV, { SMTP_TLS_REJECT_UNAUTHORIZED: "false" });
    const cfg = await freshLoadConfig();
    expect(cfg.notify.smtp?.tlsRejectUnauthorized).toBe(false);
  });

  test("=true → tlsRejectUnauthorized=true (явно)", async () => {
    Object.assign(process.env, REQUIRED_ENV, { SMTP_TLS_REJECT_UNAUTHORIZED: "true" });
    const cfg = await freshLoadConfig();
    expect(cfg.notify.smtp?.tlsRejectUnauthorized).toBe(true);
  });
});
