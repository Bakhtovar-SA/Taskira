/** Cookie/legacy-token authentication, notifications and a durable project feed. */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { JwtPayload } from "../middleware.js";
import { assertFreshUser } from "../middleware.js";
import type { RealtimeSyncMessage, WsMessage } from "../contract.js";
import { registerSocket, revokedSince, unregisterSocket } from "../services/wsHub.js";
import { isRealtimeCursor, materializeRealtimeChanges, readRealtimeChanges, realtimeAccess } from "../services/realtime.js";
import { requestToken } from "../sessionCookie.js";

const AUTH_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_BUFFER_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Subscription { projectId: string; cursor: string | null; initial: boolean; errorSent: boolean }
interface Connection {
  socket: WebSocket;
  userId: string | null;
  sessionVersion: number | undefined;
  generation: number;
  subscription: Subscription | null;
  alive: boolean;
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  const connections = new Set<Connection>();
  let closed = false;
  let polling: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;

  const send = (connection: Connection, message: WsMessage): boolean => {
    const socket = connection.socket;
    if (closed || socket.readyState !== socket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFER_BYTES) {
      // Resume from the last applied cursor after reconnecting; never enqueue
      // unlimited frames behind a stalled browser or saturated network.
      socket.close(1013, "slow consumer; reconnect to resume");
      return false;
    }
    try { socket.send(JSON.stringify(message)); return true; }
    catch { socket.terminate(); return false; }
  };

  const updatePolling = () => {
    const active = [...connections].some(c => c.subscription !== null);
    if (active && !polling && !closed) {
      polling = setInterval(kick, POLL_INTERVAL_MS);
      polling.unref();
    } else if (!active && polling) {
      clearInterval(polling);
      polling = null;
    }
  };

  const processTick = async () => {
    const entries = [...connections].filter(c => c.userId && c.subscription);
    if (closed || entries.length === 0) return;
    const current = (connection: Connection, subscription: Subscription, generation: number) =>
      !closed && connections.has(connection) && connection.socket.readyState === connection.socket.OPEN &&
      connection.generation === generation && connection.subscription === subscription;
    const reportError = (connection: Connection, subscription: Subscription, generation: number) => {
      if (current(connection, subscription, generation) && !subscription.errorSent) {
        subscription.errorSent = true;
        send(connection, { type: "sync:error", projectId: subscription.projectId, ts: Date.now() });
      }
    };
    try { await materializeRealtimeChanges(); }
    catch (error) {
      app.log.error({ err: error }, "realtime dispatcher failed");
      for (const connection of entries) {
        if (connection.subscription) reportError(connection, connection.subscription, connection.generation);
      }
      return;
    }

    // Tabs commonly share a cursor. Read each distinct cursor once per tick;
    // recheck the recipient's fresh access immediately before every delivery.
    const changes = new Map<string, Promise<RealtimeSyncMessage>>();
    const deliver = async (connection: Connection) => {
      const subscription = connection.subscription;
      const generation = connection.generation;
      if (!subscription || !connection.userId) return;
      try {
        const key = `${subscription.projectId}:${subscription.cursor ?? "initial"}`;
        let read = changes.get(key);
        if (!read) {
          read = readRealtimeChanges(subscription.projectId, subscription.cursor, { materialize: false });
          changes.set(key, read);
        }
        const message = await read;
        if (!current(connection, subscription, generation)) return;
        const access = await realtimeAccess(connection.userId, connection.sessionVersion, subscription.projectId);
        if (!current(connection, subscription, generation)) return;
        if (access === "expired") {
          connection.socket.close(1008, "session revoked");
          return;
        }
        if (access === "denied") {
          connection.subscription = null;
          connection.generation++;
          send(connection, { type: "sync:denied", projectId: subscription.projectId, ts: Date.now() });
          return;
        }
        subscription.errorSent = false;
        if (subscription.initial || message.reset || message.issueIds.length > 0) {
          if (!send(connection, message)) return;
        }
        subscription.initial = false;
        subscription.cursor = message.cursor;
      } catch (error) {
        app.log.error({ err: error }, "realtime subscription failed");
        reportError(connection, subscription, generation);
      }
    };
    // Leave pool connections available for ordinary API requests and writes.
    for (let index = 0; index < entries.length; index += 4) {
      if (closed) break;
      await Promise.all(entries.slice(index, index + 4).map(deliver));
    }
    updatePolling();
  };

  function kick() {
    if (closed || running) return;
    running = processTick().catch(error => {
      app.log.error({ err: error }, "realtime tick failed");
    }).finally(() => { running = null; });
  }

