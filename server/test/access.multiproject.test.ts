/** Multi-project — сценарии из DEPT_MIGRATION.md (видимость, IDOR, cross-project, департаменты). */
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
const patch = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: auth(token), payload });
const del = (url: string, token: string) => app.inject({ method: "DELETE", url, headers: auth(token) });
const keys = (body: string) => JSON.parse(body).map((p: { key: string }) => p.key).sort();

describe("видимость проектов", () => {
  test("admin — все; участник — только свои; is_shared открывает проект всем", async () => {
    const adm = await login(app, "admin");
    expect(keys((await g("/api/projects", adm)).body)).toEqual(["CORP", "SEC"]);

    const m1 = await login(app, "mgr1");
    expect(keys((await g("/api/projects", m1)).body)).toEqual(["CORP"]);

    const m2 = await login(app, "mgr2");
    expect(keys((await g("/api/projects", m2)).body)).toEqual(["SEC"]);

    // делаем P2 общим — mgr1 теперь его видит
    expect((await patch(`/api/projects/${fx.projects.p2}`, adm, { isShared: true })).statusCode).toBe(200);
    expect(keys((await g("/api/projects", m1)).body)).toEqual(["CORP", "SEC"]);
  });

  test("участник P1 не имеет доступа к P2", async () => {
    const emp = await login(app, "emp1");
    expect((await g(`/api/projects/${fx.projects.p2}`, emp)).statusCode).toBe(403);
  });
});

describe("IDOR — задача из чужого проекта по пути этого проекта", () => {
  test("GET / PATCH / DELETE /api/projects/P1/issues/<из P2> → 404, задача цела", async () => {
    const adm = await login(app, "admin");
    const wrong = `/api/projects/${fx.projects.p1}/issues/${fx.issues.p2issue}`;

    expect((await g(wrong, adm)).statusCode).toBe(404);
    expect((await patch(wrong, adm, { title: "hax" })).statusCode).toBe(404);
    expect((await del(wrong, adm)).statusCode).toBe(404);
    expect((await g(`${wrong}/comments`, adm)).statusCode).toBe(404);

    // по правильному пути задача на месте
    const ok = await g(`/api/projects/${fx.projects.p2}/issues/${fx.issues.p2issue}`, adm);
    expect(ok.statusCode).toBe(200);
  });
});

describe("исполнитель — только участник проекта (§3.6)", () => {
  test("assigneeId из другого проекта → 400", async () => {
    const adm = await login(app, "admin");
    // mgr2 — участник P2, не P1
    const r = await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeId: fx.users.mgr2 }));
    expect(r.statusCode).toBe(400);
    // участник P1 — ок
    const ok = await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ assigneeId: fx.users.emp1 }));
    expect(ok.statusCode).toBe(201);
  });
});

describe("департаменты и проекты (global admin)", () => {
  test("DELETE департамента с проектами → 409; пустого — 204", async () => {
    const adm = await login(app, "admin");
    expect((await del(`/api/departments/${fx.depts.d1}`, adm)).statusCode).toBe(409);
    // убираем проект P1 — департамент D1 пустеет
    expect((await del(`/api/projects/${fx.projects.p1}`, adm)).statusCode).toBe(204);
    expect((await del(`/api/departments/${fx.depts.d1}`, adm)).statusCode).toBe(204);
  });

  test("POST /api/projects с занятым ключом → 409; свежий проект получает workflow", async () => {
    const adm = await login(app, "admin");
    expect((await post("/api/projects", adm, { key: "CORP", name: "dup", departmentId: fx.depts.d1 })).statusCode).toBe(409);

    const created = JSON.parse((await post("/api/projects", adm, { key: "NEW", name: "New", departmentId: fx.depts.d1 })).body);
    const wf = JSON.parse((await g(`/api/projects/${created.id}/workflow`, adm)).body);
    expect(wf.statuses.length).toBe(4);
    expect(wf.transitions.length).toBe(8);
  });

  test("нумерация задач независима по проектам", async () => {
    const adm = await login(app, "admin");
    const a = JSON.parse((await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue())).body);
    const b = JSON.parse((await post(`/api/projects/${fx.projects.p2}/issues`, adm, newIssue())).body);
    expect(a.key).toBe("CORP-2"); // CORP-1 уже в фикстуре
    expect(b.key).toBe("SEC-2");
  });
});

describe("резолв «текущего пользователя» при смене активного проекта (regression)", () => {
  // Клиентский баг (починен удалением дев-свитчера + этим инвариантом):
  // switchProject → buildProjectData перезаполняет data.users составом НОВОГО
  // проекта. Если действующий пользователь — глобальный admin без строки в
  // project_members — не попадал в этот список, me-memo не находил currentUserId
  // и молча падал на data.users[0], показывая чужую роль ("viewer" → "employee"
  // сам собой при смене проекта). Серверный инвариант, который держит фикс:
  // bootstrap ЛЮБОГО проекта всегда возвращает действующего пользователя в .users.

  test("глобальный admin есть в .users каждого проекта, даже без членства", async () => {
    const adm = await login(app, "admin");
    for (const pid of [fx.projects.p1, fx.projects.p2]) {
      const res = await g(`/api/projects/${pid}`, adm);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.users.map((u: { id: string }) => u.id)).toContain(fx.users.admin);
      // при этом admin не участник — записи в .members нет (резолв роли, не подмена)
      expect(body.members.map((m: { userId: string }) => m.userId)).not.toContain(fx.users.admin);
    }
  });

  test("рядовой участник находит себя в .users своего проекта", async () => {
    const m1 = await login(app, "mgr1");
    const body = JSON.parse((await g(`/api/projects/${fx.projects.p1}`, m1)).body);
    expect(body.users.map((u: { id: string }) => u.id)).toContain(fx.users.mgr1);
  });
});

