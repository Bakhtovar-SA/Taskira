/**
 * Уведомления (миграция 011, NOTIFICATIONS_MIGRATION.md Фаза 2).
 * Получатели по D2, отсев актора и деактивированных по D8, mentions по D5,
 * in-app API (лента / счётчик / read / prefs).
 *
 * Email не проверяется здесь — NOTIFY_EMAIL_ENABLED в тестах не задан, все строки
 * получают email_state='skipped'; сама рассылка — job `mail` (Фаза 3).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { getApp, stopApp, resetDb, seedFixture, login, auth, q, type Fixture } from "./helpers.js";

let app: FastifyInstance;
let fx: Fixture;

const addWatcher = (issueId: string, userId: string) =>
  q(`INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issueId, userId]);
const addCollab = (issueId: string, userId: string) =>
  q(`INSERT INTO issue_collaborators (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issueId, userId]);
const deactivate = (userId: string) => q(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);

/** Кому и какого типа пришли уведомления по задаче — как множество пар. */
async function notifsFor(issueId: string): Promise<{ user: string; type: string; emailState: string }[]> {
  const rows = await q<{ user_id: string; type: string; email_state: string }>(
    `SELECT user_id, type, email_state FROM notifications WHERE issue_id = $1 ORDER BY user_id, type`,
    [issueId],
  );
  return rows.map((r) => ({ user: r.user_id, type: r.type, emailState: r.email_state }));
}
const recipients = (list: { user: string }[]) => [...new Set(list.map((x) => x.user))].sort();

const comment = (pid: string, iid: string, tok: string, body: string) =>
  app.inject({ method: "POST", url: `/api/projects/${pid}/issues/${iid}/comments`, headers: auth(tok), payload: { body } });

beforeAll(async () => {
  app = await getApp();
});
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

describe("Актор не уведомляет сам себя (D2)", () => {
  test("свой комментарий → строки себе нет", async () => {
    const tok = await login(app, "mgr1");
    expect((await comment(fx.projects.p1, fx.issues.p1issue, tok, "первый")).statusCode).toBe(201);

    const mine = await q(`SELECT 1 FROM notifications WHERE user_id = $1`, [fx.users.mgr1]);
    expect(mine).toHaveLength(0);
  });

  test("сам себя назначил исполнителем → строки себе нет", async () => {
    const tok = await login(app, "mgr1");
    const r = await app.inject({
      method: "PATCH",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`,
      headers: auth(tok),
      payload: { assigneeId: fx.users.mgr1 },
    });
    expect(r.statusCode).toBe(200);
    expect(await q(`SELECT 1 FROM notifications WHERE user_id = $1`, [fx.users.mgr1])).toHaveLength(0);
    // а вот прежнему исполнителю/автору (emp1) про смену статуса/назначение не шлём —
    // issue.assigned идёт только НОВОМУ исполнителю, актор им же и является
    expect(await notifsFor(fx.issues.p1issue)).toHaveLength(0);
  });
});

describe("Деактивированный получатель (D8)", () => {
  test("деактивированный watcher → уведомление не создаётся", async () => {
    await addWatcher(fx.issues.p1issue, fx.users.viw1);
    await deactivate(fx.users.viw1);

    const tok = await login(app, "mgr1");
    await comment(fx.projects.p1, fx.issues.p1issue, tok, "есть кто живой?");

    const list = await notifsFor(fx.issues.p1issue);
    expect(list.map((x) => x.user)).not.toContain(fx.users.viw1);
    // emp1 (assignee+reporter, активен) — получил
    expect(list.map((x) => x.user)).toContain(fx.users.emp1);
  });
});

describe("Комментарий → ровно watchers ∪ assignee ∪ reporter ∪ collaborators (D2)", () => {
  test("без лишних и без пропущенных", async () => {
    // p1issue: reporter = assignee = emp1. Добавляем watcher (viw1) и collaborator (outsider).
    await addWatcher(fx.issues.p1issue, fx.users.viw1);
    await addCollab(fx.issues.p1issue, fx.users.outsider);
    // mgr1 — участник проекта (manager), но НЕ watcher/assignee/reporter/collab → получить не должен.

    const tok = await login(app, "mgr1");
    expect((await comment(fx.projects.p1, fx.issues.p1issue, tok, "всем привет")).statusCode).toBe(201);

    const list = await notifsFor(fx.issues.p1issue);
    // ровно три получателя
    expect(recipients(list)).toEqual([fx.users.emp1, fx.users.outsider, fx.users.viw1].sort());
    // все типа issue.comment, у emp1 — одна строка (assignee и reporter не задваиваются)
    expect(list.every((x) => x.type === "issue.comment")).toBe(true);
    expect(list.filter((x) => x.user === fx.users.emp1)).toHaveLength(1);
    // актор и посторонние — не в списке
    expect(recipients(list)).not.toContain(fx.users.mgr1);
    expect(recipients(list)).not.toContain(fx.users.admin);
    expect(recipients(list)).not.toContain(fx.users.mgr2);
    // email отключён в тестах → skipped
    expect(list.every((x) => x.emailState === "skipped")).toBe(true);
  });

  test("смена статуса → watchers ∪ assignee ∪ reporter (collaborators НЕ включаются)", async () => {
    await addWatcher(fx.issues.p1issue, fx.users.viw1);
    await addCollab(fx.issues.p1issue, fx.users.outsider);

    const tok = await login(app, "mgr1");
    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/transition`,
      headers: auth(tok),
      payload: { to: fx.p1status.inprogress },
    });
    expect(r.statusCode).toBe(200);

    const list = await notifsFor(fx.issues.p1issue);
    expect(recipients(list)).toEqual([fx.users.emp1, fx.users.viw1].sort()); // outsider (collab) — нет
    expect(list.every((x) => x.type === "issue.status")).toBe(true);
  });
});

