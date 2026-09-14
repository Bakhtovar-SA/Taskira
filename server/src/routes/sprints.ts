/** Спринты проекта (sprints, миграция 023) — опциональный модуль, см.
 *  SPRINTS_MIGRATION.md. Все роуты здесь отвечают 404, если у проекта
 *  sprints_enabled=false — модуль не просто скрыт в UI, а не существует
 *  для проекта на уровне API, независимо от роли вызывающего.
 *
 *  Чтение (GET) — тем же `browse`, что доска/список задач: видеть состав
 *  спринтов может любой участник проекта. Управление (создание/старт/
 *  завершение) — `manageSprints` (admin/manager), тем же именем и набором
 *  ролей, что было в матрице до удаления модуля миграцией 012. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requirePerm, zbody, zparams } from "../middleware.js";
import { audit } from "../audit.js";
import { conflict } from "../services/workflow.js";
import {
  activateSprint,
  assertSprintsEnabled,
  completeSprint,
  countSprints,
  createSprint,
  getSprintInProject,
  listSprints,
} from "../services/sprints.js";
import { LIMITS, SprintCreateBody, SprintParams } from "../contract.js";

export async function sprintsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePerm("browse", assertSprintsEnabled) }, async (req) => {
    return listSprints(req.project!.id);
  });

  app.post(
    "/",
    { preHandler: requirePerm("manageSprints", assertSprintsEnabled), preValidation: zbody(SprintCreateBody) },
    async (req, reply) => {
      const project = req.project!;
      const body = req.body as z.infer<typeof SprintCreateBody>;

      if ((await countSprints(project.id)) >= LIMITS.sprintsPerProject) {
        throw badRequest(`В проекте не может быть больше ${LIMITS.sprintsPerProject} спринтов`);
      }
      const sprint = await createSprint(project.id, {
        name: body.name,
        goal: body.goal,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
      });
      await audit(req.user.sub, "sprint.create", "project", project.id, { sprintId: sprint.id, name: sprint.name });
      reply.code(201).send(sprint);
    },
  );

  app.post(
    "/:sprintId/start",
    { preHandler: requirePerm("manageSprints", assertSprintsEnabled), preValidation: zparams(SprintParams) },
    async (req) => {
      const project = req.project!;
      const { sprintId } = req.params as z.infer<typeof SprintParams>;

      const sprint = await getSprintInProject(project.id, sprintId);
      if (!sprint) throw notFound("Спринт не найден");
      if (sprint.status !== "future") throw badRequest("Стартовать можно только спринт в статусе «будущий»");

      try {
        const activated = await activateSprint(sprintId);
        if (!activated) throw conflict("Статус спринта уже изменился — обновите страницу");
        await audit(req.user.sub, "sprint.start", "project", project.id, { sprintId });
        return activated;
      } catch (e) {
        // uq_sprints_one_active_per_project (миграция 023) — источник истины
        // против гонки двух конкурентных «Старт спринта»; проверка status
        // выше — только быстрый честный отказ вне окна гонки, как и везде в
        // этом кодовой базе (ср. precheckParentAssignment в services/issues.ts).
        if ((e as { code?: string }).code === "23505") throw conflict("В проекте уже есть активный спринт — сначала завершите его");
        throw e;
      }
    },
  );

  app.post(
    "/:sprintId/complete",
    { preHandler: requirePerm("manageSprints", assertSprintsEnabled), preValidation: zparams(SprintParams) },
    async (req) => {
      const project = req.project!;
      const { sprintId } = req.params as z.infer<typeof SprintParams>;

      const sprint = await getSprintInProject(project.id, sprintId);
      if (!sprint) throw notFound("Спринт не найден");
      if (sprint.status !== "active") throw badRequest("Завершить можно только активный спринт");

      const result = await completeSprint(sprintId);
      if (!result) throw conflict("Статус спринта уже изменился — обновите страницу");
      await audit(req.user.sub, "sprint.complete", "project", project.id, {
        sprintId,
        movedToBacklog: result.movedToBacklog,
      });
      return result;
    },
  );
}
