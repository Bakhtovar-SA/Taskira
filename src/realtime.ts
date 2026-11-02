import type { RealtimeSyncMessage } from "../server/src/contract";

/** WebSocket is a low-latency hint; the durable HTTP journal is the source of truth.
 * A cursor is acknowledged only after the corresponding UI refresh succeeds. */
export type SyncBatch = RealtimeSyncMessage;

export interface RealtimeOptions {
  onState?: (state: "connecting" | "live" | "recovering" | "offline") => void;
  projectId: string;
  url: string;
  token: () => string | null;
  cursor?: string | null;
  pull: (cursor: string | null, signal: AbortSignal) => Promise<SyncBatch>;
  refresh: (batch: SyncBatch, signal: AbortSignal) => Promise<void>;
  onCursor: (cursor: string) => void;
  onNotify: () => void;
  onDenied: () => void;
  onUnauthorized: () => void;
}

export function startRealtime(options: RealtimeOptions): () => void {
  let stopped = false;
  let denied = false;
  let cursor = options.cursor ?? null;
  let socket: WebSocket | null = null;
  let authenticated = false;
  let retryDelay = 1_000;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let lastReceived = Date.now();
  let dirty = false;
  let running = false;
  const abort = new AbortController();
  const visible = () => document.visibilityState !== "hidden";
  const active = () => !stopped && !denied;
  const report = (state: "connecting" | "live" | "recovering") => {
    if (active()) options.onState?.(navigator.onLine === false ? "offline" : state);
  };

  const deny = () => {
    if (!active()) return;
    denied = true;
    abort.abort();
    socket?.close();
    options.onDenied();
  };

  const schedule = (delay = 100) => {
    if (!active()) return;
    dirty = true;
    if (running) return;
    if (syncTimer !== undefined) {
      if (delay !== 0) return;
      clearTimeout(syncTimer); // returning online/focus bypasses an old failure backoff
    }
    syncTimer = setTimeout(() => { syncTimer = undefined; void reconcile(); }, delay);
  };

  const reconcile = async () => {
    if (!active() || running) return;
    running = true;
    dirty = false;
    try {
      const batch = await options.pull(cursor, abort.signal);
      if (!active()) return;
      if (batch.type !== "sync" || batch.projectId !== options.projectId || !/^\d+$/.test(batch.cursor)
        || !Array.isArray(batch.issueIds) || typeof batch.reset !== "boolean") throw new Error("Invalid sync response");
      // A delayed/duplicated response cannot roll the acknowledged cursor backwards.
      if (cursor !== null && !batch.reset && BigInt(batch.cursor) < BigInt(cursor)) throw new Error("Stale sync response");
      // Even an empty journal page revalidates the visible queries. Their previous
      // HTTP read may have failed after the cursor was acknowledged.
      await options.refresh(batch, abort.signal);
      if (!active()) return;
      cursor = batch.cursor;
      options.onCursor(cursor);
      failures = 0;
      report(authenticated ? "live" : "recovering");
    } catch (error) {
      if (!active()) return;
      const status = (error as { status?: number })?.status;
      if (status === 403 || status === 404) { deny(); return; }
      if (status === 401) {
        denied = true;
        abort.abort();
        socket?.close();
        options.onUnauthorized();
        return;
      }
      failures++;
      report("recovering");
      dirty = true;
    } finally {
      running = false;
      if (active() && dirty) schedule(failures ? Math.min(1_000 * 2 ** Math.min(failures - 1, 5), 30_000) : 100);
    }
  };

  const connect = () => {
    if (!active()) return;
    let current: WebSocket;
    try { current = new WebSocket(options.url); }
    catch { retry(); return; }
    socket = current;
    lastReceived = Date.now();
    current.onopen = () => {
      if (!active() || current !== socket) return;
      const token = options.token();
      if (token) current.send(JSON.stringify({ type: "auth", token }));
    };
    current.onmessage = (event) => {
      if (!active() || current !== socket) return;
      lastReceived = Date.now();
      try {
        const message = JSON.parse(event.data as string);
        if (message?.type === "auth_ok") {
          authenticated = true;
          retryDelay = 1_000;
          current.send(JSON.stringify({ type: "sync:subscribe", projectId: options.projectId, cursor }));
          schedule(0); // every reconnect repairs the gap, including an empty subscription response
        } else if (message?.type === "notify") options.onNotify();
        else if (message?.projectId === options.projectId) {
          if (message.type === "sync:denied") deny();
          else if (message.type === "sync" || message.type === "sync:error") schedule();
        }
      } catch { /* Ignore unrelated/malformed messages; the safety poll still reconciles. */ }
    };
    current.onerror = () => { if (current === socket) current.close(); };
    current.onclose = () => {
      if (!active() || current !== socket) return;
      socket = null;
      authenticated = false;
      report("recovering");
      retry();
    };
  };
  const retry = () => {
    if (!active() || retryTimer !== undefined) return;
    report("recovering");
    const delay = retryDelay * (0.8 + Math.random() * 0.4);
    retryDelay = Math.min(retryDelay * 2, 30_000);
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, delay);
  };
  const catchUp = () => {
    if (!active() || !visible()) return;
    // A throttled background tab may retain a dead socket until it becomes visible.
    if (socket && Date.now() - lastReceived > 75_000) socket.close();
    schedule(0);
  };
  const offline = () => { if (active()) options.onState?.("offline"); };
  const poll = setInterval(() => {
    if (visible()) catchUp();
  }, 20_000);
  const watchdog = setInterval(() => {
    if (active() && visible() && socket && Date.now() - lastReceived > 75_000) socket.close();
  }, 15_000);
  window.addEventListener("focus", catchUp);
  window.addEventListener("online", catchUp);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", catchUp);
  report("connecting");
  connect();
  schedule();

  return () => {
    stopped = true;
    abort.abort();
    clearTimeout(retryTimer);
    clearTimeout(syncTimer);
    clearInterval(poll);
    clearInterval(watchdog);
    window.removeEventListener("focus", catchUp);
    window.removeEventListener("online", catchUp);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", catchUp);
    socket?.close();
    socket = null;
  };
}
