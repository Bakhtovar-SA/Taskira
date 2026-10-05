import { afterEach, beforeEach, expect, test, vi } from "vitest";

const original = { ...process.env };
const variables = ["WEBHOOKS_ENABLED", "WEBHOOK_ALLOWED_TARGETS", "WEBHOOK_DENY_CIDRS", "WEBHOOK_ALLOW_HTTP", "WEBHOOK_SECRET_KEY", "WEBHOOK_POLL_MS", "WEBHOOK_LOG_RETENTION_DAYS"];
beforeEach(() => { for (const name of variables) process.env[name] = ""; vi.resetModules(); });
afterEach(() => { process.env = { ...original }; vi.resetModules(); });
async function config() { vi.resetModules(); return (await import("../src/config.js")).loadConfig().webhooks; }

test("webhooks are disabled and deny all destinations by default", async () => {
  expect(await config()).toEqual({ enabled: false, allowedTargets: [], denyCidrs: [], allowHttp: false, secretKey: null, pollMs: 2000, logRetentionDays: 30 });
});
test.each(["hex", "base64"] as const)("accepts an exact 32-byte %s key with explicit targets", async encoding => {
  const key = Buffer.alloc(32, 0xa5);
  Object.assign(process.env, { WEBHOOKS_ENABLED: "true", WEBHOOK_ALLOW_HTTP: "true", WEBHOOK_SECRET_KEY: key.toString(encoding), WEBHOOK_ALLOWED_TARGETS: "hooks.corp.local", WEBHOOK_DENY_CIDRS: "172.30.0.0/24,", WEBHOOK_POLL_MS: "500", WEBHOOK_LOG_RETENTION_DAYS: "365" });
  expect(await config()).toMatchObject({ enabled: true, allowHttp: true, secretKey: key, allowedTargets: [{ kind: "host", host: "hooks.corp.local" }], denyCidrs: ["172.30.0.0/24"], pollMs: 500, logRetentionDays: 365 });
});
test("enabled webhooks require a key", async () => {
  process.env.WEBHOOKS_ENABLED = "true";
  await expect(config()).rejects.toThrow("WEBHOOK_SECRET_KEY: ключ обязателен");
});
test.each(["private-invalid-key", "a".repeat(63), "g".repeat(64), Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), "!" + Buffer.alloc(32).toString("base64"), "A".repeat(42) + "B="])("rejects invalid keys even while disabled without echoing the value", async value => {
  process.env.WEBHOOK_SECRET_KEY = value;
  await expect(config()).rejects.toThrow("WEBHOOK_SECRET_KEY: требуется ключ из 32 байт в hex или base64");
});
test.each([["WEBHOOK_ALLOWED_TARGETS", "https://private.example?key=private"], ["WEBHOOK_DENY_CIDRS", "private.example/24"]])("refuses malformed %s at startup", async (name, value) => {
  process.env[name] = value;
  await expect(config()).rejects.toThrow(name + ": неверн");
});
test.each([["WEBHOOK_POLL_MS", "499"], ["WEBHOOK_POLL_MS", "60001"], ["WEBHOOK_POLL_MS", "1000.5"], ["WEBHOOK_POLL_MS", "1e3"], ["WEBHOOK_LOG_RETENTION_DAYS", "2"], ["WEBHOOK_LOG_RETENTION_DAYS", "366"], ["WEBHOOK_LOG_RETENTION_DAYS", "invalid"]])("rejects out-of-range or non-integer %s", async (name, value) => {
  process.env[name] = value;
  await expect(config()).rejects.toThrow(name + ": требуется целое число");
});
test("accepts the opposite poll and retention boundaries", async () => {
  process.env.WEBHOOK_POLL_MS = "60000"; process.env.WEBHOOK_LOG_RETENTION_DAYS = "3";
  expect(await config()).toMatchObject({ pollMs: 60000, logRetentionDays: 3 });
});
