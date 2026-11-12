import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { ApiHttpError } from "../errors.js";
import { q } from "../db.js";
import type { PoolClient } from "pg";
import type { ApplicationEnabled, ApplicationId } from "../applicationContract.js";
import { workApplication } from "./work.js";
import { knowledgeApplication } from "./knowledge.js";
import { objectsApplication } from "./objects.js";

export const APPLICATIONS = [workApplication, knowledgeApplication, objectsApplication];
export interface ApplicationSettings extends ApplicationEnabled { revision: number }

export async function applicationSettings(client?: PoolClient): Promise<ApplicationSettings> {
  const sql = "SELECT revision,work,knowledge,objects FROM application_settings WHERE singleton";
  const rows = client ? (await client.query<ApplicationSettings>(`${sql} FOR SHARE`)).rows : await q<ApplicationSettings>(sql);
  if (!rows[0]) throw new Error("Application settings are missing; apply migrations");
  return rows[0];
}

export async function assertApplicationWritable(id: ApplicationId, client?: PoolClient): Promise<void> {
  if (!(await applicationSettings(client))[id])
    throw new ApiHttpError(409, "APPLICATION_DISABLED", "Приложение выключено. Существующие материалы доступны для чтения и экспорта");
}

/** Route ownership is explicit. Shared access/settings/files are deliberately outside apps. */
export function routeApplication(url: string): ApplicationId | undefined {
  const projectResource = /^\/api\/projects\/:projectId\/([^/]+)/.exec(url)?.[1];
  for (const application of APPLICATIONS) {
    if (projectResource && (application.projectResources as readonly string[]).includes(projectResource)) return application.id;
    if ("globalResources" in application && application.globalResources.some(path => url === `/api/${path}` || url.startsWith(`/api/${path}/`))) return application.id;
  }
  return undefined;
}

/** Attach after each route's own authentication and permission hooks; disabling never grants access.
 * Read-only POST queries/previews remain usable alongside GET/export endpoints. */
export function installApplicationBoundaries(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const application = routeApplication(route.url);
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!application || methods.every(method => ["GET", "HEAD", "OPTIONS"].includes(method))) return;
    if (route.url === "/api/dashboards/data" || /\/(?:preview)$/.test(route.url)) return;
    const guard: preHandlerAsyncHookHandler = async () => assertApplicationWritable(application);
    const existing = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
    route.preHandler = [...existing, guard];
  });
}
