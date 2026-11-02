import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { WsMessage } from "../src/contract.js";
import { pushToUser } from "../src/services/wsHub.js";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;
const sockets = new Set<WebSocket>();

beforeAll(async () => { app = await getApp(); });
afterAll(() => stopApp());
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });
afterEach(async () => {
  await Promise.all([...sockets].map(socket => new Promise<void>(resolve => {
    if (socket.readyState === socket.CLOSED) { resolve(); return; }
    socket.once("close", () => resolve());
    socket.close();
  })));
  sockets.clear();
});

function inbox(socket: WebSocket) {
  const received: WsMessage[] = [];
  const listeners = new Set<() => void>();
  socket.on("message", data => {
    received.push(JSON.parse(String(data)) as WsMessage);
    for (const listener of listeners) listener();
  });
  return {
    received,
    wait<T extends WsMessage["type"]>(type: T, predicate: (message: Extract<WsMessage, { type: T }>) => boolean = () => true, timeout = 3000) {
      return new Promise<Extract<WsMessage, { type: T }>>((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Missing WS ${type}`)); }, timeout);
        function check() {
          const index = received.findIndex(message => message.type === type && predicate(message as Extract<WsMessage, { type: T }>));
          if (index < 0) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(received.splice(index, 1)[0] as Extract<WsMessage, { type: T }>);
        }
        listeners.add(check);
        check();
      });
    },
  };
}

async function connect(username: string) {
  const token = await login(app, username);
  const socket = await app.injectWS("/api/ws");
  sockets.add(socket);
  const messages = inbox(socket);
  socket.send(JSON.stringify({ type: "auth", token }));
  await messages.wait("auth_ok");
  return { socket, messages, token };
}

async function subscribe(connection: Awaited<ReturnType<typeof connect>>, projectId: string, cursor: string | null = null) {
  connection.socket.send(JSON.stringify({ type: "sync:subscribe", projectId, cursor }));
  return connection.messages.wait("sync", message => message.projectId === projectId);
}

describe("durable realtime project feed", () => {
  test("REST requires browse permission and never caches cursor responses", async () => {
    const url = `/api/projects/${fx.projects.p1}/sync`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: auth(await login(app, "outsider")) })).statusCode).toBe(403);
    const response = await app.inject({ url, headers: auth(await login(app, "emp1")) });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ type: "sync", projectId: fx.projects.p1, reset: true, issueIds: [] });
    expect(response.json().cursor).toMatch(/^\d+$/);
  });

  test.each(["-1", "1e2", "9223372036854775808", "", "1.5"])("REST rejects invalid bigint cursor %s", async cursor => {
    const response = await app.inject({
      url: `/api/projects/${fx.projects.p1}/sync?cursor=${encodeURIComponent(cursor)}`,
      headers: auth(await login(app, "emp1")),
    });
    expect(response.statusCode).toBe(400);
  });

  test("a task created by another user reaches an open board without page reload", async () => {
    const viewer = await connect("viw1");
    await subscribe(viewer, fx.projects.p1);
    const created = await app.inject({
      method: "POST", url: `/api/projects/${fx.projects.p1}/issues`,
      headers: auth(await login(app, "mgr1")), payload: newIssue({ title: "Realtime creation" }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const message = await viewer.messages.wait("sync", message => message.issueIds.includes(id));
    expect(message).toMatchObject({ reset: false, projectId: fx.projects.p1 });
    expect(message.issueIds).not.toContain(fx.issues.p2issue);
  });

  test("reconnect replays committed changes missed offline with project isolation", async () => {
    const first = await connect("emp1");
    const baseline = await subscribe(first, fx.projects.p1);
    await new Promise<void>(resolve => { first.socket.once("close", () => resolve()); first.socket.close(); });
    await q(`UPDATE issues SET title = title || ' offline' WHERE id = ANY($1::uuid[])`, [[fx.issues.p1issue, fx.issues.p2issue]]);
    const resumed = await connect("emp1");
    const replay = await subscribe(resumed, fx.projects.p1, baseline.cursor);
    expect(replay.reset).toBe(false);
    expect(replay.issueIds).toContain(fx.issues.p1issue);
    expect(replay.issueIds).not.toContain(fx.issues.p2issue);
    expect(BigInt(replay.cursor)).toBeGreaterThan(BigInt(baseline.cursor));
  });

  test("another subscription replaces an in-flight project read", async () => {
    const admin = await connect("admin");
    admin.socket.send(JSON.stringify({ type: "sync:subscribe", projectId: fx.projects.p1, cursor: null }));
    admin.socket.send(JSON.stringify({ type: "sync:subscribe", projectId: fx.projects.p2, cursor: null }));
    await admin.messages.wait("sync", message => message.projectId === fx.projects.p2);
    expect(admin.messages.received.filter(message => message.type === "sync" && message.projectId === fx.projects.p1)).toEqual([]);
  });

  test("membership removal denies a live subscription before sending its next change", async () => {
    const employee = await connect("emp1");
    await subscribe(employee, fx.projects.p1);
    await q(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [fx.projects.p1, fx.users.emp1]);
    await q(`UPDATE issues SET title = 'After access removal' WHERE id = $1`, [fx.issues.p1issue]);
    const denied = await employee.messages.wait("sync:denied");
    expect(denied).toMatchObject({ projectId: fx.projects.p1 });
    expect(employee.messages.received.filter(message => message.type === "sync")).toEqual([]);
    // requirePerm's local membership cache was populated by login/bootstrap in
    // normal use; REST must perform its own uncached recheck as well.
    expect((await app.inject({ url: `/api/projects/${fx.projects.p1}/sync`, headers: auth(employee.token) })).statusCode).toBe(403);
  });

  test("REST bypasses stale permission and session caches from another replica", async () => {
    const token = await login(app, "emp1");
    const request = () => app.inject({ url: `/api/projects/${fx.projects.p1}/sync`, headers: auth(token) });
    expect((await request()).statusCode).toBe(200);
    await q(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [fx.projects.p1, fx.users.emp1]);
    expect((await request()).statusCode).toBe(403);
    await q(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [fx.users.emp1]);
    expect((await request()).statusCode).toBe(401);
  });

  test("session revocation from another replica closes a subscribed socket", async () => {
    const employee = await connect("emp1");
    await subscribe(employee, fx.projects.p1);
    const closed = new Promise<number>(resolve => employee.socket.once("close", code => resolve(code)));
    await q(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [fx.users.emp1]);
    expect(await closed).toBe(1008);
  });

  test("shared and department viewers receive the same feed as project members", async () => {
    const outsider = await connect("outsider");
    await q(`INSERT INTO department_members (department_id, user_id, source) VALUES ($1, $2, 'manual')`, [fx.depts.d1, fx.users.outsider]);
    expect((await subscribe(outsider, fx.projects.p1)).reset).toBe(true);
    await q(`UPDATE projects SET is_shared = true WHERE id = $1`, [fx.projects.p2]);
    expect((await subscribe(outsider, fx.projects.p2)).reset).toBe(true);
  });

  test("foreign-project subscriptions reveal neither tasks nor their cursor", async () => {
    const employee = await connect("emp1");
    employee.socket.send(JSON.stringify({ type: "sync:subscribe", projectId: fx.projects.p2, cursor: "0" }));
    expect(await employee.messages.wait("sync:denied")).toMatchObject({ projectId: fx.projects.p2 });
    expect(employee.messages.received.filter(message => message.type === "sync")).toEqual([]);
  });

  test.each(["project", "notifications"])("a stalled %s consumer is closed instead of accumulating an unbounded send queue", async feed => {
    const employee = await connect("emp1");
    const serverSocket = [...app.websocketServer.clients].find(socket => socket.readyState === socket.OPEN)!;
    expect(serverSocket).toBeDefined();
    const closed = new Promise<number>(resolve => employee.socket.once("close", code => resolve(code)));
    Object.defineProperty(serverSocket, "bufferedAmount", { configurable: true, get: () => 300_000 });
    try {
      if (feed === "project") {
        employee.socket.send(JSON.stringify({ type: "sync:subscribe", projectId: fx.projects.p1, cursor: null }));
      } else {
        pushToUser(fx.users.emp1, { type: "notify", ts: Date.now() });
      }
      expect(await closed).toBe(1013);
    } finally { Reflect.deleteProperty(serverSocket, "bufferedAmount"); }
  });

  test("the durable pending queue drains even with no connected subscribers", async () => {
    expect(sockets.size).toBe(0);
    await expect.poll(async () => {
      const rows = await q<{ count: string }>(`SELECT count(*) FROM realtime_pending`);
      return Number(rows[0].count);
    }, { timeout: 7000, interval: 100 }).toBe(0);
    const events = await q<{ project_id: string }>(`SELECT project_id FROM realtime_events`);
    expect(events.some(event => event.project_id === fx.projects.p1)).toBe(true);
  });

  test("heartbeat is visible to browser JavaScript and carries a protocol ping", async () => {
    const employee = await connect("emp1");
    let pings = 0;
    employee.socket.on("ping", () => { pings++; });
    const heartbeat = await employee.messages.wait("heartbeat", () => true, 30_000);
    expect(heartbeat.ts).toEqual(expect.any(Number));
    expect(pings).toBeGreaterThan(0);
    expect(employee.socket.readyState).toBe(employee.socket.OPEN);
  }, 35_000);
});
