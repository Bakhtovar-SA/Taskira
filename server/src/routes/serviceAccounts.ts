import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { ApiTokenCreateBody, ServiceAccountCreateBody, ServiceAccountPatchBody,
  ServiceAccountParams, ServiceAccountTokenParams } from "../contract.js";
import { requireGlobalAdmin, zbody, zparams } from "../middleware.js";
import { listServiceAccounts, createServiceAccount, patchServiceAccount } from "../services/serviceAccounts.js";
import { assertServiceAccount, listTokens, createApiToken, revokeApiToken } from "../services/apiTokenManagement.js";
import { routeLimit } from "../routeLimits.js";

export async function serviceAccountRoutes(app: FastifyInstance): Promise<void> {
  const base = "/admin/service-accounts";
  app.get(base,{ preHandler: requireGlobalAdmin },async () => listServiceAccounts());
  app.post(base,{ preHandler: requireGlobalAdmin, preValidation: zbody(ServiceAccountCreateBody) },async (req,reply) =>
    reply.code(201).send(await createServiceAccount(req.user.sub,req.body as z.infer<typeof ServiceAccountCreateBody>)));
  app.patch(base+"/:id",{ preHandler: requireGlobalAdmin, preValidation: [zparams(ServiceAccountParams),zbody(ServiceAccountPatchBody)] },async req =>
    patchServiceAccount((req.params as z.infer<typeof ServiceAccountParams>).id,req.user.sub,req.body as z.infer<typeof ServiceAccountPatchBody>));
  app.get(base+"/:id/tokens",{ preHandler: requireGlobalAdmin, preValidation: zparams(ServiceAccountParams) },async (req,reply) => {
    const { id } = req.params as z.infer<typeof ServiceAccountParams>;
    await assertServiceAccount(id);
    return reply.header("Cache-Control","no-store").send(await listTokens(id));
  });
  app.post(base+"/:id/tokens",{ ...routeLimit("sensitive"), preHandler: requireGlobalAdmin, preValidation: [zparams(ServiceAccountParams),zbody(ApiTokenCreateBody)] },async (req,reply) => {
    const result = await createApiToken((req.params as z.infer<typeof ServiceAccountParams>).id,req.user.sub,true,
      req.body as z.infer<typeof ApiTokenCreateBody>);
    return reply.header("Cache-Control","no-store").code(201).send(result);
  });
  app.delete(base+"/:id/tokens/:tokenId",{ preHandler: requireGlobalAdmin, preValidation: zparams(ServiceAccountTokenParams) },async (req,reply) => {
    const { id,tokenId } = req.params as z.infer<typeof ServiceAccountTokenParams>;
    await revokeApiToken(tokenId,req.user.sub,id,true);
    return reply.code(204).send();
  });
}
