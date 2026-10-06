/** Правила повторяющихся задач и атомарные запуски (ADR-0030). */
import type { PoolClient } from "pg";
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { recordBackgroundJob, recordRecurringRun } from "../metrics.js";
import { resolveRole, roleCan, type GlobalRole, type ProjectRole } from "../permissions.js";
import { q, withAdvisoryLock, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { badRequest, notFound } from "../middleware.js";
import { LIMITS, type RecurrenceSchedule, type RecurringRuleBody, type RecurringRuleDto,
  type RecurringRulePatchBody, type RecurringRunDto } from "../contract.js";
import { validateAssigneesInProject, type IssueRow } from "./issues.js";
import { createIssueInTx } from "./issueCreate.js";
import { assertValidTiming, localDateOf, nextOccurrence, occurrencesBetween } from "./recurrence.js";
import { projectById, type ProjectRow } from "./project.js";

interface RuleRow {
  id: string; project_id: string; template_id: string; name: string; title: string | null;
  schedule: RecurrenceSchedule; time_of_day: string; time_zone: string; start_date: string;
  due_in_days: number | null; skip_if_open: boolean; owner_id: string | null;
  state: "active" | "paused"; paused_reason: "manual" | "owner_lost_access" | "invalid_timing" | "run_failed" | null;
  next_run_at: Date | null; last_run_at: Date | null; created_at: Date; updated_at: Date;
  assignee_ids: string[]; last_result: RecurringRunDto["result"] | null;
}

const RULE_SELECT = `SELECT r.*, to_char(r.time_of_day, 'HH24:MI') AS time_of_day,
  ARRAY(SELECT user_id::text FROM recurring_rule_assignees a WHERE a.rule_id = r.id ORDER BY user_id) AS assignee_ids,
  (SELECT result FROM recurring_runs run WHERE run.rule_id = r.id ORDER BY ran_at DESC, id DESC LIMIT 1) AS last_result
  FROM recurring_rules r`;

const toDto = (r: RuleRow): RecurringRuleDto => ({
  id: r.id, projectId: r.project_id, templateId: r.template_id, name: r.name, title: r.title,
  schedule: r.schedule, timeOfDay: r.time_of_day, timeZone: r.time_zone, startDate: r.start_date,
  dueInDays: r.due_in_days, skipIfOpen: r.skip_if_open, assigneeIds: r.assignee_ids, ownerId: r.owner_id,
  state: r.state, pausedReason: r.paused_reason, nextRunAt: r.next_run_at?.toISOString() ?? null,
  lastRunAt: r.last_run_at?.toISOString() ?? null, lastResult: r.last_result,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

async function loadRule(client: PoolClient, projectId: string, id: string, lock = false): Promise<RuleRow> {
  const row = (await client.query<RuleRow>(`${RULE_SELECT} WHERE r.project_id = $1 AND r.id = $2${lock ? " FOR UPDATE OF r" : ""}`,
    [projectId, id])).rows[0];
  if (!row) throw notFound("Правило повторяющихся задач не найдено");
  return row;
}

function nameConflict(error: unknown): never {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === "23505" && pg.constraint === "recurring_rules_name_uk")
    throw new ApiHttpError(409, "CONFLICT", "Правило с таким названием уже есть в проекте");
  throw error;
}

function expandedTitle(title: string, date: string): string {
  const expanded = title.replace(/\{date\}/g, date);
  if (expanded.length > LIMITS.title.max)
    throw badRequest("Название задачи после подстановки даты превышает допустимую длину");
  return expanded;
}

async function validateRule(client: PoolClient, project: ProjectRow, body: RecurringRuleBody,
  changed?: RecurringRulePatchBody, oldStartDate?: string): Promise<void> {
  assertValidTiming(body, { checkStartWindow: !changed || (changed.startDate !== undefined && changed.startDate !== oldStartDate) });
  if (!changed || changed.templateId !== undefined || changed.title !== undefined) {
    const template = (await client.query<{ id: string; title: string }>(
      `SELECT id, title FROM issue_templates WHERE id = $1 AND project_id = $2 FOR KEY SHARE`, [body.templateId, project.id],
    )).rows[0];
    if (!template) throw notFound("Шаблон задачи не найден в проекте");
    expandedTitle((body.title ?? template.title) || body.name, "2000-01-01");
  }
  if (changed && changed.assigneeIds === undefined) return;
  await validateAssigneesInProject(project.id, body.assigneeIds, client);
  const service = (await client.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND auth_source = 'service' LIMIT 1`,
    [body.assigneeIds])).rows[0];
  if (service) throw badRequest("Сервисная учётная запись не может быть исполнителем задачи");
}

async function replaceAssignees(client: PoolClient, ruleId: string, userIds: string[]): Promise<void> {
  await client.query(`DELETE FROM recurring_rule_assignees WHERE rule_id = $1`, [ruleId]);
  if (userIds.length > 0) await client.query(`INSERT INTO recurring_rule_assignees (rule_id, user_id)
    SELECT $1, user_id FROM unnest($2::uuid[]) AS input(user_id) ON CONFLICT DO NOTHING`, [ruleId, userIds]);
}

export async function listRecurringRules(projectId: string): Promise<RecurringRuleDto[]> {
  return (await q<RuleRow>(`${RULE_SELECT} WHERE r.project_id = $1 ORDER BY r.created_at, r.id`, [projectId])).map(toDto);
}

export async function createRecurringRule(project: ProjectRow, body: RecurringRuleBody, actorId: string): Promise<RecurringRuleDto> {
  try {
    return await withTransaction(async client => {
      const exists = (await client.query(`SELECT id FROM projects WHERE id = $1 FOR UPDATE`, [project.id])).rows[0];
      if (!exists) throw notFound("Проект не найден");
      const count = (await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM recurring_rules WHERE project_id = $1`, [project.id],
      )).rows[0].count;
      if (count >= LIMITS.recurring.perProject) throw new ApiHttpError(409, "RECURRING_LIMIT", "В проекте достигнут лимит правил");
      await validateRule(client, project, body);
      const nextAt = nextOccurrence(body, new Date());
      const inserted = (await client.query<{ id: string }>(
        `INSERT INTO recurring_rules (project_id, template_id, name, title, schedule, time_of_day, time_zone, start_date,
          due_in_days, skip_if_open, owner_id, next_run_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [project.id, body.templateId, body.name, body.title, JSON.stringify(body.schedule), body.timeOfDay, body.timeZone,
          body.startDate, body.dueInDays, body.skipIfOpen, actorId, nextAt],
      )).rows[0];
      await replaceAssignees(client, inserted.id, body.assigneeIds);
      return toDto(await loadRule(client, project.id, inserted.id));
    });
  } catch (error) { return nameConflict(error); }
}

export async function updateRecurringRule(project: ProjectRow, id: string, patch: RecurringRulePatchBody, actorId: string): Promise<{ rule: RecurringRuleDto; previousOwnerId: string | null }> {
  try {
    return await withTransaction(async client => {
      const old = await loadRule(client, project.id, id, true);
      const body: RecurringRuleBody = { ...toDto(old), ...patch };
      await validateRule(client, project, body, patch, old.start_date);
      // ADR-0030: последний сохранивший правило становится владельцем и автором будущих задач.
      const nextAt = old.state === "active" ? nextOccurrence(body, new Date()) : null;
      await client.query(`UPDATE recurring_rules SET template_id = $3, name = $4, title = $5, schedule = $6::jsonb,
        time_of_day = $7, time_zone = $8, start_date = $9, due_in_days = $10, skip_if_open = $11,
        owner_id = $12, next_run_at = $13, updated_at = now() WHERE id = $1 AND project_id = $2`,
        [id, project.id, body.templateId, body.name, body.title, JSON.stringify(body.schedule), body.timeOfDay, body.timeZone,
          body.startDate, body.dueInDays, body.skipIfOpen, actorId, nextAt]);
      await replaceAssignees(client, id, body.assigneeIds);
      return { rule: toDto(await loadRule(client, project.id, id)), previousOwnerId: old.owner_id };
    });
  } catch (error) { return nameConflict(error); }
}

export async function deleteRecurringRule(projectId: string, id: string): Promise<void> {
  await withTransaction(async client => {
    await loadRule(client, projectId, id, true);
    await client.query(`DELETE FROM recurring_rules WHERE id = $1 AND project_id = $2`, [id, projectId]);
  });
}

export async function pauseRecurringRule(projectId: string, id: string): Promise<RecurringRuleDto> {
  return withTransaction(async client => {
    await loadRule(client, projectId, id, true);
    await client.query(`UPDATE recurring_rules SET state = 'paused', paused_reason = 'manual',
      next_run_at = NULL, updated_at = now() WHERE id = $1 AND project_id = $2`, [id, projectId]);
    return toDto(await loadRule(client, projectId, id));
  });
}

export async function resumeRecurringRule(projectId: string, id: string, actorId: string): Promise<RecurringRuleDto> {
  return withTransaction(async client => {
    const rule = await loadRule(client, projectId, id, true);
    const nextAt = nextOccurrence(toDto(rule), new Date());
    await client.query(`UPDATE recurring_rules SET state = 'active', paused_reason = NULL,
      next_run_at = $3, owner_id = $4, updated_at = now() WHERE id = $1 AND project_id = $2`,
      [id, projectId, nextAt, actorId]);
    return toDto(await loadRule(client, projectId, id));
  });
}

interface RunRow {
  id: string; scheduled_for: Date; ran_at: Date; result: RecurringRunDto["result"]; manual: boolean;
  missed_count: number; issue_id: string | null; issue_key: string | null; error_code: string | null;
  details: { droppedAssignees?: string[] };
}
const RUN_SELECT = `SELECT run.*, i.key AS issue_key FROM recurring_runs run LEFT JOIN issues i ON i.id = run.issue_id`;
const runDto = (r: RunRow): RecurringRunDto => ({
  id: r.id, scheduledFor: r.scheduled_for.toISOString(), ranAt: r.ran_at.toISOString(), result: r.result,
  manual: r.manual, missedCount: r.missed_count, issueId: r.issue_id, issueKey: r.issue_key, errorCode: r.error_code,
  details: { droppedAssignees: r.details.droppedAssignees ?? [] },
});

export async function listRecurringRuns(projectId: string, id: string, limit = 20): Promise<RecurringRunDto[]> {
  const rule = (await q(`SELECT id FROM recurring_rules WHERE id = $1 AND project_id = $2`, [id, projectId]))[0];
  if (!rule) throw notFound("Правило повторяющихся задач не найдено");
  return (await q<RunRow>(`${RUN_SELECT} WHERE run.rule_id = $1 ORDER BY run.scheduled_for DESC, run.id DESC LIMIT $2`,
    [id, Math.min(100, Math.max(1, limit))])).map(runDto);
}

async function auditTx(client: PoolClient, action: string, ruleId: string, details: Record<string, unknown>): Promise<void> {
  await client.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, details, result)
    VALUES (NULL, $1, 'recurring_rule', $2, $3::jsonb, $4)`,
    [action, ruleId, JSON.stringify(details), action === "recurring.run_failed" ? "error" : "success"]);
}

interface RunOptions { scheduledFor: Date; now: Date; manual: boolean; missedCount: number; nextAt?: Date }
interface RunOutcome { run: RecurringRunDto | null; issue: IssueRow | null; paused: boolean; actorId: string | null }

async function advanceRule(client: PoolClient, rule: RuleRow, options: RunOptions, ran = false): Promise<void> {
  await client.query(`UPDATE recurring_rules SET next_run_at = CASE WHEN $2 THEN next_run_at ELSE $3 END,
    last_run_at = CASE WHEN $4 THEN $5 ELSE last_run_at END, updated_at = now() WHERE id = $1`,
    [rule.id, options.manual, options.nextAt ?? null, ran, options.now]);
}

async function insertedRun(client: PoolClient, id: string): Promise<RecurringRunDto> {
  return runDto((await client.query<RunRow>(`${RUN_SELECT} WHERE run.id = $1`, [id])).rows[0]);
}

/** Вызывающий уже держит FOR UPDATE правила. Задача и журнал остаются в этой транзакции. */
export async function runRule(client: PoolClient, project: ProjectRow, rule: RuleRow, options: RunOptions): Promise<RunOutcome> {
  const empty: RunOutcome = { run: null, issue: null, paused: false, actorId: rule.owner_id };
  const owner = rule.owner_id ? (await client.query<{ id: string; is_active: boolean; global_role: GlobalRole; role: ProjectRole | null }>(
    `SELECT u.id, u.is_active, u.global_role, pm.role FROM users u
     LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = $2 WHERE u.id = $1`,
    [rule.owner_id, project.id],
  )).rows[0] : null;
  const role = owner ? resolveRole({ id: owner.id, globalRole: owner.global_role },
    owner.role ? { projectId: project.id, role: owner.role } : null) : null;
  if (!owner?.is_active || !roleCan(role, "create")) {
    await client.query(`UPDATE recurring_rules SET state = 'paused', paused_reason = 'owner_lost_access',
      next_run_at = NULL, updated_at = now() WHERE id = $1`, [rule.id]);
    await auditTx(client, "recurring.auto_pause", rule.id, { reason: "owner_lost_access" });
    return { ...empty, paused: true };
  }

  if (rule.skip_if_open) {
    const open = (await client.query<{ open: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM issues i JOIN workflow_statuses ws ON ws.id = i.status_id
      WHERE i.id = (SELECT issue_id FROM recurring_runs WHERE rule_id = $1 AND result = 'created'
        ORDER BY scheduled_for DESC, ran_at DESC, id DESC LIMIT 1)
        AND i.archived_at IS NULL AND ws.category <> 'done') AS open`, [rule.id])).rows[0].open;
    if (open) {
      const run = (await client.query<{ id: string }>(`INSERT INTO recurring_runs (rule_id, scheduled_for, result, manual, missed_count)
        VALUES ($1, $2, 'skipped_open', $3, $4) ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id`,
        [rule.id, options.scheduledFor, options.manual, options.missedCount])).rows[0];
      if (!run && options.manual) throw new ApiHttpError(409, "RECURRING_ALREADY_RAN", "Правило уже запускалось в эту минуту");
      await advanceRule(client, rule, options, !!run);
      return { ...empty, run: run ? await insertedRun(client, run.id) : null };
    }
  }

  await client.query("SAVEPOINT recurring_issue_create");
  const reserved = (await client.query<{ id: string }>(`INSERT INTO recurring_runs (rule_id, scheduled_for, result, manual, missed_count)
    VALUES ($1, $2, 'created', $3, $4) ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id`,
    [rule.id, options.scheduledFor, options.manual, options.missedCount])).rows[0];
  if (!reserved) {
    if (options.manual) throw new ApiHttpError(409, "RECURRING_ALREADY_RAN", "Правило уже запускалось в эту минуту");
    await advanceRule(client, rule, options);
    await client.query("RELEASE SAVEPOINT recurring_issue_create");
    return empty;
  }
  try {
    const template = (await client.query<{ title: string; description: string; type_id: "task" | "bug" | "request";
      priority_id: "low" | "medium" | "high" | "critical"; status_id: string | null }>(
      `SELECT title, description, type_id, priority_id, status_id FROM issue_templates WHERE id = $1 AND project_id = $2`,
      [rule.template_id, project.id],
    )).rows[0];
    if (!template) throw notFound("Шаблон задачи не найден в проекте");
    const members = (await client.query<{ id: string }>(`SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[])
      AND u.is_active AND u.auth_source <> 'service'
      AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id AND pm.project_id = $2)`,
      [rule.assignee_ids, project.id])).rows;
    const present = new Set(members.map(member => member.id));
    const assigneeIds = rule.assignee_ids.filter(id => present.has(id));
    const droppedAssignees = rule.assignee_ids.filter(id => !present.has(id));
    const date = localDateOf(options.scheduledFor, rule.time_zone);
    const title = (rule.title ?? template.title) || rule.name;
    const dueDate = rule.due_in_days === null ? null
      : new Date(Date.parse(`${date}T00:00:00Z`) + rule.due_in_days * 86_400_000).toISOString().slice(0, 10);
    const issue = await createIssueInTx(client, project, {
      title: expandedTitle(title, date), description: template.description, typeId: template.type_id,
      priorityId: template.priority_id, statusId: template.status_id, assigneeIds,
      epicId: null, labels: [], complexity: null, dueDate, checklistItems: [],
      activity: { kind: "created", ruleId: rule.id, ruleName: rule.name },
    }, owner.id);
    await client.query(`UPDATE recurring_runs SET issue_id = $2, details = $3::jsonb WHERE id = $1`,
      [reserved.id, issue.id, JSON.stringify({ droppedAssignees })]);
    await advanceRule(client, rule, options, true);
    const completedRun = await insertedRun(client, reserved.id);
    await client.query("RELEASE SAVEPOINT recurring_issue_create");
    return { ...empty, issue, run: completedRun };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT recurring_issue_create");
    const code = error instanceof ApiHttpError ? error.code : "internal";
    const failed = (await client.query<{ id: string }>(`INSERT INTO recurring_runs
      (rule_id, scheduled_for, result, manual, missed_count, error_code)
      VALUES ($1, $2, 'failed', $3, $4, $5) ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id`,
      [rule.id, options.scheduledFor, options.manual, options.missedCount, code])).rows[0];
    await advanceRule(client, rule, options, !!failed);
    await auditTx(client, "recurring.run_failed", rule.id, { code, scheduledFor: options.scheduledFor.toISOString() });
    await client.query("RELEASE SAVEPOINT recurring_issue_create");
    return { ...empty, run: failed ? await insertedRun(client, failed.id) : null };
  }
}

async function afterRun(ruleId: string, outcome: RunOutcome): Promise<void> {
  if (outcome.run) recordRecurringRun(outcome.run.result);
  if (outcome.issue) await audit(outcome.actorId, "issue.create", "issue", outcome.issue.id,
    { key: outcome.issue.key, via: "recurring", ruleId });
}

export async function runRecurringNow(project: ProjectRow, id: string): Promise<RecurringRunDto> {
  const outcome = await withTransaction(async client => {
    const rule = await loadRule(client, project.id, id, true);
    const now = (await client.query<{ now: Date; scheduled: Date }>(
      `SELECT now() AS now, date_trunc('minute', now()) AS scheduled`,
    )).rows[0];
    return runRule(client, project, rule, { now: now.now, scheduledFor: now.scheduled, manual: true, missedCount: 0 });
  });
  await afterRun(id, outcome);
  if (outcome.paused) throw new ApiHttpError(409, "CONFLICT", "Владелец правила потерял право создавать задачи; правило остановлено");
  if (!outcome.run) throw new ApiHttpError(409, "RECURRING_ALREADY_RAN", "Правило уже запускалось в эту минуту");
  return outcome.run;
}

export interface RecurringStats { processed: number; created: number; skippedOpen: number; failed: number; paused: number; skipped: boolean }
const emptyStats = (skipped: boolean): RecurringStats => ({ processed: 0, created: 0, skippedOpen: 0, failed: 0, paused: 0, skipped });

interface RunAttempt { rule?: RuleRow; scheduledFor?: Date; missedCount?: number }
/** После отката изолируем неисправное правило. Изменённое параллельно правило не останавливаем. */
async function parkFailedRule(attempt: RunAttempt & { rule: RuleRow }, now: Date, error: unknown): Promise<{ ruleId: string; outcome: RunOutcome } | null> {
  const old = attempt.rule;
  return withTransaction(async client => {
    const rule = (await client.query<RuleRow>(`${RULE_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [old.id])).rows[0];
    if (!rule || rule.state !== "active" || !rule.next_run_at || rule.next_run_at.getTime() > now.getTime()
      || rule.updated_at.getTime() !== old.updated_at.getTime()
      || rule.next_run_at.getTime() !== old.next_run_at?.getTime()) return null;
    const code = error instanceof ApiHttpError ? error.code : "internal";
    const run = (await client.query<{ id: string }>(`INSERT INTO recurring_runs
      (rule_id, scheduled_for, result, missed_count, error_code) VALUES ($1, $2, 'failed', $3, $4)
      ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id`,
      [rule.id, attempt.scheduledFor ?? rule.next_run_at, attempt.missedCount ?? 0, code])).rows[0];
    await client.query(`UPDATE recurring_rules SET state = 'paused', paused_reason = 'run_failed', next_run_at = NULL,
      last_run_at = $2, updated_at = now() WHERE id = $1`, [rule.id, now]);
    await auditTx(client, "recurring.auto_pause", rule.id, { reason: "run_failed", code });
    await auditTx(client, "recurring.run_failed", rule.id, { code });
    return { ruleId: rule.id, outcome: { run: run ? await insertedRun(client, run.id) : null,
      issue: null, paused: true, actorId: rule.owner_id } };
  });
}

