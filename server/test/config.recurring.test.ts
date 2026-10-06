import { afterEach, beforeEach, expect, test, vi } from "vitest";

const original = { ...process.env };
beforeEach(() => {
  process.env.RECURRING_ENABLED = "";
  process.env.RECURRING_POLL_MS = "";
  vi.resetModules();
});
afterEach(() => { process.env = { ...original }; vi.resetModules(); });
const config = async () => (await import("../src/config.js")).loadConfig().recurring;

test("повторение включено с минутным интервалом по умолчанию", async () => {
  expect(await config()).toEqual({ enabled: true, pollMs: 60_000 });
});
test.each(["1000", "86400000"])("выключение и граница интервала %s", async value => {
  process.env.RECURRING_ENABLED = "false";
  process.env.RECURRING_POLL_MS = value;
  expect(await config()).toEqual({ enabled: false, pollMs: Number(value) });
});
test.each(["999", "86400001", "1000.5", "1e3", "invalid"])("неверный интервал %s отклоняется даже при выключении", async value => {
  process.env.RECURRING_ENABLED = "false";
  process.env.RECURRING_POLL_MS = value;
  await expect(config()).rejects.toThrow("RECURRING_POLL_MS: требуется целое число");
});
