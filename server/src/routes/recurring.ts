/** Управление правилами — manager/admin; чтение и предпросмотр — browse проекта. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { auditFromRequest } from "../audit.js";
import { loadConfig } from "../config.js";
import { requireAuth, requirePerm, zbody, zparams, zquery } from "../middleware.js";
import { RecurringPreviewBody, RecurringRuleBody, RecurringRulePatchBody, RecurringRuleParams, RecurringRunsQuery, type RecurringConfigDto } from "../contract.js";
import { assertValidTiming, nextOccurrence } from "../services/recurrence.js";
import { createRecurringRule, deleteRecurringRule, listRecurringRules, listRecurringRuns, pauseRecurringRule,
  resumeRecurringRule, runRecurringNow, updateRecurringRule } from "../services/recurring.js";

export async function recurringConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/recurring/config", { preHandler: requireAuth }, async (): Promise<RecurringConfigDto> => {
    const cfg = loadConfig();
    return { enabled: cfg.recurring.enabled, defaultTimeZone: cfg.reminders.timeZone };
  });
}

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse") }, req => listRecurringRules(req.project!.id));

  app.post("/preview", { preHandler: requirePerm("browse"), preValidation: zbody(RecurringPreviewBody) }, async req => {
    const body = req.body as z.infer<typeof RecurringPreviewBody>;
    // Предпросмотр работает и с неизменённой датой давно созданного правила.
    assertValidTiming(body, { checkStartWindow: false });
    const next: string[] = [];
    let after = new Date();
    for (let i = 0; i < 5; i++) { after = nextOccurrence(body, after); next.push(after.toISOString()); }
    return { next };
  });

  app.post("/", { preHandler: requirePerm("manageRecurring"), preValidation: zbody(RecurringRuleBody) }, async (req, reply) => {
    const rule = await createRecurringRule(req.project!, req.body as z.infer<typeof RecurringRuleBody>, req.user.sub);
    await auditFromRequest(req, "recurring.create", "recurring_rule", rule.id, { projectId: rule.projectId });
    return reply.code(201).send(rule);
  });

  app.patch("/:id", { preHandler: requirePerm("manageRecurring"), preValidation: [zparams(RecurringRuleParams), zbody(RecurringRulePatchBody)] }, async req => {
    const { id } = req.params as z.infer<typeof RecurringRuleParams>;
    const rule = await updateRecurringRule(req.project!, id, req.body as z.infer<typeof RecurringRulePatchBody>, req.user.sub);
    await auditFromRequest(req, "recurring.update", "recurring_rule", id, { projectId: rule.projectId });
    return rule;
  });

  app.delete("/:id", { preHandler: requirePerm("manageRecurring"), preValidation: zparams(RecurringRuleParams) }, async (req, reply) => {
    const { id } = req.params as z.infer<typeof RecurringRuleParams>;
    await deleteRecurringRule(req.project!.id, id);
    await auditFromRequest(req, "recurring.delete", "recurring_rule", id, { projectId: req.project!.id });
    return reply.code(204).send();
  });

  for (const action of ["pause", "resume"] as const) {
    app.post(`/:id/${action}`, { preHandler: requirePerm("manageRecurring"), preValidation: zparams(RecurringRuleParams) }, async req => {
      const { id } = req.params as z.infer<typeof RecurringRuleParams>;
      const rule = action === "pause" ? await pauseRecurringRule(req.project!.id, id)
        : await resumeRecurringRule(req.project!.id, id, req.user.sub);
      await auditFromRequest(req, `recurring.${action}`, "recurring_rule", id, { projectId: rule.projectId });
      return rule;
    });
  }

  app.post("/:id/run-now", { preHandler: requirePerm("manageRecurring"), preValidation: zparams(RecurringRuleParams) }, async (req, reply) => {
    const { id } = req.params as z.infer<typeof RecurringRuleParams>;
    const run = await runRecurringNow(req.project!, id);
    await auditFromRequest(req, "recurring.run_now", "recurring_rule", id, { projectId: req.project!.id, runId: run.id });
    return reply.code(201).send(run);
  });

  app.get("/:id/runs", { preHandler: requirePerm("browse"), preValidation: [zparams(RecurringRuleParams), zquery(RecurringRunsQuery)] }, req => {
    const { id } = req.params as z.infer<typeof RecurringRuleParams>;
    const { limit } = req.query as z.infer<typeof RecurringRunsQuery>;
    return listRecurringRuns(req.project!.id, id, limit);
  });
}
