/** Global-admin-only project subscriptions and delivery journal (INT-05). */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import { one } from "../db.js";
import { notFound, requireGlobalAdmin, zbody, zparams, zquery } from "../middleware.js";
import { ProjectParams, WebhookCreateBody, WebhookPatchBody, WebhookParams, WebhookDeliveryParams,
  WebhookDeliveryQuery, WebhookRedeliverFailedBody } from "../contract.js";
import { integrationsConfig, listWebhooks, createWebhook, patchWebhook, deleteWebhook, rotateWebhookSecret,
  pingWebhook, listWebhookDeliveries, getWebhookDelivery, redeliverWebhook, redeliverFailedWebhooks } from "../services/webhooks.js";
import { routeLimit } from "../routeLimits.js";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/config",{ preHandler: requireGlobalAdmin },async () => integrationsConfig());
  // Проверка проекта следует после проверки роли, даже у глобального администратора.
  const projectAccess = async (req: FastifyRequest) => {
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    if (!await one(`SELECT id FROM projects WHERE id=$1`,[projectId])) throw notFound("Проект не найден");
  };
  const access = [requireGlobalAdmin,projectAccess];
  const base = "/projects/:projectId/webhooks";
  app.get(base,{ preHandler: access, preValidation: zparams(ProjectParams) },async req =>
    listWebhooks((req.params as z.infer<typeof ProjectParams>).projectId));
  app.post(base,{ preHandler: access, preValidation: [zparams(ProjectParams),zbody(WebhookCreateBody)] },async (req,reply) => {
    const { projectId } = req.params as z.infer<typeof ProjectParams>;
    const result = await createWebhook(projectId,req.user.sub,req.body as z.infer<typeof WebhookCreateBody>);
    return reply.header("Cache-Control","no-store").code(201).send(result);
  });
  app.patch(base+"/:id",{ preHandler: access, preValidation: [zparams(WebhookParams),zbody(WebhookPatchBody)] },async req => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    return patchWebhook(projectId,id,req.user.sub,req.body as z.infer<typeof WebhookPatchBody>);
  });
  app.delete(base+"/:id",{ preHandler: access, preValidation: zparams(WebhookParams) },async (req,reply) => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    await deleteWebhook(projectId,id,req.user.sub); return reply.code(204).send();
  });
  app.post(base+"/:id/rotate-secret",{ ...routeLimit("sensitive"), preHandler: access, preValidation: zparams(WebhookParams) },async (req,reply) => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    return reply.header("Cache-Control","no-store").send(await rotateWebhookSecret(projectId,id,req.user.sub));
  });
  app.post(base+"/:id/ping",{ ...routeLimit("sensitive"), preHandler: access, preValidation: zparams(WebhookParams) },async (req,reply) => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    return reply.code(202).send(await pingWebhook(projectId,id,req.user.sub));
  });
  app.get(base+"/:id/deliveries",{ preHandler: access, preValidation: [zparams(WebhookParams),zquery(WebhookDeliveryQuery)] },async req => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    return listWebhookDeliveries(projectId,id,req.query as z.infer<typeof WebhookDeliveryQuery>);
  });
  app.get(base+"/:id/deliveries/:deliveryId",{ preHandler: access, preValidation: zparams(WebhookDeliveryParams) },async req => {
    const { projectId,id,deliveryId } = req.params as z.infer<typeof WebhookDeliveryParams>;
    return getWebhookDelivery(projectId,id,deliveryId);
  });
  app.post(base+"/:id/deliveries/:deliveryId/redeliver",{ ...routeLimit("sensitive"), preHandler: access, preValidation: zparams(WebhookDeliveryParams) },async (req,reply) => {
    const { projectId,id,deliveryId } = req.params as z.infer<typeof WebhookDeliveryParams>;
    return reply.code(202).send(await redeliverWebhook(projectId,id,deliveryId,req.user.sub));
  });
  app.post(base+"/:id/redeliver-failed",{ ...routeLimit("sensitive"), preHandler: access, preValidation: [zparams(WebhookParams),zbody(WebhookRedeliverFailedBody)] },async (req,reply) => {
    const { projectId,id } = req.params as z.infer<typeof WebhookParams>;
    return reply.code(202).send(await redeliverFailedWebhooks(projectId,id,(req.body as z.infer<typeof WebhookRedeliverFailedBody>).since,req.user.sub));
  });
}
