import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { q, withTransaction, withAdvisoryLock } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { conflict } from "./workflow.js";
import { loadConfig } from "../config.js";
import { projectById } from "./project.js";
import { createIssueInTx } from "./issueCreate.js";
import { setAssignees, validateAssigneesInProject } from "./issues.js";
import { matches, validateGraph, stepConditionValues } from "./workspaceLogic.js";
import {
  entity,
  history,
  entityHistory,
  iso,
  linkEntities,
  modules,
  ownerCanManage,
  validateUser,
} from "./workspace.js";
import type {
  ProcessTemplateBody,
  ProcessTemplate,
  ProcessRun,
  ProcessStep,
  ProcessStartBody,
  AutomationRuleBody,
  FieldValue,
} from "../workspaceContract.js";
import type { z } from "zod";

type RunRow = {
  id: string;
  project_id: string;
  title: string;
  template_version_id: string;
  owner_id: string;
  object_id: string | null;
  parameters: Record<string, FieldValue>;
  assignee_ids: string[];
  state: ProcessRun["state"];
  error: string | null;
  created_at: Date;
};
type StepRow = {
  id: string;
  run_id: string;
  step_key: string;
  spec: ProcessStep;
  state: "waiting" | "active" | "review" | "completed" | "skipped";
  issue_id: string | null;
  approved: boolean;
  review_revision: number | null;
  issue_key?: string | null;
};
export async function validateProcess(
  projectId: string,
  spec: ProcessTemplateBody,
  client?: PoolClient,
) {
  const errors = validateGraph(spec);
  if (errors.length) throw badRequest(errors.join("; "));
  for (const step of spec.steps) {
    await validateAssigneesInProject(projectId, step.assigneeIds, client);
    for (const u of [
      ...step.assigneeIds,
      ...(step.reviewerId ? [step.reviewerId] : []),
    ])
      await validateUser(projectId, u, client);
    if (step.documentVersionId) {
      const sql = `SELECT v.id FROM workspace_document_versions v JOIN workspace_documents d ON d.id=v.document_id WHERE d.project_id=$1 AND v.id=$2`;
      const rows = client
        ? (await client.query(sql, [projectId, step.documentVersionId])).rows
        : await q(sql, [projectId, step.documentVersionId]);
      if (!rows.length) throw badRequest("Версия инструкции недоступна");
    }
  }
}
export async function templates(projectId: string): Promise<ProcessTemplate[]> {
  return (
    await q<{
      id: string;
      name: string;
      draft: ProcessTemplateBody;
      revision: number;
      published_version_id: string | null;
      archived: boolean;
    }>(
      "SELECT * FROM workspace_process_templates WHERE project_id=$1 ORDER BY name",
      [projectId],
    )
  ).map((r) => ({
    id: r.id,
    projectId,
    name: r.name,
    draft: r.draft,
    revision: r.revision,
    publishedVersionId: r.published_version_id,
    archived: r.archived,
  }));
}
export async function notifyWorkspace(
  client: PoolClient,
  projectId: string,
  actorId: string,
  userIds: string[],
  title: string,
  ref: { kind: string; id: string },
) {
  for (const uid of new Set(userIds)) {
    await validateUser(projectId, uid, client);
    await client.query(
      `INSERT INTO notifications(user_id,type,actor_id,project_id,payload,email_state) VALUES($1,'workspace',$2,$3,$4::jsonb,'skipped')`,
      [
        uid,
        actorId,
        projectId,
        JSON.stringify({ title, entityKind: ref.kind, entityId: ref.id }),
      ],
    );
  }
}
export async function startProcess(
  projectId: string,
  actor: string,
  input: z.infer<typeof ProcessStartBody>,
  client: PoolClient,
): Promise<string> {
  const existing = (
    await client.query<{ id: string }>(
      "SELECT id FROM workspace_process_runs WHERE project_id=$1 AND request_id=$2",
      [projectId, input.requestId],
    )
  ).rows[0];
  if (existing) return existing.id;
  if (!(await ownerCanManage(projectId, actor, client)))
    throw badRequest("Владелец процесса потерял права");
  const t = (
    await client.query<{
      published_version_id: string;
      spec: ProcessTemplateBody;
    }>(
      `SELECT t.published_version_id,v.spec FROM workspace_process_templates t JOIN workspace_process_versions v ON v.id=t.published_version_id WHERE t.project_id=$1 AND t.id=$2 AND NOT t.archived FOR SHARE OF t`,
      [projectId, input.templateId],
    )
  ).rows[0];
  if (!t) throw notFound("Нет опубликованной версии процесса");
  if (input.expectedVersionId !== t.published_version_id)
    throw conflict("Опубликованная версия изменилась. Обновите предпросмотр и подтвердите запуск");
  await validateProcess(projectId, t.spec, client);
  await validateAssigneesInProject(projectId, input.assigneeIds, client);
  for (const uid of input.assigneeIds)
    await validateUser(projectId, uid, client);
  if (input.objectId)
    await entity(projectId, { kind: "object", id: input.objectId }, client);
  const r = (
    await client.query<{ id: string }>(
      `INSERT INTO workspace_process_runs(project_id,title,template_version_id,owner_id,object_id,parameters,assignee_ids,request_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
      [
        projectId,
        input.title,
        t.published_version_id,
        actor,
        input.objectId,
        JSON.stringify(input.parameters),
        input.assigneeIds,
        input.requestId,
      ],
    )
  ).rows[0];
  for (const [position, s] of t.spec.steps.entries())
    await client.query(
      "INSERT INTO workspace_process_steps(run_id,step_key,spec,position) VALUES($1,$2,$3::jsonb,$4)",
      [r.id, s.key, JSON.stringify(s), position],
    );
  if (input.objectId)
    await linkEntities(
      projectId,
      { kind: "process", id: r.id },
      { kind: "object", id: input.objectId },
      actor,
      client,
    );
  await history(
    projectId,
    "process",
    r.id,
    actor,
    "process.started",
    {},
    client,
  );
  await advanceRun(client, r.id);
  return r.id;
}
export async function advanceRun(client: PoolClient, id: string) {
  const run = (
    await client.query<RunRow>(
      "SELECT * FROM workspace_process_runs WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!run || !["running", "completed"].includes(run.state)) return;
  if (!(await modules(run.project_id, client)).processes) return;
  if (!(await ownerCanManage(run.project_id, run.owner_id, client))) {
    await client.query(
      "UPDATE workspace_process_runs SET state='paused',error='Владелец потерял доступ' WHERE id=$1",
      [id],
    );
    await history(
      run.project_id,
      "process",
      id,
      run.owner_id,
      "process.paused",
      { reason: "owner_lost_access" },
      client,
    );
    return;
  }
  const steps = (
    await client.query<StepRow>(
      "SELECT * FROM workspace_process_steps WHERE run_id=$1 ORDER BY position,id FOR UPDATE",
      [id],
    )
  ).rows;
  const values: Record<string, unknown> = { ...run.parameters };
  if (run.object_id) {
    const object = (
      await client.query<{ field_values: Record<string, unknown> }>(
        "SELECT field_values FROM workspace_objects WHERE id=$1 AND project_id=$2",
        [run.object_id, run.project_id],
      )
    ).rows[0];
    for (const [key, value] of Object.entries(object?.field_values ?? {}))
      values[`object.${key}`] = value;
  }
  const results = new Map<string, Record<string, unknown>>();
  for (const s of steps) {
    if (!s.issue_id && !["waiting", "skipped"].includes(s.state)) {
      await client.query(
        "UPDATE workspace_process_runs SET state='paused',error=$2 WHERE id=$1",
        [id, `Задача этапа «${s.spec.title}» удалена. Возобновление восстановит удалённые задачи`],
      );
      await history(run.project_id, "process", id, run.owner_id,
        "process.paused", { reason: "step_issue_deleted", key: s.step_key }, client);
      return;
    }
    if (s.issue_id) {
      const i = (
        await client.query<{
          category: string;
          title: string;
          priority_id: string;
          complexity: string | null;
          workspace_result_revision: number;
        }>(
          "SELECT ws.category,i.title,i.priority_id,i.complexity,i.workspace_result_revision FROM issues i JOIN workflow_statuses ws ON ws.id=i.status_id WHERE i.id=$1",
          [s.issue_id],
        )
      ).rows[0];
      if (!i) throw badRequest("Задача этапа удалена");
      values[`${s.step_key}_completed`] = i.category === "done";
      const fields = (
        await client.query<{ name: string; value: string }>(
          "SELECT f.name,v.value FROM custom_field_values v JOIN custom_fields f ON f.id=v.custom_field_id WHERE v.issue_id=$1",
          [s.issue_id],
        )
      ).rows;
      results.set(s.step_key, Object.fromEntries(fields.map((f) => [f.name, f.value])));
      const staleResult = s.review_revision !== null &&
        s.review_revision !== i.workspace_result_revision;
      if (s.state === "completed" && (i.category !== "done" || staleResult)) {
        await client.query(
          "UPDATE workspace_process_steps SET state='active',approved=false,review_revision=NULL WHERE id=$1",
          [s.id],
        );
        await client.query(
          "UPDATE workspace_process_runs SET state='paused',error='Завершённая задача переоткрыта. Проверьте следующие этапы' WHERE id=$1", [id],
        );
        return;
      }
      if (s.state === "review" && (i.category !== "done" || staleResult)) {
        s.state = "active";
        s.approved = false;
        s.review_revision = null;
        await client.query(
          "UPDATE workspace_process_steps SET state='active',approved=false,review_revision=NULL WHERE id=$1", [s.id],
        );
      }
      if (
        (s.state === "active" || s.state === "review") &&
        i.category === "done"
      ) {
        if (s.spec.reviewerId && !s.approved) {
          if (s.state !== "review")
            await notifyWorkspace(
              client,
              run.project_id,
              run.owner_id,
              [s.spec.reviewerId],
              `Проверьте результат: ${s.spec.title}`,
              { kind: "process", id },
            );
          s.state = "review";
        } else {
          s.state = "completed";
          await history(
            run.project_id,
            "process",
            id,
            run.owner_id,
            "step.completed",
            { key: s.step_key, issueId: s.issue_id },
            client,
          );
          await client.query(
            "INSERT INTO workspace_events(project_id,type,issue_id,actor_id,data,depth) VALUES($1,'step.completed',$2,$3,$4::jsonb,1)",
            [
              run.project_id,
              s.issue_id,
              run.owner_id,
              JSON.stringify({ step: s.step_key, runId: id }),
            ],
          );
        }
        await client.query(
          "UPDATE workspace_process_steps SET state=$2,review_revision=$3 WHERE id=$1",
          [s.id, s.state, i.workspace_result_revision],
        );
      }
    }
  }
  if (run.state === "completed") return;
  const project = await projectById(run.project_id, client);
  if (!project) throw notFound();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (
        s.state !== "waiting" ||
        !s.spec.dependsOn.every((k) => {
          const dep = steps.find((v) => v.step_key === k);
          return dep && (dep.state === "completed" || dep.state === "skipped");
        })
      )
        continue;
      if (
        (s.spec.dependsOn.length > 0 &&
          s.spec.dependsOn.every(
            (k) => steps.find((v) => v.step_key === k)?.state === "skipped",
          )) ||
        !matches(s.spec.when, stepConditionValues(s.spec, values, results))
      ) {
        s.state = "skipped";
        await client.query(
          "UPDATE workspace_process_steps SET state='skipped' WHERE id=$1",
          [s.id],
        );
        changed = true;
        continue;
      }
      const due =
        s.spec.dueInDays === null
          ? null
          : new Date(Date.now() + s.spec.dueInDays * 86400000)
              .toISOString()
              .slice(0, 10);
      const issue = await createIssueInTx(
        client,
        project,
        {
          title: s.spec.title,
          description: s.spec.description,
          typeId: "task",
          priorityId: "medium",
          assigneeIds: s.spec.assigneeIds.length
            ? s.spec.assigneeIds
            : run.assignee_ids,
          labels: [],
          complexity: s.spec.complexity,
          dueDate: due,
          checklistItems: [],
        },
        run.owner_id,
      );
      s.state = "active";
      s.issue_id = issue.id;
      await client.query(
        "UPDATE workspace_process_steps SET state='active',issue_id=$2 WHERE id=$1",
        [s.id, issue.id],
      );
      await linkEntities(
        run.project_id,
        { kind: "process", id },
        { kind: "issue", id: issue.id },
        run.owner_id,
        client,
      );
      if (run.object_id)
        await linkEntities(
          run.project_id,
          { kind: "object", id: run.object_id },
          { kind: "issue", id: issue.id },
          run.owner_id,
          client,
        );
      if (s.spec.documentVersionId) {
        const d = (
          await client.query<{ document_id: string }>(
            "SELECT document_id FROM workspace_document_versions WHERE id=$1",
            [s.spec.documentVersionId],
          )
        ).rows[0];
        await linkEntities(
          run.project_id,
          { kind: "document", id: d.document_id },
          { kind: "issue", id: issue.id },
          run.owner_id,
          client,
        );
      }
      await history(
        run.project_id,
        "process",
        id,
        run.owner_id,
        "step.started",
        { key: s.step_key, issueId: issue.id },
        client,
      );
      changed = true;
    }
  }
  if (steps.every((s) => s.state === "completed" || s.state === "skipped")) {
    await client.query(
      "UPDATE workspace_process_runs SET state='completed',error=NULL WHERE id=$1",
      [id],
    );
    await history(
      run.project_id,
      "process",
      id,
      run.owner_id,
      "process.completed",
      {},
      client,
    );
  }
}
export async function getRun(
  projectId: string,
  id: string,
): Promise<ProcessRun> {
  const run = (
    await q<RunRow>(
      "SELECT * FROM workspace_process_runs WHERE project_id=$1 AND id=$2",
      [projectId, id],
    )
  )[0];
  if (!run) throw notFound();
  const steps = await q<StepRow>(
    "SELECT s.*,i.key issue_key FROM workspace_process_steps s LEFT JOIN issues i ON i.id=s.issue_id WHERE s.run_id=$1 ORDER BY s.position,s.id",
    [id],
  );
  return {
    id: run.id,
    projectId,
    title: run.title,
    templateVersionId: run.template_version_id,
    state: run.state,
    ownerId: run.owner_id,
    error: run.error,
    createdAt: iso(run.created_at),
    steps: steps.map((s) => ({
      id: s.id,
      key: s.step_key,
      title: s.spec.title,
      state: s.state,
      issueId: s.issue_id,
      issueKey: s.issue_key ?? null,
      approved: s.approved,
      reviewRevision: s.review_revision,
      reviewerId: s.spec.reviewerId,
      complexity: s.spec.complexity,
      dependsOn: s.spec.dependsOn,
    })),
    log: await entityHistory(projectId, "process", id),
  };
}
async function processEvents() {
  for (let n = 0; n < 40; n++) {
    const pending = (
      await q<{ id: string }>(
        "SELECT id FROM workspace_events WHERE processed_at IS NULL AND attempts<5 ORDER BY created_at LIMIT 1",
      )
    )[0];
    if (!pending) break;
    let failedRule: string | null = null;
    try {
      await withTransaction(async (client) => {
        const event = (
          await client.query<{
            id: string;
            project_id: string;
            issue_id: string | null;
            actor_id: string;
            type: string;
            data: Record<string, unknown>;
            root_id: string;
            depth: number;
          }>(
            "SELECT * FROM workspace_events WHERE id=$1 AND processed_at IS NULL FOR UPDATE SKIP LOCKED",
            [pending.id],
          )
        ).rows[0];
        if (!event) return;
        if (!(await modules(event.project_id, client)).processes) {
          await client.query(
            "UPDATE workspace_events SET processed_at=now(),error='module_disabled' WHERE id=$1",
            [event.id],
          );
          return;
        }
        if (event.depth >= 8)
          throw badRequest("Превышена глубина автоматизации");
        await client.query(
          "SELECT set_config('taskira.workspace_root',$1,true),set_config('taskira.workspace_depth',$2,true)",
          [event.root_id, String(event.depth + 1)],
        );
        const rules = (
          await client.query<{
            id: string;
            owner_id: string;
            spec: AutomationRuleBody;
          }>(
            "SELECT * FROM workspace_rules WHERE project_id=$1 AND enabled ORDER BY id",
            [event.project_id],
          )
        ).rows;
        for (const rule of rules) {
          if (
            rule.spec.event !== event.type ||
            !matches(rule.spec.when, {
              ...event.data,
              priorityId: event.data.priority_id,
              statusId: event.data.status_id,
            })
          )
            continue;
          if (
            !(await ownerCanManage(event.project_id, rule.owner_id, client))
          ) {
            await client.query(
              "UPDATE workspace_rules SET enabled=false,error='Владелец потерял доступ' WHERE id=$1",
              [rule.id],
            );
            continue;
          }
          failedRule = rule.id;
          const applied = (
            await client.query(
              "INSERT INTO workspace_rule_executions(event_id,rule_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
              [event.id, rule.id],
            )
          ).rows;
          if (!applied.length) continue;
          const rootCount = +(
            await client.query<{ n: string }>(
              "SELECT count(*) n FROM workspace_rule_executions x JOIN workspace_events e ON e.id=x.event_id WHERE e.root_id=$1",
              [event.root_id],
            )
          ).rows[0].n;
          if (rootCount > 100)
            throw badRequest("Превышен лимит действий автоматизации");
          const project = await projectById(event.project_id, client);
          if (!project) throw notFound();
          for (const [actionIndex, action] of rule.spec.actions.entries()) {
            let result: unknown = { applied: true };
            if (action.type === "createIssue")
              result = await createIssueInTx(
                client,
                project,
                {
                  title: action.title,
                  description: "",
                  typeId: "task",
                  priorityId: "medium",
                  assigneeIds: action.assigneeIds,
                  labels: [],
                  complexity: action.complexity,
                  checklistItems: [],
                },
                rule.owner_id,
              );
            if (action.type === "updateIssue" && event.issue_id) {
              await entity(
                event.project_id,
                { kind: "issue", id: event.issue_id },
                client,
              );
              if (action.priorityId)
                await client.query(
                  "UPDATE issues SET priority_id=$3,updated_at=now() WHERE project_id=$1 AND id=$2 AND priority_id IS DISTINCT FROM $3",
                  [event.project_id, event.issue_id, action.priorityId],
                );
              if (action.assigneeIds) {
                await validateAssigneesInProject(
                  event.project_id,
                  action.assigneeIds,
                  client,
                );
                await setAssignees(
                  event.issue_id,
                  action.assigneeIds,
                  rule.owner_id,
                  client,
                );
              }
            }
            if (action.type === "notify")
              await notifyWorkspace(
                client,
                event.project_id,
                rule.owner_id,
                action.userIds,
                action.message,
                event.issue_id
                  ? { kind: "issue", id: event.issue_id }
                  : { kind: "process", id: String(event.data.runId ?? "") },
              );
            if (action.type === "startProcess") {
              const template = (await client.query<{ published_version_id: string }>(
                "SELECT published_version_id FROM workspace_process_templates WHERE project_id=$1 AND id=$2 AND NOT archived FOR SHARE",
                [event.project_id, action.templateId],
              )).rows[0];
              if (!template?.published_version_id) throw badRequest("Нет опубликованной версии процесса");
              result = await startProcess(
                event.project_id,
                rule.owner_id,
                {
                  templateId: action.templateId,
                  expectedVersionId: template.published_version_id,
                  title: action.title,
                  objectId: null,
                  assigneeIds: [],
                  parameters: {},
                  requestId: randomUUID(),
                },
                client,
              );
            }
            await client.query(
              "INSERT INTO workspace_action_executions(execution_key,event_id,rule_id,action_index,action_type,result) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING",
              [
                `${event.id}:${rule.id}:${actionIndex}`,
                event.id,
                rule.id,
                actionIndex,
                action.type,
                JSON.stringify(result),
              ],
            );
          }
          await client.query(
            "UPDATE workspace_rules SET error=NULL WHERE id=$1",
            [rule.id],
          );
          await history(
            event.project_id,
            "rule",
            rule.id,
            rule.owner_id,
            "rule.executed",
            { eventId: event.id },
            client,
          );
        }
        const runs = (
          await client.query<{ id: string }>(
            "SELECT DISTINCT r.id FROM workspace_process_runs r JOIN workspace_process_steps s ON s.run_id=r.id WHERE r.project_id=$1 AND r.state IN ('running','completed') AND s.issue_id=$2",
            [event.project_id, event.issue_id],
          )
        ).rows;
        for (const r of runs) await advanceRun(client, r.id);
        await client.query(
          "UPDATE workspace_events SET processed_at=now(),error=NULL WHERE id=$1",
          [event.id],
        );
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Ошибка выполнения";
      await q(
        "UPDATE workspace_events SET attempts=attempts+1,error=$2,failed_rule_id=$3 WHERE id=$1",
        [pending.id, reason.slice(0, 1000), failedRule],
      );
      if (failedRule)
        await q("UPDATE workspace_rules SET error=$2 WHERE id=$1", [
          failedRule,
          reason.slice(0, 1000),
        ]);
    }
  }
}
export async function runWorkspaceOnce() {
  return withAdvisoryLock(
    "taskira:workspace-worker",
    { wait: false },
    async () => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: loadConfig().reminders.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      await q(
        `WITH due AS(INSERT INTO workspace_due_events(issue_id,due_date) SELECT i.id,i.due_date FROM issues i JOIN workspace_modules m ON m.project_id=i.project_id AND m.processes JOIN workflow_statuses s ON s.id=i.status_id WHERE i.due_date<=$1::date AND s.category<>'done' AND i.archived_at IS NULL ON CONFLICT DO NOTHING RETURNING issue_id)
      INSERT INTO workspace_events(project_id,type,issue_id,actor_id,data) SELECT i.project_id,'issue.due',i.id,i.reporter_id,to_jsonb(i) FROM issues i JOIN due ON due.issue_id=i.id`,
        [today],
      );
      await withTransaction(async (client) => {
        const due = (
          await client.query<{
            id: string;
            project_id: string;
            owner_id: string;
            title: string;
          }>(
            `WITH claimed AS (
          INSERT INTO workspace_document_reviews(document_id,version_id,valid_until)
          SELECT d.id,d.verified_version_id,d.valid_until FROM workspace_documents d
          JOIN workspace_modules m ON m.project_id=d.project_id AND m.documents
          WHERE d.owner_id IS NOT NULL AND NOT d.archived AND d.verified_version_id IS NOT NULL AND d.valid_until<=$1::date
          ON CONFLICT DO NOTHING RETURNING document_id)
          SELECT d.id,d.project_id,d.owner_id,d.title FROM workspace_documents d JOIN claimed c ON c.document_id=d.id`,
            [today],
          )
        ).rows;
        for (const d of due) {
          try {
            await validateUser(d.project_id, d.owner_id, client);
          } catch {
            continue;
          }
          await notifyWorkspace(
            client,
            d.project_id,
            d.owner_id,
            [d.owner_id],
            `Пора пересмотреть документ: ${d.title}`,
            { kind: "document", id: d.id },
          );
        }
      });
      const runs = await q<{ id: string }>(
        "SELECT r.id FROM workspace_process_runs r JOIN workspace_modules m ON m.project_id=r.project_id AND m.processes WHERE r.state='running' OR (r.state='completed' AND EXISTS (SELECT 1 FROM workspace_process_steps s WHERE s.run_id=r.id AND s.issue_id IS NULL AND s.state='completed')) ORDER BY r.created_at LIMIT 100",
      );
      for (const r of runs)
        try {
          await withTransaction((c) => advanceRun(c, r.id));
        } catch (e) {
          await q(
            "UPDATE workspace_process_runs SET state='paused',error=$2 WHERE id=$1",
            [r.id, e instanceof Error ? e.message : "Ошибка этапа"],
          );
        }
      await processEvents();
    },
  );
}
