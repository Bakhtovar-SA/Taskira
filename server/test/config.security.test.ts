import { afterEach, describe, expect, test, vi } from "vitest";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function expectConfigFailure(password: string | undefined): Promise<void> {
  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.JWT_SECRET = "config-security-test-secret-000000000000000";
  process.env.ADMIN_USERNAME = "admin";
  if (password === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code}`);
  }) as never);
  const { initConfig } = await import("../src/config.js");
  expect(() => initConfig()).toThrow("process.exit:1");
}

describe("startup credential guard", () => {
  test("refuses to start without ADMIN_PASSWORD", async () => {
    await expectConfigFailure(undefined);
  });

  test("refuses to start with a known default", async () => {
    await expectConfigFailure("admin");
  });
});
