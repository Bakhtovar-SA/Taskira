/** Онбординг (ТЗ 5.11).
 *  /me/onboarding* — прогресс «Начала работы» и закрытые подсказки текущего пользователя.
 *  /admin/setup*, /admin/demo-project — первичная настройка инсталляции (глобальный admin). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { requireAuth, requireGlobalAdmin, zbody, zparams, type JwtPayload } from "../middleware.js";
import { HintParams, OnboardingStepBody, SetupPatchBody, type OnboardingDto, type SetupStatusDto } from "../contract.js";
import { dismissHint, getOnboarding, hideOnboarding, markStep } from "../services/onboarding.js";
import { createDemoProject, deleteDemoProject, demoProjectId } from "../services/demoProject.js";
import { invalidateInstanceCache } from "../services/instance.js";
import { loadConfig } from "../config.js";
import { audit } from "../audit.js";

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  const uid = (req: { user: unknown }) => (req.user as JwtPayload).sub;

  app.get("/me/onboarding", { preHandler: requireAuth }, async (req): Promise<OnboardingDto> => getOnboarding(uid(req)));

  /** Только шаги, которые сервер не видит сам (тема), — остальные отмечаются от действий. */
  app.post("/me/onboarding/steps", { preHandler: requireAuth, preValidation: zbody(OnboardingStepBody) }, async (req): Promise<OnboardingDto> => {
    await markStep(uid(req), (req.body as z.infer<typeof OnboardingStepBody>).step);
    return getOnboarding(uid(req));
  });

  app.post("/me/onboarding/hide", { preHandler: requireAuth }, async (req, reply) => {
    await hideOnboarding(uid(req));
    reply.code(204).send();
  });

  app.post("/me/hints/:hintId/dismiss", { preHandler: requireAuth, preValidation: zparams(HintParams) }, async (req, reply) => {
    await dismissHint(uid(req), (req.params as z.infer<typeof HintParams>).hintId);
    reply.code(204).send();
  });

  /* ---------------------------------------------------------- первичная настройка */
  const setupStatus = async (): Promise<SetupStatusDto> => {
    const [inst, users, projects] = await Promise.all([
      one<{ name: string; setup_completed_at: string | null }>(`SELECT name, setup_completed_at FROM instance WHERE id = 1`),
      one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE is_active AND global_role <> 'admin'`),
      one<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE NOT is_demo`),
    ]);
    return {
      // Строки instance нет (сид не запускался) — настраивать нечего, не держим администратора в мастере.
      completed: inst ? inst.setup_completed_at !== null : true,
      instanceName: inst?.name ?? "",
      authMode: loadConfig().authMode,
      users: users?.n ?? 0,
      projects: projects?.n ?? 0,
      demoProjectId: await demoProjectId(),
    };
  };

  app.get("/admin/setup", { preHandler: requireGlobalAdmin }, async () => setupStatus());

  app.patch("/admin/setup", { preHandler: requireGlobalAdmin, preValidation: zbody(SetupPatchBody) }, async (req) => {
    const { instanceName } = req.body as z.infer<typeof SetupPatchBody>;
    await q(`UPDATE instance SET name = $1 WHERE id = 1`, [instanceName]);
    invalidateInstanceCache();
    await audit(uid(req), "instance.rename", "instance", null, { name: instanceName });
    return setupStatus();
  });

  app.post("/admin/setup/complete", { preHandler: requireGlobalAdmin }, async (req) => {
    await q(`UPDATE instance SET setup_completed_at = COALESCE(setup_completed_at, now()) WHERE id = 1`);
    await audit(uid(req), "instance.setup_complete", "instance", null, {});
    return setupStatus();
  });

  /* Демо-проект: без audit_log — его удаление по ТЗ не оставляет строк в БД (services/demoProject.ts). */
  app.post("/admin/demo-project", { preHandler: requireGlobalAdmin }, async (req, reply) => {
    const id = await createDemoProject(uid(req));
    reply.code(201).send({ id });
  });

  app.delete("/admin/demo-project", { preHandler: requireGlobalAdmin }, async (_req, reply) => {
    await deleteDemoProject();
    reply.code(204).send();
  });
}