describe("Упоминания (D5)", () => {
  test("@login видящего задачу → issue.mention; @постороннего и @несуществующего → игнор", async () => {
    const tok = await login(app, "mgr1");
    await comment(
      fx.projects.p1,
      fx.issues.p1issue,
      tok,
      "нужно мнение @viw1 и @mgr2, cc @nosuchperson, а также email me@example.com",
    );

    const mentions = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.mention");
    expect(mentions.map((x) => x.user)).toEqual([fx.users.viw1]); // viw1 — участник p1
    // mgr2 не в p1 и не collaborator → нет; nosuchperson → нет; me@example.com не считается @-упоминанием
  });

  test("@ приглашённого к задаче (не участник проекта) → mention приходит", async () => {
    await addCollab(fx.issues.p1issue, fx.users.outsider);
    const tok = await login(app, "mgr1");
    await comment(fx.projects.p1, fx.issues.p1issue, tok, "@outsider посмотри плиз");

    const mentions = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.mention");
    expect(mentions.map((x) => x.user)).toContain(fx.users.outsider);
  });

  test("правка описания уведомляет только НОВЫЕ @-упоминания (не повторяет старые)", async () => {
    const tok = await login(app, "emp1"); // автор/исполнитель p1issue — может править
    const patch = (description: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`,
        headers: auth(tok),
        payload: { description },
      });

    await patch("нужно мнение @viw1");
    let m = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.mention");
    expect(m.map((x) => x.user)).toEqual([fx.users.viw1]);

    await patch("нужно мнение @viw1 — уточняю формулировку"); // тот же @viw1
    m = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.mention");
    expect(m).toHaveLength(1); // повторного пинга нет

    await patch("нужно мнение @viw1 и @mgr1"); // @mgr1 — новый
    m = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.mention");
    expect(m.map((x) => x.user).sort()).toEqual([fx.users.viw1, fx.users.mgr1].sort());
  });
});

describe("Прочие триггеры", () => {
  test("назначение исполнителя → уведомление НОВОМУ исполнителю", async () => {
    const tok = await login(app, "mgr1");
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`,
      headers: auth(tok),
      payload: { assigneeId: fx.users.viw1 },
    });
    const list = await notifsFor(fx.issues.p1issue);
    expect(list).toEqual([{ user: fx.users.viw1, type: "issue.assigned", emailState: "skipped" }]);
  });

  test("подключение collaborator → уведомление подключённому", async () => {
    const mgrTok = await login(app, "mgr1");
    await app.inject({
      method: "PUT",
      url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/collaborators/${fx.users.outsider}`,
      headers: auth(mgrTok),
    });
    const list = (await notifsFor(fx.issues.p1issue)).filter((x) => x.type === "issue.collaborator");
    expect(list.map((x) => x.user)).toEqual([fx.users.outsider]);
  });

  test("добавление в проект → уведомление добавленному (project.member, issue_id=null)", async () => {
    const adminTok = await login(app, "admin");
    await app.inject({
      method: "PUT",
      url: `/api/projects/${fx.projects.p1}/members/${fx.users.outsider}`,
      headers: auth(adminTok),
      payload: { role: "employee" },
    });
    const rows = await q<{ user_id: string; type: string; issue_id: string | null }>(
      `SELECT user_id, type, issue_id FROM notifications WHERE type = 'project.member'`,
    );
    expect(rows).toEqual([{ user_id: fx.users.outsider, type: "project.member", issue_id: null }]);
  });
});

describe("In-app API", () => {
  test("GET /notifications + unread-count + POST /read + PATCH /prefs", async () => {
    // сгенерировать пару уведомлений для emp1 (assignee/reporter p1issue)
    const mgrTok = await login(app, "mgr1");
    await comment(fx.projects.p1, fx.issues.p1issue, mgrTok, "один");
    await comment(fx.projects.p1, fx.issues.p1issue, mgrTok, "два");

    const empTok = await login(app, "emp1");

    let res = await app.inject({ method: "GET", url: "/api/notifications", headers: auth(empTok) });
    expect(res.statusCode).toBe(200);
    let body = JSON.parse(res.body);
    expect(body.items.length).toBe(2);
    expect(body.unread).toBe(2);
    expect(body.items[0].actor.id).toBe(fx.users.mgr1);
    expect(body.items[0].payload.key).toBe("CORP-1");

    res = await app.inject({ method: "GET", url: "/api/notifications/unread-count", headers: auth(empTok) });
    expect(JSON.parse(res.body).count).toBe(2);

    // отметить одно прочитанным
    res = await app.inject({
      method: "POST",
      url: "/api/notifications/read",
      headers: auth(empTok),
      payload: { ids: [body.items[0].id] },
    });
    expect(res.statusCode).toBe(204);
    res = await app.inject({ method: "GET", url: "/api/notifications/unread-count", headers: auth(empTok) });
    expect(JSON.parse(res.body).count).toBe(1);

    // отметить всё (пустое тело)
    res = await app.inject({ method: "POST", url: "/api/notifications/read", headers: auth(empTok) });
    expect(res.statusCode).toBe(204);
    res = await app.inject({ method: "GET", url: "/api/notifications/unread-count", headers: auth(empTok) });
    expect(JSON.parse(res.body).count).toBe(0);

    // настройки
    res = await app.inject({
      method: "PATCH",
      url: "/api/notifications/prefs",
      headers: auth(empTok),
      payload: { email: "off", selfWatch: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).notifyPrefs).toMatchObject({ email: "off", selfWatch: false });

    // чужие уведомления не видны: mgr2 своей ленты — пусто
    const mgr2Tok = await login(app, "mgr2");
    res = await app.inject({ method: "GET", url: "/api/notifications", headers: auth(mgr2Tok) });
    expect(JSON.parse(res.body).items).toHaveLength(0);
  });

  test("selfWatch=false → актор не подписывается на свою задачу при комментарии", async () => {
    const empTok = await login(app, "emp1");
    await app.inject({
      method: "PATCH",
      url: "/api/notifications/prefs",
      headers: auth(empTok),
      payload: { selfWatch: false },
    });
    // emp1 комментирует ЧУЖУЮ задачу, где он не assignee/reporter/watcher — вообще
    // нет; берём p1issue где он assignee, и проверяем что доп. watcher-строки нет
    // (он и так получатель как assignee — тут проверяем именно autoWatch).
    const before = await q(`SELECT 1 FROM issue_watchers WHERE issue_id = $1 AND user_id = $2`, [
      fx.issues.p1issue,
      fx.users.mgr1,
    ]);
    expect(before).toHaveLength(0);
    const mgrTok = await login(app, "mgr1");
    await app.inject({
      method: "PATCH",
      url: "/api/notifications/prefs",
      headers: auth(mgrTok),
      payload: { selfWatch: false },
    });
    await comment(fx.projects.p1, fx.issues.p1issue, mgrTok, "не подписывай меня");
    const after = await q(`SELECT 1 FROM issue_watchers WHERE issue_id = $1 AND user_id = $2`, [
      fx.issues.p1issue,
      fx.users.mgr1,
    ]);
    expect(after).toHaveLength(0);
  });
});
