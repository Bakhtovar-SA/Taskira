import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { getApp, stopApp, resetDb, seedFixture, q, login, auth, type Fixture } from "./helpers.js";
import { reminderClock, runDueRemindersOnce, runDueRemindersTick, validDueReminderIds } from "../src/services/dueReminders.js";
let fx: Fixture;
const now = new Date("2026-10-10T04:00:00Z");
beforeAll(() => getApp());
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });
const due = async (date: string | null) => q("UPDATE issues SET due_date = $2 WHERE id = $1", [fx.issues.p1issue, date]);
const notifications = () => q<{ id: string; payload: { dueDate: string }; user_id: string }>("SELECT id, payload, user_id FROM notifications WHERE type = 'issue.dueSoon'");

test("date and hour use the installation zone, including midnight", () => {
  expect(reminderClock(new Date("2026-10-09T19:00:00Z"), "Asia/Dushanbe")).toEqual({ date: "2026-10-10", hour: 0 });
  expect(reminderClock(now, "Asia/Dushanbe")).toEqual({ date: "2026-10-10", hour: 9 });
});
test("defaults warn at 09:00, not before; repeat and concurrent ticks do not duplicate", async () => {
  await due("2026-10-11");
  expect(await runDueRemindersOnce(new Date("2026-10-10T03:59:59Z"))).toBe(0);
  const results = await Promise.all([runDueRemindersTick(now), runDueRemindersTick(now)]);
  expect(results.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(1);
  expect(await runDueRemindersOnce(now)).toBe(0);
  expect(await notifications()).toHaveLength(1);
  expect((await notifications())[0].user_id).toBe(fx.users.emp1);
});
test.each([0, 1, 3, 7])("personal interval %i is honored", async days => {
  await q("UPDATE users SET notify_prefs = $2 WHERE id = $1", [fx.users.emp1, { dueReminderDays: [days] }]);
  await due(`2026-10-${10 + days}`);
  expect(await runDueRemindersOnce(now)).toBe(1);
});
test("empty preferences disable reminders; expired and undated issues are excluded", async () => {
  await due("2026-10-10");
  await q("UPDATE users SET notify_prefs = '{\"dueReminderDays\":[]}' WHERE id = $1", [fx.users.emp1]);
  expect(await runDueRemindersOnce(now)).toBe(0);
  await q("UPDATE users SET notify_prefs = '{}' WHERE id = $1", [fx.users.emp1]);
  await due("2026-10-09"); expect(await runDueRemindersOnce(now)).toBe(0);
  await due(null); expect(await runDueRemindersOnce(now)).toBe(0);
});
test("deadline changes create a new mark and invalidate pending old mail", async () => {
  await due("2026-10-11"); await runDueRemindersOnce(now);
  const oldId = (await notifications())[0].id;
  expect(await validDueReminderIds([oldId], now)).toEqual(new Set([oldId]));
  await due("2026-10-10");
  expect(await validDueReminderIds([oldId], now)).toEqual(new Set());
  expect(await runDueRemindersOnce(now)).toBe(1);
});
test.each(["inactive", "unassigned", "archived", "done", "no-access", "disabled"])("current eligibility cancels mail and enqueue: %s", async state => {
  await due("2026-10-11"); await runDueRemindersOnce(now);
  const ids = (await notifications()).map(n => n.id);
  if (state === "inactive") await q("UPDATE users SET is_active = false WHERE id = $1", [fx.users.emp1]);
  if (state === "unassigned") await q("DELETE FROM issue_assignees WHERE issue_id = $1", [fx.issues.p1issue]);
  if (state === "archived") await q("UPDATE issues SET archived_at = now() WHERE id = $1", [fx.issues.p1issue]);
  if (state === "done") await q("UPDATE workflow_statuses SET category = 'done' WHERE id = $1", [fx.p1status.todo]);
  if (state === "no-access") {
    await q("DELETE FROM project_members WHERE user_id = $1", [fx.users.emp1]);
    await q("DELETE FROM department_members WHERE user_id = $1", [fx.users.emp1]);
  }
  if (state === "disabled") await q("UPDATE users SET notify_prefs = '{\"dueReminderDays\":[]}' WHERE id = $1", [fx.users.emp1]);
  expect(await validDueReminderIds(ids, now)).toEqual(new Set());
  await due("2026-10-10"); expect(await runDueRemindersOnce(now)).toBe(0);
});
test("multiple assignees each receive one reminder, including the reporter", async () => {
  await due("2026-10-11");
  await q("INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2)", [fx.issues.p1issue, fx.users.mgr1]);
  expect(await runDueRemindersOnce(now)).toBe(2);
});
test("preferences persist independently and reject unknown/duplicate intervals", async () => {
  const app = await getApp(), token = await login(app, "emp1");
  const request = (days: number[]) => app.inject({ method: "PATCH", url: "/api/notifications/prefs", headers: auth(token), payload: { dueReminderDays: days } });
  expect((await request([7, 3, 1, 0])).statusCode).toBe(200);
  expect((await request([])).json().notifyPrefs.dueReminderDays).toEqual([]);
  expect((await request([2])).statusCode).toBe(400);
  expect((await request([1, 1])).statusCode).toBe(400);
});


test("notification insert failure rolls back its delivery mark, then retry succeeds", async () => {
  await due("2026-10-11");
  await q("CREATE FUNCTION reject_due_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test reminder failure'; END $$");
  await q("CREATE TRIGGER reject_due_test BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_due_test()");
  try {
    await expect(runDueRemindersOnce(now)).rejects.toThrow("test reminder failure");
    expect(await q("SELECT * FROM due_reminder_deliveries")).toHaveLength(0);
  } finally {
    await q("DROP TRIGGER reject_due_test ON notifications");
    await q("DROP FUNCTION reject_due_test()");
  }
  expect(await runDueRemindersOnce(now)).toBe(1);
});
test("dismissal does not reset the durable delivery mark; only today's interval is caught up", async () => {
  await due("2026-10-11");
  expect(await runDueRemindersOnce(new Date("2026-10-10T18:00:00Z"))).toBe(1);
  await q("UPDATE notifications SET dismissed_at = now()");
  expect(await runDueRemindersOnce(now)).toBe(0);
  expect(await runDueRemindersOnce(new Date("2026-10-11T04:00:00Z"))).toBe(1);
  expect(await runDueRemindersOnce(new Date("2026-10-12T04:00:00Z"))).toBe(0);
});


test("completed batches do not starve later eligible issues", async () => {
  await due("2026-10-11");
  await q(`INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank, due_date)
    SELECT i.project_id, g, 'CORP-' || g, 't', '', i.type_id, i.status_id, i.priority_id, i.reporter_id, '{}', g, i.due_date
    FROM issues i CROSS JOIN generate_series(2, 502) g WHERE i.id = $1`, [fx.issues.p1issue]);
  await q(`INSERT INTO issue_assignees (issue_id, user_id) SELECT id, $2 FROM issues WHERE project_id = $1 AND id <> $3`, [fx.projects.p1, fx.users.emp1, fx.issues.p1issue]);
  expect(await runDueRemindersOnce(now)).toBe(500);
  expect(await runDueRemindersOnce(now)).toBe(2);
  expect(await runDueRemindersOnce(now)).toBe(0);
});
