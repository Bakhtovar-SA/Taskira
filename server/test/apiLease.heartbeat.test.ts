import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";

const { construct } = vi.hoisted(() => ({ construct: vi.fn() }));
vi.mock("pg", () => ({ default: { Client: construct } }));
import { acquireApiLease } from "../src/services/apiLease.js";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function fixture(outcomes: boolean[]) {
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => undefined), end: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string) => {
      if (sql === "SELECT 1" && outcomes.shift() === false) throw new Error("query timeout");
      return { rows: [{ ok: true }] };
    }),
  });
  construct.mockImplementation(function () { return client; });
  return client;
}

test("heartbeat tolerates two timeouts and resets failure count on success", async () => {
  vi.useFakeTimers();
  fixture([false, false, true, false, false, false]);
  const lost = vi.fn();
  const release = await acquireApiLease("postgres://unused", lost, 100);
  try {
    await vi.advanceTimersByTimeAsync(300);
    expect(lost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(lost).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(lost).toHaveBeenCalledOnce();
  } finally { await release(); }
});

test("a real connection error stops ownership immediately and only once", async () => {
  vi.useFakeTimers();
  const client = fixture([]);
  const lost = vi.fn();
  const release = await acquireApiLease("postgres://unused", lost, 100);
  client.emit("error", new Error("connection lost"));
  client.emit("end");
  expect(lost).toHaveBeenCalledOnce();
  await release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.query).toHaveBeenCalledTimes(1);
});
