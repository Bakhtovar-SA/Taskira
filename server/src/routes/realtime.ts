import type { FastifyInstance } from "fastify";
import { badRequest, forbidden, requirePerm, unauthorized } from "../middleware.js";
import { attachRealtimeLifecycle, isRealtimeCursor, readRealtimeChanges, realtimeAccess } from "../services/realtime.js";

/** Registered beneath /api/projects/:projectId. REST catch-up is also the
 *  fallback when a proxy/network does not support a stable WebSocket. */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  attachRealtimeLifecycle(app);
  app.get("/sync", { preHandler: requirePerm("browse") }, async (req, reply) => {
    const { cursor } = req.query as { cursor?: unknown };
    if (cursor !== undefined && !isRealtimeCursor(cursor)) throw badRequest("Некорректный курсор синхронизации");
    reply.header("Cache-Control", "no-store");
    const changes = await readRealtimeChanges(req.project!.id, cursor ?? null);
    // Recheck after the DB read, bypassing per-process permission/session caches.
    const access = await realtimeAccess(req.user.sub, req.user.sessionVersion, req.project!.id, !!req.authToken);
    if (access === "expired") throw unauthorized();
    if (access === "denied") throw forbidden("Нет доступа к проекту");
    return changes;
  });
}
