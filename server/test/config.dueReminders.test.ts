import { afterEach, expect, test, vi } from "vitest";
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; vi.restoreAllMocks(); vi.resetModules(); });
async function config() {
  vi.resetModules(); return (await import("../src/config.js")).loadConfig();
}
test("default reminder clock is 09:00 Dushanbe and can be configured or disabled", async () => {
  delete process.env.DUE_REMINDER_ENABLED; delete process.env.DUE_REMINDER_TIMEZONE; delete process.env.DUE_REMINDER_HOUR;
  expect((await config()).reminders).toEqual({ enabled: true, timeZone: "Asia/Dushanbe", hour: 9 });
  Object.assign(process.env, { DUE_REMINDER_ENABLED: "false", DUE_REMINDER_TIMEZONE: "America/New_York", DUE_REMINDER_HOUR: "15" });
  expect((await config()).reminders).toEqual({ enabled: false, timeZone: "America/New_York", hour: 15 });
});
test.each(["-1", "24", "9.5", "invalid"])("invalid hour %s fails startup clearly", async value => {
  process.env.DUE_REMINDER_HOUR = value;
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup refused"); });
  await expect(config()).rejects.toThrow("startup refused");
});
test("unknown timezone fails startup clearly", async () => {
  process.env.DUE_REMINDER_TIMEZONE = "Invalid/Timezone";
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup refused"); });
  await expect(config()).rejects.toThrow("startup refused");
});
