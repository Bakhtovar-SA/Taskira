/** Роадмап проектов (ТЗ 5.15).
 *
 *  GET    /api/roadmap                                              — видимые проекты, вехи, зависимости
 *  PATCH  /api/projects/:projectId/roadmap                          — даты начала и цели          [editRoadmap]
 *  POST   /api/projects/:projectId/milestones                       — добавить веху               [editRoadmap]
 *  PATCH  /api/projects/:projectId/milestones/:milestoneId          — переименовать / перенести   [editRoadmap]
 *  DELETE /api/projects/:projectId/milestones/:milestoneId          — удалить веху                [editRoadmap]
 *  POST   /api/projects/:projectId/dependencies                     — проект ждёт другой проект   [editRoadmap]
 *  DELETE /api/projects/:projectId/dependencies/:sourceProjectId    — больше не ждёт              [editRoadmap]
 *
 *  Зависимостью владеет зависимый проект: право editRoadmap нужно в нём, источник должен быть лишь виден. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { notFound, requireAuth, requirePerm, zbody, zparams, type JwtPayload } from "../middleware.js";
import { auditFromRequest } from "../audit.js";
import {
  DependencyCreateBody,
  DependencyParams,
  MilestoneCreateBody,
  MilestoneParams,
  MilestonePatchBody,
  ProjectParams,
  ProjectRoadmapBody,
} from "../contract.js";
import {
  addDependency,
  addMilestone,
  getRoadmap,
  isProjectVisible,
  patchMilestone,
  patchRoadmapDates,
  removeDependency,
  removeMilestone,
} from "../services/roadmap.js";

export async function roadmapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/roadmap", { preHandler: requireAuth }, async (req) => getRoadmap(req.user.sub, req.user.globalRole === "admin"));

  const edit = requirePerm("editRoadmap");

  app.patch("/projects/:projectId/roadmap", { preHandler: edit, preValidation: [zparams(ProjectParams), zbody(ProjectRoadmapBody)] }, async (req, reply) => {
    const actor: JwtPayload = req.user;
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    const body = req.body as z.infer<typeof ProjectRoadmapBody>;
    await patchRoadmapDates(projectId, body);
    await auditFromRequest(req, "project.roadmap", "project", projectId, body);
    return reply.code(204).send();
  });

  app.post("/projects/:projectId/milestones", { preHandler: edit, preValidation: [zparams(ProjectParams), zbody(MilestoneCreateBody)] }, async (req, reply) => {
    const actor: JwtPayload = req.user;
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    const m = await addMilestone(projectId, req.body as z.infer<typeof MilestoneCreateBody>);
    await auditFromRequest(req, "project.milestone.create", "project", projectId, m);
    return reply.code(201).send(m);
  });

  app.patch(
    "/projects/:projectId/milestones/:milestoneId",
    { preHandler: edit, preValidation: [zparams(MilestoneParams), zbody(MilestonePatchBody)] },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { projectId, milestoneId } = req.params as z.infer<typeof MilestoneParams>;
      const m = await patchMilestone(projectId, milestoneId, req.body as z.infer<typeof MilestonePatchBody>);
      await auditFromRequest(req, "project.milestone.update", "project", projectId, m);
      return m;
    },
  );

  app.delete("/projects/:projectId/milestones/:milestoneId", { preHandler: edit, preValidation: zparams(MilestoneParams) }, async (req, reply) => {
    const actor: JwtPayload = req.user;
    const { projectId, milestoneId } = req.params as z.infer<typeof MilestoneParams>;
    await removeMilestone(projectId, milestoneId);
    await auditFromRequest(req, "project.milestone.delete", "project", projectId, { milestoneId });
    return reply.code(204).send();
  });

  app.post("/projects/:projectId/dependencies", { preHandler: edit, preValidation: [zparams(ProjectParams), zbody(DependencyCreateBody)] }, async (req, reply) => {
    const actor: JwtPayload = req.user;
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    const { sourceProjectId } = req.body as z.infer<typeof DependencyCreateBody>;
    // Невидимый проект неотличим от несуществующего — 404, а не 403.
    if (!(await isProjectVisible(actor.sub, req.user.globalRole === "admin", sourceProjectId))) throw notFound("Проект не найден");
    const r = await addDependency(projectId, sourceProjectId);
    if (r === "added") await auditFromRequest(req, "project.dependency.add", "project", projectId, { sourceProjectId });
    return reply.code(r === "added" ? 201 : 200).send({ sourceId: sourceProjectId, dependentId: projectId });
  });

  app.delete(
    "/projects/:projectId/dependencies/:sourceProjectId",
    { preHandler: edit, preValidation: zparams(DependencyParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { projectId, sourceProjectId } = req.params as z.infer<typeof DependencyParams>;
      await removeDependency(projectId, sourceProjectId);
      await auditFromRequest(req, "project.dependency.remove", "project", projectId, { sourceProjectId });
      return reply.code(204).send();
    },
  );
}
