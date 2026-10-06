/** Состояние системы и история операций доступны только сессии глобального администратора. */
import type { FastifyInstance } from "fastify";
import { OpsRunsQuery } from "../contract.js";
import { requireGlobalAdmin, zquery } from "../middleware.js";
import { getSystemStatus } from "../services/systemStatus.js";
import { getOpsRuns } from "../services/opsStatus.js";

export async function adminStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/status", { preHandler: requireGlobalAdmin }, getSystemStatus);
  app.get("/admin/ops-runs", { preHandler: requireGlobalAdmin, preValidation: zquery(OpsRunsQuery) }, async req => {
    const { kind, limit } = OpsRunsQuery.parse(req.query);
    return getOpsRuns(kind, limit);
  });
}
