import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
let app: FastifyInstance;
let fx: Fixture;
let token: string;
beforeAll(async () => { app = await getApp(); });
afterAll(() => stopApp());
beforeEach(async () => { await resetDb(); fx = await seedFixture(); token = await login(app, "mgr1"); });
const url = () => `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/mention-candidates`;

test("suggests only eligible active recipients and supports name/login search", async () => {
  let response = await app.inject({ url: url(), headers: auth(token) });
  expect(response.statusCode).toBe(200);
  const ids = response.json<{ id: string }[]>().map(person => person.id);
  expect(ids).toContain(fx.users.emp1); expect(ids).toContain(fx.users.viw1);
  expect(ids).not.toContain(fx.users.mgr1); expect(ids).not.toContain(fx.users.mgr2);
  expect(ids).not.toContain(fx.users.outsider);
  response = await app.inject({ url: `${url()}?q=Viewer`, headers: auth(token) });
  expect(response.json()).toMatchObject([{ username: "viw1" }]);
  response = await app.inject({ url: `${url()}?q=emp1`, headers: auth(token) });
  expect(response.json()).toMatchObject([{ username: "emp1" }]);
  response = await app.inject({ url: `${url()}?q=%25`, headers: auth(token) });
  expect(response.json()).toEqual([]);
  await q("UPDATE users SET is_active = false WHERE id = $1", [fx.users.viw1]);
  response = await app.inject({ url: `${url()}?q=viw1`, headers: auth(token) });
  expect(response.json()).toEqual([]);
});

test("issue collaborators may use the picker but cannot enumerate a different task/project", async () => {
  await q("INSERT INTO issue_collaborators(issue_id, user_id, added_by) VALUES ($1, $2, $3)",
    [fx.issues.p1issue, fx.users.outsider, fx.users.mgr1]);
  const guest = await login(app, "outsider");
  expect((await app.inject({ url: url(), headers: auth(guest) })).statusCode).toBe(200);
  expect((await app.inject({ url: url() })).statusCode).toBe(401);
  expect((await app.inject({ url: url(), headers: auth(await login(app, "mgr2")) })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p2issue}/mention-candidates`, headers: auth(token) })).statusCode).toBe(404);
  expect((await app.inject({ url: url(), headers: auth(token), query: { q: "x".repeat(81) } })).statusCode).toBe(400);
});

test("choosing a suggested login creates exactly one mention notification and pushes it to the recipient", async () => {
  const recipientToken = await login(app, "viw1");
  const socket = await app.injectWS("/api/ws");
  const nextMessage = () => new Promise<{ type: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("No WebSocket message")), 2000);
    socket.once("message", data => { clearTimeout(timeout); resolve(JSON.parse(String(data))); });
  });
  try {
    const authenticated = nextMessage(); socket.send(JSON.stringify({ type: "auth", token: recipientToken }));
    expect(await authenticated).toMatchObject({ type: "auth_ok" });
    const suggestions = await app.inject({ url: `${url()}?q=viw1`, headers: auth(token) });
    const username = suggestions.json<{ username: string }[]>()[0].username;
    const pushed = nextMessage();
    const posted = await app.inject({ method: "POST", url: url().replace("mention-candidates", "comments"),
      headers: auth(token), payload: { body: `Привет @${username} и ещё раз @${username}` } });
    expect(posted.statusCode, posted.body).toBe(201);
    expect(await pushed).toMatchObject({ type: "notify" });
    expect(await q("SELECT id FROM notifications WHERE user_id = $1 AND issue_id = $2 AND type = 'issue.mention'",
      [fx.users.viw1, fx.issues.p1issue])).toHaveLength(1);
  } finally { socket.close(); }
});