/** Уже под локом тика: maintenance вызывает эту функцию без второго advisory-лока. */
export async function runRecurringWork(now = new Date()): Promise<RecurringStats> {
  if (!loadConfig().recurring.enabled) return emptyStats(true);
  const stats = emptyStats(false);
  for (let processed = 0; processed < 20; processed++) {
    const attempt: RunAttempt = {};
    let result: { ruleId: string; outcome: RunOutcome } | null;
    try {
      result = await withTransaction(async client => {
        const rule = (await client.query<RuleRow>(`${RULE_SELECT}
          WHERE r.state = 'active' AND r.next_run_at <= $1 ORDER BY r.next_run_at, r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`, [now])).rows[0];
        if (!rule) return null;
        attempt.rule = rule;
        const project = await projectById(rule.project_id, client);
        if (!project) throw notFound("Проект не найден");
        const timing = toDto(rule);
        let scheduledFor: Date | null = null, count = 0, nextAt: Date;
        try {
          nextAt = nextOccurrence(timing, now);
          let from = rule.next_run_at!;
          // Короткие порции уступают event loop после простоя; задача за последнее наступление.
          const catchUpBatch = 64;
          for (;;) {
            const due = occurrencesBetween(timing, from, now, catchUpBatch);
            if (due.length === 0) break;
            count += due.length; scheduledFor = due[due.length - 1];
            if (due.length < catchUpBatch) break;
            from = new Date(scheduledFor.getTime() + 1);
            await new Promise<void>(resolve => setImmediate(resolve));
          }
        } catch (error) {
          const code = error instanceof ApiHttpError ? error.code : "internal";
          const failed = (await client.query<{ id: string }>(`INSERT INTO recurring_runs (rule_id, scheduled_for, result, error_code)
            VALUES ($1, $2, 'failed', $3) ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id`,
            [rule.id, rule.next_run_at, code])).rows[0];
          await client.query(`UPDATE recurring_rules SET state = 'paused', paused_reason = 'invalid_timing', next_run_at = NULL,
            updated_at = now(), last_run_at = $2 WHERE id = $1`, [rule.id, now]);
          await auditTx(client, "recurring.auto_pause", rule.id, { reason: "invalid_timing", code });
          await auditTx(client, "recurring.run_failed", rule.id, { code });
          return { ruleId: rule.id, outcome: { run: failed ? await insertedRun(client, failed.id) : null,
            issue: null, paused: true, actorId: rule.owner_id } as RunOutcome };
        }
        if (!scheduledFor) {
          await advanceRule(client, rule, { scheduledFor: now, now, manual: false, missedCount: 0, nextAt });
          return { ruleId: rule.id, outcome: { run: null, issue: null, paused: false, actorId: rule.owner_id } as RunOutcome };
        }
        attempt.scheduledFor = scheduledFor; attempt.missedCount = count - 1;
        return { ruleId: rule.id, outcome: await runRule(client, project, rule,
          { scheduledFor, now, manual: false, missedCount: count - 1, nextAt }) };
      });
    } catch (error) {
      if (!attempt.rule) throw error; // Сбой выбора/соединения: правило ещё не определено.
      result = await parkFailedRule({ ...attempt, rule: attempt.rule }, now, error);
      if (!result) continue; // Правило успели изменить или удалить после отката.
    }
    if (!result) break;
    stats.processed += 1;
    await afterRun(result.ruleId, result.outcome);
    if (result.outcome.paused) stats.paused += 1;
    if (result.outcome.run?.result === "created") stats.created += 1;
    if (result.outcome.run?.result === "skipped_open") stats.skippedOpen += 1;
    if (result.outcome.run?.result === "failed") stats.failed += 1;
  }
  return stats;
}

export async function runRecurringOnce(now = new Date()): Promise<RecurringStats> {
  if (!loadConfig().recurring.enabled) {
    recordBackgroundJob("recurring", "skipped");
    return emptyStats(true);
  }
  const started = performance.now();
  const locked = await withAdvisoryLock("taskira:job:recurring", { wait: false }, () => runRecurringWork(now));
  const stats = locked.acquired ? locked.value : emptyStats(true);
  recordBackgroundJob("recurring", stats.skipped ? "skipped" : "success", stats.skipped ? undefined : (performance.now() - started) / 1000);
  return stats;
}
