import { afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ recurring: vi.fn(async () => ({ processed: 0 })) }));
vi.mock("../src/services/recurring.js", () => ({ runRecurringWork: mocks.recurring }));
vi.mock("../src/db.js", () => {
  const client = { query: async () => ({ rows: [], rowCount: 0 }) };
  return { q: async () => [], one: async () => null,
    withClient: async (run: (c: unknown) => unknown) => run(client),
    withTransaction: async (run: (c: unknown) => unknown) => run(client),
    withAdvisoryLock: async (_key: string, _options: unknown, run: () => unknown) => ({ acquired: true, value: await run() }),
  };
});
import { initConfig, loadConfig } from "../src/config.js";
import { startMaintenance, stopMaintenance } from "../src/services/maintenance.js";

afterEach(() => { stopMaintenance(); vi.useRealTimers(); });
test("recurring ждёт стартовую задержку +25 секунд, затем свой интервал; stop снимает таймеры", async () => {
  vi.useFakeTimers(); initConfig();
  const cfg = loadConfig();
  Object.assign(cfg.maintenance, { enabled: true, startDelayMs: 10_000, intervalMs: 3_600_000, storageSweepEnabled: false });
  Object.assign(cfg.recurring, { enabled: true, pollMs: 1000 });
  cfg.webhooks.enabled = false;
  startMaintenance();
  await vi.advanceTimersByTimeAsync(34_999); expect(mocks.recurring).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(mocks.recurring).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000); expect(mocks.recurring).toHaveBeenCalledTimes(2);
  stopMaintenance(); await vi.advanceTimersByTimeAsync(5000); expect(mocks.recurring).toHaveBeenCalledTimes(2);
});
