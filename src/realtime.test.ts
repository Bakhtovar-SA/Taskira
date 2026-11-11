import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startRealtime, type RealtimeOptions, type SyncBatch } from "./realtime";

class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor() { Socket.instances.push(this); }
  message(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const batch = (cursor: string, ids: string[] = [], reset = false): SyncBatch => ({ type: "sync", projectId: "p1", cursor, issueIds: ids, reset, ts: 1 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
let stop: (() => void) | undefined;
function setup(overrides: Partial<RealtimeOptions> = {}) {
  const options = {
    projectId: "p1", url: "ws://localhost/api/ws", token: () => "token", cursor: null,
    pull: vi.fn(async () => batch("1")), refresh: vi.fn(async () => undefined),
    onCursor: vi.fn(), onNotify: vi.fn(), onDenied: vi.fn(), onUnauthorized: vi.fn(),
    ...overrides,
  };
  stop = startRealtime(options);
  return { options, socket: Socket.instances.at(-1)! };
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("durable project realtime", () => {
  test("auth subscribes with cursor, preserves notification push and coalesces duplicate/out-of-order hints", async () => {
    const pull = vi.fn(async () => batch("5", ["a", "b"]));
    const { options, socket } = setup({ cursor: "2", pull });
    socket.onopen?.(); socket.message({ type: "auth_ok" });
    expect(socket.send.mock.calls.map(([body]) => JSON.parse(body))).toEqual([
      { type: "auth", token: "token" }, { type: "sync:subscribe", projectId: "p1", cursor: "2" },
    ]);
    socket.message(batch("5", ["a"])); socket.message(batch("3", ["b"])); socket.message(batch("5", ["a"]));
    socket.message({ type: "notify" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledWith("2", expect.any(AbortSignal));
    expect(options.refresh).toHaveBeenCalledWith(batch("5", ["a", "b"]), expect.any(AbortSignal));
    expect(options.onCursor).toHaveBeenLastCalledWith("5");
    expect(options.onNotify).toHaveBeenCalledTimes(1);
  });

  test("a failed refresh retains old cursor and retries journal instead of dropping a gap", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const pull = vi.fn<RealtimeOptions["pull"]>(async () => batch("9", ["a"]));
    const { options } = setup({ cursor: "4", pull, refresh });
    await vi.advanceTimersByTimeAsync(100);
    expect(options.onCursor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pull.mock.calls.map(([cursor]) => cursor)).toEqual(["4", "4"]);
    expect(options.onCursor).toHaveBeenCalledWith("9");
  });

  test("returning online bypasses a pending failure backoff and catches up immediately", async () => {
    const pull = vi.fn<RealtimeOptions["pull"]>().mockRejectedValueOnce(new Error("network")).mockResolvedValue(batch("2"));
    const { options } = setup({ cursor: "1", pull });
    await vi.advanceTimersByTimeAsync(100);
    expect(pull).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(options.onCursor).toHaveBeenCalledWith("2");
  });

  test("refresh is single-flight and an event arriving during it schedules another catch-up", async () => {
    const first = deferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const pull = vi.fn().mockResolvedValueOnce(batch("2", ["a"])).mockResolvedValue(batch("3", ["b"]));
    const { options, socket } = setup({ cursor: "1", pull, refresh });
    await vi.advanceTimersByTimeAsync(100);
    socket.message(batch("3", ["b"]));
    await vi.advanceTimersByTimeAsync(500);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(options.onCursor).not.toHaveBeenCalled();
    first.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(pull.mock.calls[1][0]).toBe("2");
    expect(options.onCursor).toHaveBeenLastCalledWith("3");
  });

  test("polling repairs a missed push, including reset after history expiration", async () => {
    const pull = vi.fn().mockResolvedValueOnce(batch("2")).mockResolvedValue(batch("12", [], true));
    const { options } = setup({ cursor: "2", pull });
    await vi.advanceTimersByTimeAsync(100);
    expect(options.refresh).toHaveBeenCalledWith(batch("2"), expect.any(AbortSignal));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(options.refresh).toHaveBeenCalledWith(batch("12", [], true), expect.any(AbortSignal));
    expect(options.onCursor).toHaveBeenLastCalledWith("12");
  });

  test("a journal reset rebases a future cursor after restore; an ordinary stale batch cannot", async () => {
    const pull = vi.fn<RealtimeOptions["pull"]>().mockResolvedValueOnce(batch("2", [], true)).mockResolvedValue(batch("1", ["old"]));
    const { options, socket } = setup({ cursor: "999", pull });
    await vi.advanceTimersByTimeAsync(100);
    expect(options.refresh).toHaveBeenCalledWith(batch("2", [], true), expect.any(AbortSignal));
    expect(options.onCursor).toHaveBeenCalledExactlyOnceWith("2");
    socket.message(batch("1", ["old"]));
    await vi.advanceTimersByTimeAsync(100);
    expect(options.refresh).toHaveBeenCalledTimes(1);
    expect(options.onCursor).toHaveBeenCalledTimes(1);
  });

  test("unauthorized reconciliation stops retries even before the provider unmounts", async () => {
    const pull = vi.fn<RealtimeOptions["pull"]>().mockRejectedValue({ status: 401 });
    const { options, socket } = setup({ pull });
    await vi.advanceTimersByTimeAsync(100);
    expect(options.onUnauthorized).toHaveBeenCalledTimes(1);
    socket.message({ type: "notify" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(options.onNotify).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(1);
  });

  test("reconnect resubscribes using the last successfully applied cursor", async () => {
    const { options, socket } = setup({ pull: vi.fn(async () => batch("17")) });
    await vi.advanceTimersByTimeAsync(100);
    socket.close();
    await vi.advanceTimersByTimeAsync(1_000);
    const next = Socket.instances.at(-1)!;
    next.message({ type: "auth_ok" });
    expect(next.send).toHaveBeenCalledWith(JSON.stringify({ type: "sync:subscribe", projectId: "p1", cursor: "17" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(options.pull).toHaveBeenLastCalledWith("17", expect.any(AbortSignal));
  });

  test("logout/project cleanup aborts pending HTTP and prevents cursor, notification and UI callbacks", async () => {
    const response = deferred<SyncBatch>();
    const { options, socket } = setup({ pull: vi.fn(() => response.promise) });
    await vi.advanceTimersByTimeAsync(100);
    const signal = (options.pull as ReturnType<typeof vi.fn>).mock.calls[0][1] as AbortSignal;
    stop?.(); stop = undefined;
    response.resolve(batch("99", ["private"]));
    socket.message({ type: "notify" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal.aborted).toBe(true);
    expect(options.refresh).not.toHaveBeenCalled();
    expect(options.onCursor).not.toHaveBeenCalled();
    expect(options.onNotify).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(1);
  });

  test("wrong-project events do not refresh; denied membership stops all reconciliation", async () => {
    const { options, socket } = setup({ cursor: "1" });
    await vi.advanceTimersByTimeAsync(100);
    socket.message({ ...batch("2", ["secret"]), projectId: "p2" });
    await vi.advanceTimersByTimeAsync(100);
    expect(options.pull).toHaveBeenCalledTimes(1);
    socket.message({ type: "sync:denied", projectId: "p1" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(options.onDenied).toHaveBeenCalledTimes(1);
    expect(options.pull).toHaveBeenCalledTimes(1);
    expect(Socket.instances).toHaveLength(1);
  });

  test("background polling pauses, visibility/online catch up, and receive watchdog replaces a zombie", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { options, socket } = setup({ cursor: "1" });
    await vi.advanceTimersByTimeAsync(100);
    visibility.mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(80_000);
    expect(options.pull).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(options.pull).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(Socket.instances).toHaveLength(2);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.pull).toHaveBeenCalledTimes(3);
  });
});