describe("сериализация DTO (taskira-review §1.1, §1.2)", () => {
  test("workflow: переходы в camelCase { from, to } с реальными id статусов", async () => {
    const adm = await login(app, "admin");
    const wf = JSON.parse((await g(`/api/projects/${fx.projects.p1}/workflow`, adm)).body);
    expect(wf.transitions.length).toBe(8);
    const t0 = wf.transitions[0];
    expect(t0).toHaveProperty("from");
    expect(t0).toHaveProperty("to");
    expect(t0).not.toHaveProperty("from_status_id");
    // ребро todo → inprogress из дефолтного графа — по настоящим uuid статусов
    expect(wf.transitions).toContainEqual(
      expect.objectContaining({ from: fx.p1status.todo, to: fx.p1status.inprogress }),
    );
  });

  test("workflow: POST /transitions возвращает { id, from, to }", async () => {
    const adm = await login(app, "admin");
    // сначала удалим todo→inprogress, потом создадим заново — получим свежий row
    const wf = JSON.parse((await g(`/api/projects/${fx.projects.p1}/workflow`, adm)).body);
    const edge = wf.transitions.find(
      (t: { from: string; to: string }) => t.from === fx.p1status.todo && t.to === fx.p1status.inprogress,
    );
    expect((await del(`/api/projects/${fx.projects.p1}/workflow/transitions/${edge.id}`, adm)).statusCode).toBe(204);
    const created = JSON.parse(
      (await post(`/api/projects/${fx.projects.p1}/workflow/transitions`, adm, {
        from: fx.p1status.todo,
        to: fx.p1status.inprogress,
      })).body,
    );
    expect(created).toMatchObject({ from: fx.p1status.todo, to: fx.p1status.inprogress });
    expect(created).not.toHaveProperty("from_status_id");
  });

  test("date-поля приходят строкой ГГГГ-ММ-ДД, не ISO-таймстемпом", async () => {
    const adm = await login(app, "admin");
    const created = JSON.parse(
      (await post(`/api/projects/${fx.projects.p1}/issues`, adm, newIssue({ dueDate: "2026-03-15" }))).body,
    );
    expect(created.dueDate).toBe("2026-03-15");
    const fetched = JSON.parse((await g(`/api/projects/${fx.projects.p1}/issues/${created.id}`, adm)).body);
    expect(fetched.dueDate).toBe("2026-03-15");
  });
});

describe("состав проекта — global admin правит любой проект (AdminView / Feature A)", () => {
  // COLLAB_MIGRATION.md D8: добавление людей в проект из экрана отдела опирается
  // на то, что global admin может PUT/DELETE участника ЛЮБОГО проекта, не будучи
  // в нём. Клиент фичи чисто UI — этот контракт держит её.
  const put = (url: string, token: string, payload: unknown) =>
    app.inject({ method: "PUT", url, headers: auth(token), payload });

  test("admin добавляет и убирает участника проекта, где сам не состоит", async () => {
    const adm = await login(app, "admin");
    const url = `/api/projects/${fx.projects.p2}/members/${fx.users.outsider}`;

    const added = await put(url, adm, { role: "employee" });
    expect(added.statusCode).toBe(200);
    expect(JSON.parse(added.body)).toMatchObject({ userId: fx.users.outsider, role: "employee" });

    let boot = JSON.parse((await g(`/api/projects/${fx.projects.p2}`, adm)).body);
    expect(boot.members.map((m: { userId: string }) => m.userId)).toContain(fx.users.outsider);

    expect((await del(url, adm)).statusCode).toBe(204);
    boot = JSON.parse((await g(`/api/projects/${fx.projects.p2}`, adm)).body);
    expect(boot.members.map((m: { userId: string }) => m.userId)).not.toContain(fx.users.outsider);
  });

  test("менеджер другого проекта не правит чужой состав — 403", async () => {
    const m1 = await login(app, "mgr1"); // manager P1, к P2 непричастен
    const r = await put(`/api/projects/${fx.projects.p2}/members/${fx.users.outsider}`, m1, { role: "viewer" });
    expect(r.statusCode).toBe(403);
  });

  test("гард последнего менеджера: понизить единственного менеджера P2 нельзя — 409", async () => {
    const adm = await login(app, "admin");
    const r = await put(`/api/projects/${fx.projects.p2}/members/${fx.users.mgr2}`, adm, { role: "viewer" });
    expect(r.statusCode).toBe(409);
  });
});
