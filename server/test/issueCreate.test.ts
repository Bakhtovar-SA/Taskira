import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { withTransaction } from "../src/db.js";
import { createIssueInTx, type CreateIssueInput } from "../src/services/issueCreate.js";
import { projectById } from "../src/services/project.js";
import { getApp, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

let fx: Fixture;
beforeAll(async () => { await getApp(); });
afterAll(stopApp);
beforeEach(async () => { await resetDb(); fx = await seedFixture(); });

const input = (overrides: Partial<CreateIssueInput> = {}): CreateIssueInput => ({
  title: "Запланированная задача", description: "Описание", typeId: "task", priorityId: "medium",
  assigneeIds: [], epicId: null, labels: ["weekly"], complexity: "simple", dueDate: "2026-10-10",
  checklistItems: ["Первый пункт", "Второй пункт"], ...overrides,
});

test("номер, ранг, исполнители, чек-лист и created записываются клиентом вызывающего", async () => {
  const project = (await projectById(fx.projects.p1))!;
  const created = await withTransaction(client => createIssueInTx(client, project,
    input({ assigneeIds: [fx.users.emp1, fx.users.emp1] }), fx.users.mgr1));
  expect(created).toMatchObject({ key: "CORP-2", num: 2, status_id: fx.p1status.todo, reporter_id: fx.users.mgr1,
    due_date: "2026-10-10", labels: ["weekly"], complexity: "simple", parent_id: null });
  expect((await q<{ user_id: string }>(`SELECT user_id FROM issue_assignees WHERE issue_id = $1`, [created.id]))
    .map(r => r.user_id)).toEqual([fx.users.emp1]);
  expect(await q(`SELECT text, position FROM checklist_items WHERE issue_id = $1 ORDER BY position`, [created.id]))
    .toEqual([{ text: "Первый пункт", position: 0 }, { text: "Второй пункт", position: 1 }]);
  expect(await q(`SELECT kind, actor_id, payload FROM activity WHERE issue_id = $1`, [created.id]))
    .toEqual([{ kind: "created", actor_id: fx.users.mgr1, payload: {} }]);
  expect((await q<{ id: string }>(`SELECT id FROM issues WHERE status_id = $1 ORDER BY rank, id`, [fx.p1status.todo]))[0].id)
    .toBe(created.id);
});

test("проверки видят статус, членство и epic в транзакции вызывающего", async () => {
  const project = (await projectById(fx.projects.p1))!;
  const created = await withTransaction(async client => {
    const status = (await client.query<{ id: string }>(
      `INSERT INTO workflow_statuses (project_id, sid, name, category, position)
       VALUES ($1, 'recurring-test', 'Новый статус', 'todo', -1) RETURNING id`, [project.id],
    )).rows[0];
    await client.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'employee')`,
      [project.id, fx.users.outsider]);
    const epic = await createIssueInTx(client, project, input({ checklistItems: [] }), fx.users.mgr1);
    const child = await createIssueInTx(client, project,
      input({ statusId: status.id, assigneeIds: [fx.users.outsider], epicId: epic.id }), fx.users.mgr1);
    expect(epic.status_id).toBe(status.id);
    expect(child).toMatchObject({ status_id: status.id, epic_id: epic.id, num: 3 });
    return child;
  });
  expect(await q(`SELECT user_id FROM issue_assignees WHERE issue_id = $1`, [created.id]))
    .toEqual([{ user_id: fx.users.outsider }]);
});

test("откат внешней транзакции убирает задачу, связанные строки и резерв номера", async () => {
  const project = (await projectById(fx.projects.p1))!;
  let createdId = "";
  await expect(withTransaction(async client => {
    const created = await createIssueInTx(client, project, input({ assigneeIds: [fx.users.emp1] }), fx.users.mgr1);
    createdId = created.id;
    throw new Error("Откат записи запуска правила");
  })).rejects.toThrow("Откат записи запуска правила");
  for (const table of ["issues", "issue_assignees", "checklist_items", "activity"]) {
    const column = table === "issues" ? "id" : "issue_id";
    expect(await q(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [createdId])).toEqual([]);
  }
  expect(await q(`SELECT next_num FROM project_counters WHERE project_id = $1`, [project.id]))
    .toEqual([{ next_num: 2 }]);
  const next = await withTransaction(client => createIssueInTx(client, project, input(), fx.users.mgr1));
  expect(next.key).toBe("CORP-2");
});

test.each(["status", "assignee", "epic"])("невалидный %s отклоняется до резервирования номера", async field => {
  const project = (await projectById(fx.projects.p1))!;
  const overrides: Partial<CreateIssueInput> = field === "status" ? { statusId: fx.issues.p2issue }
    : field === "assignee" ? { assigneeIds: [fx.users.outsider] } : { epicId: fx.issues.p2issue };
  await expect(withTransaction(client => createIssueInTx(client, project, input(overrides), fx.users.mgr1)))
    .rejects.toMatchObject({ statusCode: field === "epic" ? 404 : 400 });
  expect(await q(`SELECT next_num FROM project_counters WHERE project_id = $1`, [project.id]))
    .toEqual([{ next_num: 2 }]);
});