  const heartbeat = setInterval(() => {
    for (const connection of connections) {
      const { socket, userId } = connection;
      if (socket.readyState !== socket.OPEN) continue;
      if (!connection.alive || socket.bufferedAmount > MAX_BUFFER_BYTES) {
        socket.terminate();
        continue;
      }
      connection.alive = false;
      try { socket.ping(); } catch { socket.terminate(); continue; }
      if (userId) {
        // Notification-only sockets also detect revocation by another replica.
        void realtimeAccess(userId, connection.sessionVersion, null).then(access => {
          if (!connections.has(connection)) return;
          if (access === "expired") socket.close(1008, "session revoked");
          else send(connection, { type: "heartbeat", ts: Date.now() });
        }).catch(error => {
          app.log.error({ err: error }, "realtime heartbeat failed");
          socket.close(1013, "session check unavailable");
        });
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  app.addHook("onClose", async () => {
    closed = true;
    clearInterval(heartbeat);
    if (polling) clearInterval(polling);
    for (const connection of connections) connection.socket.terminate();
    await running;
  });

  app.get("/ws", { websocket: true }, (socket, req) => {
    const connection: Connection = {
      socket, userId: null, sessionVersion: undefined, generation: 0, subscription: null, alive: true,
    };
    connections.add(connection);
    // The synchronous latch prevents a second auth token replacing the first
    // while its asynchronous session check is still in progress.
    let authStarted = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    const authTimer = setTimeout(() => {
      if (!connection.userId) socket.close(1008, "auth timeout");
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    const authenticate = (token: string) => {
      if (authStarted) return;
      authStarted = true;
      const handshakeStartedAt = Date.now();
      void (async () => {
        try {
          const payload = app.jwt.verify<JwtPayload>(token);
          await assertFreshUser(payload.sub, payload.sessionVersion);
          if (await realtimeAccess(payload.sub, payload.sessionVersion, null) !== "allowed") {
            socket.close(1008, "auth failed");
            return;
          }
          if (socket.readyState !== socket.OPEN || !connections.has(connection)) return;
          connection.userId = payload.sub;
          connection.sessionVersion = payload.sessionVersion;
          clearTimeout(authTimer);
          registerSocket(payload.sub, socket);
          if (typeof payload.exp === "number") {
            const remaining = payload.exp * 1000 - Date.now();
            if (remaining <= 0) { socket.close(1008, "token expired"); return; }
            expiryTimer = setTimeout(() => socket.close(1008, "token expired"), remaining);
            expiryTimer.unref();
          }
          // No await here: logout during the handshake cannot leave a live
          // socket that was registered just after closeUserSockets ran.
          if (revokedSince(payload.sub, handshakeStartedAt)) {
            unregisterSocket(payload.sub, socket);
            socket.close(1008, "revoked during handshake");
            return;
          }
          send(connection, { type: "auth_ok", ts: Date.now() });
        } catch { socket.close(1008, "auth failed"); }
      })();
    };

    socket.on("pong", () => { connection.alive = true; });
    socket.on("message", (raw: Buffer) => {
      if (raw.byteLength > 8192) { socket.close(1008, "message too large"); return; }
      let message: unknown;
      try { message = JSON.parse(raw.toString()); }
      catch { socket.close(1008, "malformed message"); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        socket.close(1008, "expected object message");
        return;
      }
      const msg = message as Record<string, unknown>;
      if (msg.type === "auth" && authStarted) return;
      if (!connection.userId) {
        if (authStarted) return;
        if (msg.type !== "auth" || typeof msg.token !== "string" || !msg.token.trim() ||
            Object.keys(msg).some(key => key !== "type" && key !== "token")) {
          socket.close(1008, "expected auth message");
          return;
        }
        authenticate(msg.token);
        return;
      }
      if (msg.type !== "sync:subscribe" || typeof msg.projectId !== "string" || !UUID_RE.test(msg.projectId) ||
          (msg.cursor !== null && !isRealtimeCursor(msg.cursor)) ||
          Object.keys(msg).some(key => key !== "type" && key !== "projectId" && key !== "cursor")) {
        socket.close(1008, "invalid subscription");
        return;
      }
      connection.generation++;
      connection.subscription = { projectId: msg.projectId.toLowerCase(), cursor: msg.cursor, initial: true, errorSent: false };
      updatePolling();
      kick();
    });

    const cleanup = () => {
      clearTimeout(authTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      connection.generation++;
      connection.subscription = null;
      connections.delete(connection);
      if (connection.userId) unregisterSocket(connection.userId, socket);
      updatePolling();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    const cookieToken = requestToken(req);
    if (cookieToken) authenticate(cookieToken);
  });
}
