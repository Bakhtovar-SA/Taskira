import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { afterEach, expect, test, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../src/db.js", () => ({ acquireClient: connect }));
vi.mock("../src/audit.js", () => ({ audit: vi.fn() }));
vi.mock("../src/middleware.js", () => ({ requireGlobalAdmin: vi.fn() }));
import { dataExportRoutes } from "../src/routes/dataExport.js";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

async function fixture(drain = true) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (_sql: string) => ({ rows: [] })), release: vi.fn(),
  });
  connect.mockResolvedValue(client);
  let handler!: RouteHandlerMethod;
  const app = { get: (_path: string, _options: unknown, fn: RouteHandlerMethod) => { handler = fn; } } as unknown as FastifyInstance;
  await dataExportRoutes(app);
  const raw = new EventEmitter();
  const send = vi.fn((stream: Readable) => { if (drain) stream.resume(); });
  const reply = { raw, type: vi.fn(), header: vi.fn(), send } as unknown as FastifyReply;
  const request = { user: { sub: "admin" } } as unknown as FastifyRequest;
  return { client, raw, send, run: () => handler.call(app, request, reply) };
}

test("export applies database limits before pinning its snapshot and releases after rollback", async () => {
  const f = await fixture();
  await f.run();
  const sql = f.client.query.mock.calls.map(([text]) => text);
  expect(sql.slice(0, 4)).toEqual([
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL statement_timeout = '30s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'", "SELECT 1 FROM instance LIMIT 1",
  ]);
  expect(sql.at(-1)).toBe("ROLLBACK");
  expect(f.client.release).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.client.listenerCount("error")).toBe(0);
  expect(f.raw.listenerCount("close")).toBe(0);
});

test("failed rollback preserves the original error and evicts the broken connection", async () => {
  const f = await fixture();
  const original = new Error("snapshot query failed");
  f.client.query.mockImplementation(async (sql) => {
    if (sql === "SELECT 1 FROM instance LIMIT 1") throw original;
    if (sql === "ROLLBACK") throw new Error("connection already closed");
    return { rows: [] };
  });
  await expect(f.run()).rejects.toBe(original);
  expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
});

test("a stalled download is destroyed after five minutes and releases its snapshot", async () => {
  vi.useFakeTimers();
  const f = await fixture(false);
  const result = expect(f.run()).rejects.toThrow("exceeded its time limit");
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  await result;
  expect(f.send.mock.calls[0][0].destroyed).toBe(true);
  expect(f.client.query).toHaveBeenLastCalledWith("ROLLBACK");
  expect(f.client.release).toHaveBeenCalledExactlyOnceWith(false);
});

test("connection loss while download is paused aborts the stream and evicts the client", async () => {
  const f = await fixture(false);
  const original = new Error("idle transaction terminated");
  const result = expect(f.run()).rejects.toBe(original);
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  f.client.emit("error", original);
  await result;
  expect(f.send.mock.calls[0][0].destroyed).toBe(true);
  expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
});

test("client disconnect aborts a paused download and releases the healthy connection", async () => {
  const f = await fixture(false);
  const result = f.run();
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  f.raw.emit("close");
  await result;
  expect(f.send.mock.calls[0][0].destroyed).toBe(true);
  expect(f.client.query).toHaveBeenLastCalledWith("ROLLBACK");
  expect(f.client.release).toHaveBeenCalledExactlyOnceWith(false);
});
