/** Приглашённые участники задачи (issue collaborators) — COLLAB_MIGRATION.md Фаза 2.
 *  Grant строго issue-scoped: видит и комментирует ОДНУ задачу, всё остальное в
 *  проекте — 403; ролью/видимостью проекта не становится; в исполнители не годится.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });
const put = (url: string, token: string, payload?: unknown) =>
  app.inject({ method: "PUT", url, headers: auth(token), payload });
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });

// outsider — member нигде; P1 (CORP) не shared. p1issue — задача в P1.
const p1 = () => fx.projects.p1;
const iss = () => fx.issues.p1issue;
const collabUrl = (issueId = iss(), userId = fx.users.outsider) =>
  `/api/projects/${p1()}/issues/${issueId}/collaborators/${userId}`;

describe("доступ приглашённого — только его задача", () => {
  test("collaborator: задача и комментарии — да; список/bootstrap/мутации — 403", async () => {
    const adm = await login(app, "admin");
    const out = await login(app, "outsider");

    // до подключения — не участник P1
    expect((await g(`/api/projects/${p1()}/issues/${iss()}`, out)).statusCode).toBe(403);

    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    // после подключения — видит задачу и тред, может комментировать
    const detail = await g(`/api/projects/${p1()}/issues/${iss()}`, out);
    expect(detail.statusCode).toBe(200);
    expect((await g(`/api/projects/${p1()}/issues/${iss()}/comments`, out)).statusCode).toBe(200);
    const c = await post(`/api/projects/${p1()}/issues/${iss()}/comments`, out, { body: "смотрю по приглашению" });
    expect(c.statusCode).toBe(201);

    // всё остальное в проекте закрыто
    expect((await g(`/api/projects/${p1()}/issues`, out)).statusCode).toBe(403); // список
    expect((await g(`/api/projects/${p1()}`, out)).statusCode).toBe(403); // bootstrap
    expect((await patch(`/api/projects/${p1()}/issues/${iss()}`, out, { title: "hax" })).statusCode).toBe(403);
    expect((await del(`/api/projects/${p1()}/issues/${iss()}`, out)).statusCode).toBe(403);
    expect((await post(`/api/projects/${p1()}/issues/${iss()}/transition`, out, { to: fx.p1status.inprogress })).statusCode).toBe(403);
  });

  test("приглашение не открывает проект: outsider не видит CORP в /api/projects", async () => {
    const adm = await login(app, "admin");
    const out = await login(app, "outsider");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    const visible = JSON.parse((await g("/api/projects", out)).body).map((p: { key: string }) => p.key);
    expect(visible).not.toContain("CORP");
  });

  test("grant привязан к ОДНОЙ задаче — другая задача того же проекта закрыта", async () => {
    const adm = await login(app, "admin");
    const out = await login(app, "outsider");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    const other = JSON.parse((await post(`/api/projects/${p1()}/issues`, adm, newIssue())).body);
    expect((await g(`/api/projects/${p1()}/issues/${other.id}`, out)).statusCode).toBe(403);
  });

  test("collaborator не годится в исполнители (§3.6 не ослаблен)", async () => {
    const adm = await login(app, "admin");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);
    const r = await patch(`/api/projects/${p1()}/issues/${iss()}`, adm, { assigneeId: fx.users.outsider });
    expect(r.statusCode).toBe(400);
  });
});

describe("управление приглашёнными — manager + admin (D2)", () => {
  test("manager проекта подключает; employee/viewer — 403", async () => {
    const m1 = await login(app, "mgr1");
    const emp = await login(app, "emp1");
    const viw = await login(app, "viw1");

    expect((await put(collabUrl(), m1, {})).statusCode).toBe(200);
    expect((await put(collabUrl(iss(), fx.users.viw1), emp, {})).statusCode).toBe(403);
    expect((await put(collabUrl(iss(), fx.users.emp1), viw, {})).statusCode).toBe(403);
  });

  test("DELETE: admin — 204; повторный — 404; employee — 403", async () => {
    const adm = await login(app, "admin");
    const emp = await login(app, "emp1");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    expect((await del(collabUrl(), emp)).statusCode).toBe(403);
    expect((await del(collabUrl(), adm)).statusCode).toBe(204);
    expect((await del(collabUrl(), adm)).statusCode).toBe(404); // уже не подключён
  });

  test("PUT неизвестного пользователя → 404", async () => {
    const adm = await login(app, "admin");
    const r = await put(collabUrl(iss(), "00000000-0000-0000-0000-000000000000"), adm, {});
    expect(r.statusCode).toBe(404);
  });

  test("GET /collaborators и getIssueDto.collaborators отражают состав", async () => {
    const adm = await login(app, "admin");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    const list = JSON.parse((await g(`/api/projects/${p1()}/issues/${iss()}/collaborators`, adm)).body);
    expect(list.map((c: { userId: string }) => c.userId)).toEqual([fx.users.outsider]);
    expect(list[0]).toHaveProperty("name");

    const detail = JSON.parse((await g(`/api/projects/${p1()}/issues/${iss()}`, adm)).body);
    expect(detail.collaborators.map((c: { userId: string }) => c.userId)).toEqual([fx.users.outsider]);
  });
});

describe("одиночный режим — /issues/collaborating + participants (Фаза 6)", () => {
  test("GET /api/issues/collaborating — только свои подключения, с данными проекта", async () => {
    const adm = await login(app, "admin");
    const out = await login(app, "outsider");
    const mg2 = await login(app, "mgr2");

    expect(JSON.parse((await g("/api/issues/collaborating", out)).body)).toEqual([]);

    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    const mine = JSON.parse((await g("/api/issues/collaborating", out)).body);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      issueId: iss(),
      projectId: p1(),
      projectKey: "CORP",
      key: "CORP-1",
    });
    expect(mine[0].statusName).toBeTruthy();

    // чужие подключения не видны
    expect(JSON.parse((await g("/api/issues/collaborating", mg2)).body)).toEqual([]);
  });

  test("getIssueDto.participants содержит автора задачи и приглашённого", async () => {
    const adm = await login(app, "admin");
    expect((await put(collabUrl(), adm, {})).statusCode).toBe(200);

    const detail = JSON.parse((await g(`/api/projects/${p1()}/issues/${iss()}`, adm)).body);
    const ids = detail.participants.map((p: { id: string }) => p.id);
    expect(ids).toContain(fx.users.emp1); // reporter+assignee задачи в фикстуре
    expect(ids).toContain(fx.users.outsider); // приглашённый
    expect(detail.participants[0]).toHaveProperty("initials");
  });
});

describe("GET /api/users/pickable (D7)", () => {
  test("любой аутентифицированный; только активные; без globalRole/username", async () => {
    const viw = await login(app, "viw1");
    const res = await g("/api/users/pickable", viw);
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("initials");
      expect(r).toHaveProperty("jobRole");
      expect(r).not.toHaveProperty("globalRole");
      expect(r).not.toHaveProperty("username");
    }
  });
});
