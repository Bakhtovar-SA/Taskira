/**
 * GET /api/ws — push уведомлений (Этап 3c). app.injectWS() — тестовый клиент
 * @fastify/websocket, без реального TCP-сокета (см. его README).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getApp, login, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { _resetWsHub } from "../src/services/wsHub.js";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = await getApp();
});
afterAll(() => stopApp());
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});
afterEach(() => {
  _resetWsHub();
});

/** Ждёт следующего сообщения от сокета (с таймаутом, чтобы тест не завис). */
function nextMessage(ws: { on: (ev: "message", cb: (data: unknown) => void) => void }, ms = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("не дождались сообщения от WS")), ms);
    ws.on("message", (data: unknown) => {
      clearTimeout(t);
      resolve(JSON.parse(String(data)));
    });
  });
}

/** Ждёт закрытия сокета (с таймаутом). */
function waitClosed(ws: { on: (ev: "close", cb: () => void) => void }, ms = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("сокет не закрылся")), ms);
    ws.on("close", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

describe("WS /api/ws", () => {
  test("невалидный токен в auth-сообщении — сокет закрывается", async () => {
    const ws = await app.injectWS("/api/ws");
    const closed = waitClosed(ws);
    ws.send(JSON.stringify({ type: "auth", token: "garbage-not-a-jwt" }));
    await closed;
  });

  test("сообщение не auth-формы — сокет закрывается", async () => {
    const ws = await app.injectWS("/api/ws");
    const closed = waitClosed(ws);
    ws.send(JSON.stringify({ type: "hello" }));
    await closed;
  });

  test("валидный токен → сервер отвечает auth_ok, сокет остаётся открытым", async () => {
    // auth_ok — не формальность: именно на него, а не на факт открытия
    // соединения, клиент (store.tsx) сбрасывает бэкофф переподключения.
    const token = await login(app, "emp1");
    const ws = await app.injectWS("/api/ws");
    const ok = nextMessage(ws);
    ws.send(JSON.stringify({ type: "auth", token }));
    expect(await ok).toMatchObject({ type: "auth_ok" });
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  test("emit() при комментарии пушит {type:'notify'} назначенному/автору задачи", async () => {
    // p1issue: assignee=emp1, reporter=emp1 (seedFixture). mgr1 (актор) комментирует →
    // emp1 — получатель (не сам оставлял комментарий), должен получить push.
    const empToken = await login(app, "emp1");
    const ws = await app.injectWS("/api/ws");
    ws.send(JSON.stringify({ type: "auth", token: empToken }));
    await new Promise((r) => setTimeout(r, 100)); // дождаться регистрации в wsHub

    const pushed = nextMessage(ws);
    const mgrToken = await login(app, "mgr1");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/comments`,
      headers: { authorization: `Bearer ${mgrToken}` },
      payload: { body: "тестовый комментарий" },
    });
    expect(res.statusCode).toBe(201);

    const msg = await pushed;
    expect(msg).toMatchObject({ type: "notify" });
    ws.close();
  });

  test("сторонний пользователь (не получатель) push не получает", async () => {
    // viw1 не watcher/assignee/reporter p1issue — комментарий mgr1 его не касается.
    const viwToken = await login(app, "viw1");
    const ws = await app.injectWS("/api/ws");
    const received: unknown[] = [];
    ws.on("message", (data: unknown) => received.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "auth", token: viwToken }));
    await new Promise((r) => setTimeout(r, 100));

    const mgrToken = await login(app, "mgr1");
    await app.inject({
      method: "POST",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/comments`,
      headers: { authorization: `Bearer ${mgrToken}` },
      payload: { body: "не для viw1" },
    });
    await new Promise((r) => setTimeout(r, 300)); // дать шанс ошибочному push прилететь

    // auth_ok от самого хендшейка — ожидаемое сообщение, не push; здесь важно
    // отсутствие именно "notify".
    expect(received.filter((m) => (m as { type?: string }).type === "notify")).toEqual([]);
    ws.close();
  });

  test("логаут закрывает открытый сокет — не ждёт закрытия вкладки человеком", async () => {
    const token = await login(app, "emp1");
    const ws = await app.injectWS("/api/ws");
    ws.send(JSON.stringify({ type: "auth", token }));
    await new Promise((r) => setTimeout(r, 100)); // дождаться регистрации в wsHub
    expect(ws.readyState).toBe(ws.OPEN);

    const closed = waitClosed(ws);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    await closed; // invalidateUserCache() → closeUserSockets(), без этого сокет остался бы жить
  });
});
