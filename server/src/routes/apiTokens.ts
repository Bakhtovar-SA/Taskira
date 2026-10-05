/** Personal and administrative token management accepts browser sessions only. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { ApiTokenCreateBody, ApiTokenParams, ApiTokenAdminQuery } from "../contract.js";
import { requireSession, requireGlobalAdmin, zbody, zparams, zquery } from "../middleware.js";
import { listTokens, createApiToken, revokeApiToken, listAdminTokens } from "../services/apiTokenManagement.js";

export async function apiTokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me/tokens",{ preHandler: requireSession },async (req,reply) =>
    reply.header("Cache-Control","no-store").send(await listTokens(req.user.sub)));
  app.post("/me/tokens",{ preHandler: requireSession, preValidation: zbody(ApiTokenCreateBody) },async (req,reply) => {
    const result = await createApiToken(req.user.sub,req.user.sub,false,req.body as z.infer<typeof ApiTokenCreateBody>);
    return reply.header("Cache-Control","no-store").code(201).send(result);
  });
  app.delete("/me/tokens/:id",{ preHandler: requireSession, preValidation: zparams(ApiTokenParams) },async (req,reply) => {
    await revokeApiToken((req.params as z.infer<typeof ApiTokenParams>).id,req.user.sub,req.user.sub);
    return reply.code(204).send();
  });
  app.get("/admin/tokens",{ preHandler: requireGlobalAdmin, preValidation: zquery(ApiTokenAdminQuery) },async (req,reply) =>
    reply.header("Cache-Control","no-store").send(await listAdminTokens(req.query as z.infer<typeof ApiTokenAdminQuery>)));
  app.delete("/admin/tokens/:id",{ preHandler: requireGlobalAdmin, preValidation: zparams(ApiTokenParams) },async (req,reply) => {
    await revokeApiToken((req.params as z.infer<typeof ApiTokenParams>).id,req.user.sub);
    return reply.code(204).send();
  });
}
