import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  test,
  expect,
} from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getApp,
  stopApp,
  resetDb,
  seedFixture,
  login,
  auth,
  q,
  type Fixture,
} from "./helpers.js";
import { runWorkspaceOnce } from "../src/services/workspaceProcesses.js";
import {
  forecast,
  validateGraph,
  matches,
} from "../src/services/workspaceLogic.js";
import { ProcessTemplateBody } from "../src/workspaceContract.js";
import { remainingPlan } from "../src/services/workspacePlanning.js";
import type { ProcessRun } from "../src/workspaceContract.js";
let app: FastifyInstance, f: Fixture, tokens: Record<string, string>;
const p = () => `/api/projects/${f.projects.p1}`;
async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  who = "mgr1",
) {
  return app.inject({
    method,
    url: path,
    headers: auth(tokens[who]),
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}
beforeAll(async () => {
  app = await getApp();
});
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
  tokens = {};
  for (const who of ["admin", "mgr1", "emp1", "viw1", "outsider"])
    tokens[who] = await login(app, who);
  const r = await call("PATCH", `${p()}/workspace/modules`, {
    documents: true,
    objects: true,
    processes: true,
    planning: true,
  });
  expect(r.statusCode, r.body).toBe(200);
});
describe("workspace access and documents", () => {
  test("inherits project access and keeps existing material readable when disabled", async () => {
    const created = await call(
      "POST",
      `${p()}/documents`,
      { title: "Инструкция", template: "instruction" },
      "emp1",
    );
    expect(created.statusCode, created.body).toBe(201);
    const d = created.json();
    expect(
      (await call("GET", `${p()}/documents/${d.id}`, undefined, "outsider"))
        .statusCode,
    ).toBe(403);
    expect(
      (await call("POST", `${p()}/documents`, { title: "Denied" }, "viw1"))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "GET",
          `/api/projects/${f.projects.p2}/documents/${d.id}`,
          undefined,
          "admin",
        )
      ).statusCode,
    ).toBe(404);
    await call("PATCH", `${p()}/workspace/modules`, {
      documents: false,
      objects: false,
      processes: false,
      planning: false,
    });
    expect(
      (await call("GET", `${p()}/documents/${d.id}`, undefined, "viw1"))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("POST", `${p()}/documents`, { title: "Disabled" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call("GET", `${p()}/documents/${d.id}/export`)).statusCode,
    ).toBe(200);
  });
  test("versions, verification, restore and optimistic metadata conflicts", async () => {
    const d = (
      await call("POST", `${p()}/documents`, { title: "Регламент" })
    ).json();
    const version = (
      await call("POST", `${p()}/documents/${d.id}/versions`, {
        name: "Согласовано",
      })
    ).json();
    const verified = await call("POST", `${p()}/documents/${d.id}/verify`, {
      versionId: version.id,
      validUntil: "2027-01-01",
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const changed = (
      await call("PATCH", `${p()}/documents/${d.id}`, {
        title: "Обновлённый регламент",
        revision: verified.json().revision,
      })
    ).json();
    expect(
      (
        await call("PATCH", `${p()}/documents/${d.id}`, {
          title: "Старая правка",
          revision: 1,
        })
      ).statusCode,
    ).toBe(409);
    const restored = await call("POST", `${p()}/documents/${d.id}/restore`, {
      versionId: version.id,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().generation).toBe(changed.generation + 1);
    expect(restored.json().contentRevision).toBeGreaterThan(
      version.contentRevision,
    );
  });
  test("comments stay scoped and tasks from a passage are idempotent", async () => {
    const d = (
      await call("POST", `${p()}/documents`, { title: "Протокол" })
    ).json();
    const comment = await call(
      "POST",
      `${p()}/documents/${d.id}/comments`,
      { body: "Уточнить пункт", blockId: "block-1" },
      "emp1",
    );
    expect(comment.statusCode, comment.body).toBe(200);
    const cid = comment.json().items[0].id;
    expect(
      (
        await call(
          "PATCH",
          `${p()}/documents/${d.id}/comments/${cid}`,
          { resolved: true },
          "emp1",
        )
      ).json().items[0].resolved,
    ).toBe(true);
    const input = { title: "Внедрить регламент", requestId: randomUUID() };
    const task = await call(
      "POST",
      `${p()}/documents/${d.id}/issues`,
      input,
      "emp1",
    );
    expect(task.statusCode, task.body).toBe(200);
    const again = await call(
      "POST",
      `${p()}/documents/${d.id}/issues`,
      input,
      "emp1",
    );
    expect(again.json().id).toBe(task.json().id);
    expect(
      (await call("GET", `${p()}/entity-links?kind=document&id=${d.id}`)).json()
        .items,
    ).toHaveLength(1);
    const lib = await call(
      "GET",
      "/api/library?q=регламент",
      undefined,
      "outsider",
    );
    expect(lib.json().items).toHaveLength(0);
  });
});
describe("typed objects", () => {
  test("validates fields, membership, cross-project references and revision", async () => {
    const type = await call("POST", `${p()}/object-types`, {
      name: "Системы",
      fields: [
        { key: "check_date", name: "Проверка", type: "date", required: true },
      ],
    });
    expect(type.statusCode, type.body).toBe(201);
    const input = {
      typeId: type.json().id,
      title: "Портал",
      values: { check_date: "2026-11-10" },
    };
    const obj = await call("POST", `${p()}/objects`, input, "emp1");
    expect(obj.statusCode, obj.body).toBe(201);
    expect(
      (
        await call("POST", `${p()}/objects`, {
          ...input,
          values: { check_date: "2026-02-31" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("POST", `${p()}/objects`, {
          ...input,
          ownerId: f.users.mgr2,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          "GET",
          `/api/projects/${f.projects.p2}/objects/${obj.json().id}`,
          undefined,
          "admin",
        )
      ).statusCode,
    ).toBe(404);
    const saved = await call("PATCH", `${p()}/objects/${obj.json().id}`, {
      revision: 1,
      title: "Новый портал",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      (
        await call("PATCH", `${p()}/objects/${obj.json().id}`, {
          revision: 1,
          title: "Старая правка",
        })
      ).statusCode,
    ).toBe(409);
    const linked = await call("POST", `${p()}/entity-links`, {
      source: { kind: "object", id: obj.json().id },
      target: { kind: "issue", id: f.issues.p2issue },
    });
    expect(linked.statusCode).toBe(404);
  });
});
async function publish(steps: unknown[]) {
  const t = await call("POST", `${p()}/process-templates`, {
    name: "Проверка",
    steps,
  });
  expect(t.statusCode, t.body).toBe(201);
  const v = await call(
    "POST",
    `${p()}/process-templates/${t.json().id}/publish`,
  );
  expect(v.statusCode, v.body).toBe(200);
  return { template: { ...t.json(), publishedVersionId: v.json().id }, version: v.json() };
}
async function done(issueId: string) {
  const status = (
    await q<{ id: string }>(
      "SELECT id FROM workflow_statuses WHERE project_id=$1 AND category='done' ORDER BY position LIMIT 1",
      [f.projects.p1],
    )
  )[0];
  const r = await call("POST", `${p()}/issues/${issueId}/transition`, {
    to: status.id,
  });
  expect(r.statusCode, r.body).toBe(200);
}

describe("process review regressions", () => {
  async function start(steps: unknown[]) {
    const { template } = await publish(steps);
    const response = await call("POST", `${p()}/process-runs`, {
      templateId: template.id, expectedVersionId: template.publishedVersionId,
      title: "Regression", requestId: randomUUID(),
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ProcessRun>();
  }
  const runState = async (id: string) => (await call("GET", `${p()}/process-runs/${id}`)).json<ProcessRun>();
  async function reopen(issueId: string) {
    const response = await call("POST", `${p()}/issues/${issueId}/transition`, { to: f.p1status.inprogress });
    expect(response.statusCode, response.body).toBe(200);
  }
  test("reopened work cannot be approved and a rapid reopen/close requires a new review", async () => {
    const run = await start([
      { key: "a", title: "Review", reviewerId: f.users.emp1 },
      { key: "b", title: "After", dependsOn: ["a"] },
    ]);
    await done(run.steps[0].issueId!); await runWorkspaceOnce();
    const approve = (revision: number) => call("POST", `${p()}/process-runs/${run.id}/review`, {
      stepId: run.steps[0].id, action: "approve", reviewRevision: revision,
    }, "emp1");
    await reopen(run.steps[0].issueId!);
    expect((await approve(0)).statusCode).toBe(409);
    await runWorkspaceOnce();
    expect((await runState(run.id)).steps[0]).toMatchObject({ state: "active", approved: false });
    await done(run.steps[0].issueId!); await runWorkspaceOnce();
    const review = (await runState(run.id)).steps[0];
    expect(review).toMatchObject({ state: "review", reviewRevision: 1 });
    await reopen(run.steps[0].issueId!); await done(run.steps[0].issueId!);
    // No worker poll between the two transitions.
    expect((await approve(1)).statusCode).toBe(409);
    await runWorkspaceOnce();
    expect((await runState(run.id)).steps[1].issueId).toBeNull();
    expect((await approve(1)).statusCode).toBe(409);
    expect((await approve(2)).statusCode).toBe(200);
    expect((await runState(run.id)).steps[1].issueId).toBeTruthy();
  });
  test("a previously approved completion cannot approve the next completion cycle", async () => {
    const run = await start([
      { key: "a", title: "Review", reviewerId: f.users.emp1 },
      { key: "b", title: "After", dependsOn: ["a"] },
    ]);
    await done(run.steps[0].issueId!); await runWorkspaceOnce();
    expect((await call("POST", `${p()}/process-runs/${run.id}/review`, {
      stepId: run.steps[0].id, action: "approve", reviewRevision: 0,
    }, "emp1")).statusCode).toBe(200);
    await reopen(run.steps[0].issueId!); await done(run.steps[0].issueId!);
    await runWorkspaceOnce();
    expect((await runState(run.id)).state).toBe("paused");
    await call("POST", `${p()}/process-runs/${run.id}/control`, { action: "resume" });
    expect((await runState(run.id)).steps[0]).toMatchObject({ state: "review", approved: false, reviewRevision: 1 });
  });
  test("deleting a stage task pauses with a recovery path and resume recreates it once", async () => {
    const run = await start([{ key: "a", title: "A" }, { key: "b", title: "B", dependsOn: ["a"] }]);
    const oldId = run.steps[0].issueId!;
    const deleted = await call("DELETE", `${p()}/issues/${oldId}`);
    expect(deleted.statusCode, deleted.body).toBe(204);
    await runWorkspaceOnce(); await runWorkspaceOnce();
    const paused = await runState(run.id);
    expect(paused).toMatchObject({ state: "paused", error: expect.stringContaining("удалена") });
    expect(paused.steps[1].issueId).toBeNull();
    const resumed = (await call("POST", `${p()}/process-runs/${run.id}/control`, { action: "resume" })).json<ProcessRun>();
    expect(resumed.state).toBe("running");
    expect(resumed.steps[0].issueId).toBeTruthy();
    expect(resumed.steps[0].issueId).not.toBe(oldId);
    await runWorkspaceOnce();
    expect((await runState(run.id)).steps[0].issueId).toBe(resumed.steps[0].issueId);
    expect(resumed.log.some((entry) => entry.action === "step.recreated")).toBe(true);
    await done(resumed.steps[0].issueId!); await runWorkspaceOnce();
    expect((await runState(run.id)).steps[1].state).toBe("active");
  });
  test("unrelated parallel task fields cannot override a predecessor result", async () => {
    const run = await start([
      { key: "a", title: "A" }, { key: "b", title: "B" },
      { key: "c", title: "C", dependsOn: ["a"], when: { mode: "all", items: [{ field: "Result", op: "eq", value: "ok" }] } },
      { key: "d", title: "D", dependsOn: ["a", "b"], when: { mode: "all", items: [{ field: "step.a.Result", op: "eq", value: "ok" }] } },
      { key: "e", title: "E", dependsOn: ["a", "b"], when: { mode: "all", items: [{ field: "Result", op: "isSet" }] } },
    ]);
    const field = (await call("POST", `${p()}/custom-fields`, { name: "Result", fieldType: "text" }, "admin")).json();
    for (const [index, value] of [[0, "ok"], [1, "fail"]] as const)
      expect((await call("PUT", `${p()}/issues/${run.steps[index].issueId}/custom-fields/${field.id}`, { value })).statusCode).toBe(200);
    await done(run.steps[0].issueId!); await runWorkspaceOnce();
    expect((await runState(run.id)).steps[2].state).toBe("active");
    await done(run.steps[1].issueId!); await runWorkspaceOnce();
    const current = await runState(run.id);
    expect(current.steps[3].state).toBe("active");
    expect(current.steps[4].state).toBe("skipped");
  });
  test("deletion is detected even after the process completed", async () => {
    const run = await start([{ key: "a", title: "A" }]);
    await done(run.steps[0].issueId!); await runWorkspaceOnce();
    expect((await runState(run.id)).state).toBe("completed");
    expect((await call("DELETE", `${p()}/issues/${run.steps[0].issueId}`)).statusCode).toBe(204);
    await runWorkspaceOnce();
    expect((await runState(run.id)).state).toBe("paused");
    const response = await call("POST", `${p()}/process-runs/${run.id}/control`, { action: "resume" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().steps[0].state).toBe("active");
  });
  test("start rejects a changed publication and preserves retries of an already started request", async () => {
    const { template, version } = await publish([{ key: "a", title: "Previewed work" }]);
    const input = { templateId: template.id, expectedVersionId: version.id, title: "Pinned", requestId: randomUUID() };
    const started = await call("POST", `${p()}/process-runs`, input);
    expect(started.statusCode, started.body).toBe(201);
    const updated = await call("PATCH", `${p()}/process-templates/${template.id}`, {
      revision: template.revision + 1, spec: { name: "Changed", steps: [{ key: "b", title: "Unexpected work" }] },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const publication = await call("POST", `${p()}/process-templates/${template.id}/publish`);
    expect(publication.statusCode, publication.body).toBe(200);
    expect((await call("POST", `${p()}/process-runs`, { ...input, requestId: randomUUID() })).statusCode).toBe(409);
    expect((await call("POST", `${p()}/process-runs`, input)).json().id).toBe(started.json().id);
    const fresh = await call("POST", `${p()}/process-runs`, { ...input, expectedVersionId: publication.json().id, requestId: randomUUID() });
    expect(fresh.statusCode, fresh.body).toBe(201);
    expect(fresh.json().steps[0].title).toBe("Unexpected work");
  });
});
describe("versioned process execution", () => {
  test("creates parallel roots once, waits for review, then creates dependent work", async () => {
    const { template, version } = await publish([
      { key: "a", title: "Проверить", reviewerId: f.users.emp1 },
      { key: "b", title: "Документация" },
      { key: "c", title: "Завершить", dependsOn: ["a", "b"] },
    ]);
    const input = {
      templateId: template.id,
      expectedVersionId: template.publishedVersionId,
      title: "Портал",
      requestId: randomUUID(),
    };
    const started = await call("POST", `${p()}/process-runs`, input);
    expect(started.statusCode, started.body).toBe(201);
    const run = started.json();
    expect(run.templateVersionId).toBe(version.id);
    expect(
      run.steps.filter((s: { state: string }) => s.state === "active"),
    ).toHaveLength(2);
    expect((await call("POST", `${p()}/process-runs`, input)).json().id).toBe(
      run.id,
    );
    const a = run.steps.find((s: { key: string }) => s.key === "a"),
      b = run.steps.find((s: { key: string }) => s.key === "b");
    await done(a.issueId);
    await done(b.issueId);
    await runWorkspaceOnce();
    let state = (await call("GET", `${p()}/process-runs/${run.id}`)).json();
    expect(state.steps.find((s: { key: string }) => s.key === "a").state).toBe(
      "review",
    );
    expect(
      state.steps.find((s: { key: string }) => s.key === "c").issueId,
    ).toBeNull();
    const approved = await call(
      "POST",
      `${p()}/process-runs/${run.id}/review`,
      { stepId: a.id, reviewRevision: 0, action: "approve" },
      "emp1",
    );
    expect(approved.statusCode, approved.body).toBe(200);
    state = approved.json();
    const c = state.steps.find((s: { key: string }) => s.key === "c");
    expect(c.issueId).toBeTruthy();
    await runWorkspaceOnce();
    await runWorkspaceOnce();
    expect(
      (await call("GET", `${p()}/process-runs/${run.id}`))
        .json()
        .steps.find((s: { key: string }) => s.key === "c").issueId,
    ).toBe(c.issueId);
    await done(c.issueId);
    await runWorkspaceOnce();
    expect(
      (await call("GET", `${p()}/process-runs/${run.id}`)).json().state,
    ).toBe("completed");
  });
  test("rejects cyclic templates and pauses after owner loses permission", async () => {
    expect(
      (
        await call("POST", `${p()}/process-templates`, {
          name: "Цикл",
          steps: [
            { key: "a", title: "A", dependsOn: ["b"] },
            { key: "b", title: "B", dependsOn: ["a"] },
          ],
        })
      ).statusCode,
    ).toBe(400);
    const { template } = await publish([
      { key: "a", title: "Первый" },
      { key: "b", title: "Второй", dependsOn: ["a"] },
    ]);
    const run = (
      await call("POST", `${p()}/process-runs`, {
        templateId: template.id,
      expectedVersionId: template.publishedVersionId,
        title: "Запуск",
        requestId: randomUUID(),
      })
    ).json();
    await q("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [
      f.projects.p1,
      f.users.mgr1,
    ]);
    await runWorkspaceOnce();
    expect(
      (
        await call("GET", `${p()}/process-runs/${run.id}`, undefined, "admin")
      ).json().state,
    ).toBe("paused");
  });
  test("rules survive event replays without duplicate actions", async () => {
    const rule = await call("POST", `${p()}/automation-rules`, {
      name: "Проверка результата",
      event: "issue.created",
      when: {
        mode: "all",
        items: [{ field: "title", op: "eq", value: "Исходная" }],
      },
      actions: [{ type: "createIssue", title: "Проверить результат" }],
      enabled: true,
    });
    expect(rule.statusCode, rule.body).toBe(200);
    const created = await call("POST", `${p()}/issues`, {
      title: "Исходная",
      description: "",
      typeId: "task",
      priorityId: "medium",
      assigneeIds: [],
      epicId: null,
      labels: [],
      complexity: null,
    });
    expect(created.statusCode, created.body).toBe(201);
    await runWorkspaceOnce();
    const count = () =>
      q<{ n: string }>(
        "SELECT count(*) n FROM issues WHERE project_id=$1 AND title='Проверить результат'",
        [f.projects.p1],
      );
    expect(+(await count())[0].n).toBe(1);
    await q("UPDATE workspace_events SET processed_at=NULL WHERE issue_id=$1", [
      created.json().id,
    ]);
    await runWorkspaceOnce();
    expect(+(await count())[0].n).toBe(1);
    const executions = await call(
      "GET",
      `${p()}/automation-rules/${rule.json().id}/executions`,
    );
    expect(executions.statusCode, executions.body).toBe(200);
    expect(executions.json().items).toHaveLength(1);
    expect(executions.json().items[0].actions).toHaveLength(1);
    expect(executions.json().items[0].actions[0].key).toContain(rule.json().id);
  });
});
describe("planning isolation and statistics", () => {
  test("saving a scenario never edits tasks and missing history has no dates", async () => {
    const item = {
      kind: "issue",
      id: f.issues.p1issue,
      title: "Проверка",
      complexity: null,
      dependsOn: [],
    };
    const plan = await call("POST", `${p()}/plans`, {
      name: "Основной",
      items: [item],
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const scenario = await call("POST", `${p()}/plans`, {
      name: "Срочная работа",
      planId: plan.json().id,
      items: [],
    });
    expect(scenario.statusCode, scenario.body).toBe(201);
    expect(
      (await call("GET", `${p()}/plans/${plan.json().id}/forecast`)).json(),
    ).toMatchObject({
      sufficientHistory: false,
      medianWeek: null,
      p80Week: null,
    });
    expect(
      (
        await q<{ title: string }>("SELECT title FROM issues WHERE id=$1", [
          f.issues.p1issue,
        ])
      )[0].title,
    ).toBe("t");
  });
  test("forecast is reproducible and counts an issue once", () => {
    const asOf = new Date("2026-11-09T00:00:00Z"),
      history = Array.from({ length: 40 }, (_, i) => ({
        id: String(i),
        complexity: "simple",
        completedAt: new Date(
          +asOf - (Math.floor(i / 5) + 1) * 7 * 86400000,
        ).toISOString(),
      }));
    const items = Array.from({ length: 10 }, (_, i) => ({
      kind: "issue" as const,
      id: randomUUID(),
      title: String(i),
      complexity: "simple" as const,
      dependsOn: [],
    }));
    const result = forecast(items, history, asOf, 12);
    expect(result.sufficientHistory).toBe(true);
    expect(result.samples).toBe(10000);
    expect(result).toEqual(forecast(items, [...history, ...history], asOf, 12));
    expect(
      forecast([{ ...items[0], complexity: "hard" }], history, asOf).medianWeek,
    ).toBeNull();
  });
  test("conditions and graph checks do not execute user input", () => {
    expect(
      matches(
        {
          mode: "all",
          items: [{ field: "priorityId", op: "eq", value: "high" }],
        },
        { priorityId: "high" },
      ),
    ).toBe(true);
    expect(
      validateGraph(
        ProcessTemplateBody.parse({
          name: "A",
          steps: [{ key: "a", title: "A" }],
        }),
      ),
    ).toEqual([]);
  });
});

test("conditional branches rejoin and reopens pause a completed run", async () => {
  const { template } = await publish([
    {
      key: "a",
      title: "Accept",
      when: { mode: "all", items: [{ field: "route", op: "eq", value: "a" }] },
    },
    {
      key: "b",
      title: "Reject",
      when: { mode: "all", items: [{ field: "route", op: "eq", value: "b" }] },
    },
    { key: "join", title: "Join", dependsOn: ["a", "b"] },
  ]);
  const started = await call("POST", `${p()}/process-runs`, {
    templateId: template.id,
      expectedVersionId: template.publishedVersionId,
    title: "Branches",
    parameters: { route: "a" },
    requestId: randomUUID(),
  });
  expect(started.statusCode, started.body).toBe(201);
  let run = started.json();
  expect(run.steps.find((s: { key: string }) => s.key === "b").state).toBe(
    "skipped",
  );
  await done(run.steps.find((s: { key: string }) => s.key === "a").issueId);
  await runWorkspaceOnce();
  run = (await call("GET", `${p()}/process-runs/${run.id}`)).json();
  const join = run.steps.find((s: { key: string }) => s.key === "join");
  expect(join.state).toBe("active");
  await done(join.issueId);
  await runWorkspaceOnce();
  const reopened = await call(
    "POST",
    `${p()}/issues/${join.issueId}/transition`,
    { to: f.p1status.inprogress },
  );
  expect(reopened.statusCode, reopened.body).toBe(200);
  await runWorkspaceOnce();
  run = (await call("GET", `${p()}/process-runs/${run.id}`)).json();
  expect(run.state).toBe("paused");
  expect(run.steps.find((s: { key: string }) => s.key === "join").state).toBe(
    "active",
  );
  expect(
    (
      await call("POST", `${p()}/process-runs/${run.id}/control`, {
        action: "resume",
      })
    ).statusCode,
  ).toBe(200);
});

test("saved future steps materialise once and completed dependencies disappear from a forecast", async () => {
  const { template } = await publish([
    { key: "a", title: "A" },
    { key: "b", title: "B", dependsOn: ["a"] },
  ]);
  const run = (
    await call("POST", `${p()}/process-runs`, {
      templateId: template.id,
      expectedVersionId: template.publishedVersionId,
      title: "Plan",
      requestId: randomUUID(),
    })
  ).json();
  const work = (await call("GET", `${p()}/plans/work-items`)).json().items;
  const b = run.steps.find((s: { key: string }) => s.key === "b"),
    a = run.steps.find((s: { key: string }) => s.key === "a");
  expect(work.find((i: { id: string }) => i.id === b.id).dependsOn).toContain(
    a.issueId,
  );
  await done(a.issueId);
  await runWorkspaceOnce();
  const fresh = (await call("GET", `${p()}/process-runs/${run.id}`)).json(),
    issueId = fresh.steps.find((s: { key: string }) => s.key === "b").issueId;
  const items = [
    {
      kind: "issue" as const,
      id: a.issueId,
      title: "A",
      complexity: null,
      dependsOn: [],
    },
    {
      kind: "step" as const,
      id: b.id,
      title: "B",
      complexity: null,
      dependsOn: [a.issueId],
    },
    {
      kind: "issue" as const,
      id: issueId,
      title: "B",
      complexity: null,
      dependsOn: [],
    },
  ];
  const remaining = await remainingPlan(f.projects.p1, items);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].id).toBe(issueId);
  expect(remaining[0].dependsOn).toEqual([]);
  expect(forecast([], []).medianWeek).toBeNull();
});

test("document review reminders are durable and field changes enter the internal outbox", async () => {
  const d = (
    await call("POST", `${p()}/documents`, {
      title: "Review",
      ownerId: f.users.mgr1,
    })
  ).json();
  const v = (await call("GET", `${p()}/documents/${d.id}/versions`)).json()
    .items[0];
  expect(
    (
      await call("POST", `${p()}/documents/${d.id}/verify`, {
        versionId: v.id,
        validUntil: "2020-01-01",
      })
    ).statusCode,
  ).toBe(200);
  await runWorkspaceOnce();
  await runWorkspaceOnce();
  expect(
    (
      await q<{ n: string }>(
        "SELECT count(*)::text n FROM notifications WHERE payload->>'entityId'=$1",
        [d.id],
      )
    )[0].n,
  ).toBe("1");
  const createdField = await call(
    "POST",
    `${p()}/custom-fields`,
    { name: "Risk", fieldType: "text" },
    "admin",
  );
  expect(createdField.statusCode, createdField.body).toBe(201);
  const field = createdField.json();
  expect(
    (
      await call(
        "PUT",
        `${p()}/issues/${f.issues.p1issue}/custom-fields/${field.id}`,
        { value: "high" },
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await q<{ n: string }>(
        "SELECT count(*)::text n FROM workspace_events WHERE data->>'Risk'='high'",
        [],
      )
    )[0].n,
  ).toBe("1");
});

test("register filters preserve typed sorting and reject keys outside the selected type", async () => {
  const type = (
    await call("POST", `${p()}/object-types`, {
      name: "Systems",
      fields: [
        { key: "review", name: "Review", type: "date" },
        { key: "size", name: "Size", type: "number" },
      ],
    })
  ).json();
  for (const [title, size, review] of [
    ["A", 10, "2027-01-01"],
    ["B", 2, "2026-12-01"],
  ])
    expect(
      (
        await call("POST", `${p()}/objects`, {
          typeId: type.id,
          title,
          values: { size, review },
        })
      ).statusCode,
    ).toBe(201);
  const sorted = await call(
    "GET",
    `${p()}/objects?typeId=${type.id}&sort=field:size`,
  );
  expect(sorted.statusCode, sorted.body).toBe(200);
  expect(sorted.json().items.map((i: { title: string }) => i.title)).toEqual([
    "B",
    "A",
  ]);
  const filtered = await call(
    "GET",
    `${p()}/objects?typeId=${type.id}&field=review&before=2026-12-20`,
  );
  expect(filtered.json().items).toHaveLength(1);
  expect(
    (await call("GET", `${p()}/objects?typeId=${type.id}&sort=field:unknown`))
      .statusCode,
  ).toBe(400);
});

test("installation export includes disabled workspace materials and durable state", async () => {
  const { seedWorkspace } = await import("./access/workspaceFixture.js");
  const token = await login(app, "admin"),
    fixture = await seedWorkspace(app, f.projects.p1, token, f.users.mgr1);
  await call("PATCH", `${p()}/workspace/modules`, {
    documents: false,
    objects: false,
    processes: false,
    planning: false,
  });
  const response = await call("GET", "/api/admin/export", undefined, "admin");
  expect(response.statusCode, response.body).toBe(200);
  const rows = response.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(rows).toContainEqual(
    expect.objectContaining({
      type: "workspaceDocument",
      id: fixture.workspaceDocument,
      contentJson: expect.any(Object),
      content: expect.objectContaining({
        type: "Buffer",
        data: expect.any(Array),
      }),
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      type: "workspaceObject",
      id: fixture.workspaceObject,
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      type: "workspaceProcessRun",
      id: fixture.workspaceRun,
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      type: "workspacePlan",
      id: fixture.workspacePlan,
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      type: "workspaceEvent",
      id: fixture.workspaceEvent,
      eventType: expect.any(String),
    }),
  );
  expect(rows.find((row) => row.type === "workspaceModules")).toMatchObject({
    documents: false,
    objects: false,
    processes: false,
    planning: false,
  });
});
