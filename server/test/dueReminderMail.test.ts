import { beforeAll, afterAll, beforeEach, expect, test, vi } from "vitest";
vi.hoisted(() => {
  process.env.NOTIFY_EMAIL_ENABLED = "true";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1025";
  process.env.SMTP_FROM = "Taskira <noreply@taskira.test>";
  process.env.APP_BASE_URL = "https://taskira.test";
});
import { getApp, stopApp, resetDb, seedFixture, q, type Fixture } from "./helpers.js";
import { runDueRemindersOnce, reminderClock } from "../src/services/dueReminders.js";
import { runNotifierOnce, _setTransport } from "../src/services/notifier.js";
let fx: Fixture, date: string;
const send = vi.fn(async () => ({}));
beforeAll(() => getApp());
afterAll(async () => { _setTransport(null); await stopApp(); });
beforeEach(async () => {
  await resetDb(); fx = await seedFixture(); send.mockClear(); _setTransport({ sendMail: send });
  date = reminderClock(new Date(), "Asia/Dushanbe").date;
  await q("UPDATE users SET email = 'assignee@taskira.test', notify_prefs = '{\"email\":\"instant\"}' WHERE id = $1", [fx.users.emp1]);
  await q("UPDATE issues SET due_date = $2, title = 'SECRET-TITLE', description = 'SECRET-DESCRIPTION' WHERE id = $1", [fx.issues.p1issue, date]);
  await runDueRemindersOnce(new Date(`${date}T04:00:00Z`));
});
test("valid reminder sends the current route and date, never task content", async () => {
  expect((await runNotifierOnce()).sent).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
  const mail = JSON.stringify(send.mock.calls[0]);
  expect(mail).toContain(date); expect(mail).toContain("/p/CORP/issue/CORP-1");
  expect(mail).not.toContain("SECRET-TITLE"); expect(mail).not.toContain("SECRET-DESCRIPTION");
});
test.each(["deadline", "done", "unassigned", "access", "inactive", "archive", "preferences", "expired"])("pending mail is skipped after %s change", async change => {
  if (change === "deadline") await q("UPDATE issues SET due_date = due_date + 1 WHERE id = $1", [fx.issues.p1issue]);
  if (change === "done") await q("UPDATE workflow_statuses SET category = 'done' WHERE id = $1", [fx.p1status.todo]);
  if (change === "unassigned") await q("DELETE FROM issue_assignees WHERE issue_id = $1", [fx.issues.p1issue]);
  if (change === "access") { await q("DELETE FROM project_members WHERE user_id = $1", [fx.users.emp1]); await q("DELETE FROM department_members WHERE user_id = $1", [fx.users.emp1]); }
  if (change === "inactive") await q("UPDATE users SET is_active = false WHERE id = $1", [fx.users.emp1]);
  if (change === "archive") await q("UPDATE issues SET archived_at = now() WHERE id = $1", [fx.issues.p1issue]);
  if (change === "preferences") await q("UPDATE users SET notify_prefs = '{\"dueReminderDays\":[]}' WHERE id = $1", [fx.users.emp1]);
  if (change === "expired") await q("UPDATE issues SET due_date = due_date - 1 WHERE id = $1", [fx.issues.p1issue]);
  expect((await runNotifierOnce()).skipped).toBe(1); expect(send).not.toHaveBeenCalled();
  expect((await q<{email_state: string}>("SELECT email_state FROM notifications"))[0].email_state).toBe("skipped");
});
test("digest postpones delivery but stale reminders are removed without SMTP", async () => {
  await q("UPDATE users SET notify_prefs = '{\"email\":\"daily\"}' WHERE id = $1", [fx.users.emp1]);
  expect((await runNotifierOnce()).deferred).toBe(1); expect(send).not.toHaveBeenCalled();
  await q("DELETE FROM issue_assignees WHERE issue_id = $1", [fx.issues.p1issue]);
  expect((await runNotifierOnce()).skipped).toBe(1); expect(send).not.toHaveBeenCalled();
});


test("each group is revalidated after earlier SMTP delivery, not only at batch start", async () => {
  await q("INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2)", [fx.issues.p1issue, fx.users.mgr1]);
  await q("UPDATE users SET email = 'manager@taskira.test' WHERE id = $1", [fx.users.mgr1]);
  await runDueRemindersOnce(new Date(`${date}T04:00:00Z`));
  _setTransport({ sendMail: async () => {
    await q("DELETE FROM issue_assignees WHERE issue_id = $1 AND user_id = $2", [fx.issues.p1issue, fx.users.mgr1]);
    return {};
  } });
  const stats = await runNotifierOnce();
  expect(stats.sent).toBe(1); expect(stats.skipped).toBe(1);
});
test("mature digest uses saved organization branding and deadline metadata", async () => {
  await q("INSERT INTO instance (name, brand_name, brand_hue) VALUES ('Installation', 'Megafon & Team', 145)");
  await q("UPDATE users SET notify_prefs = '{\"email\":\"daily\"}', lang = 'en' WHERE id = $1", [fx.users.emp1]);
  await q("UPDATE notifications SET created_at = now() - interval '2 days'");
  expect((await runNotifierOnce()).sent).toBe(1);
  const mail = JSON.stringify(send.mock.calls[0]);
  expect(mail).toContain("Megafon &amp; Team"); expect(mail).toContain("Due date"); expect(mail).toContain(date);
});
