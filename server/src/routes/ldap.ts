/** /api/ldap — диагностика подключения к LDAP/AD (глобальный admin).
 *  LDAP_MIGRATION.md Фаза 2; используется в LDAP_SETUP.md для проверки связи. */
import type { FastifyInstance } from "fastify";
import { requireGlobalAdmin } from "../middleware.js";
import { loadConfig } from "../config.js";
import { ldapPing } from "../services/ldap.js";

export async function ldapRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ping", { preHandler: requireGlobalAdmin }, async () => {
    const cfg = loadConfig();
    if (cfg.authMode !== "ldap" || !cfg.ldap) {
      return { authMode: cfg.authMode, ok: false, error: "AUTH_MODE != ldap — LDAP не сконфигурирован" };
    }
    const res = await ldapPing();
    return {
      authMode: "ldap",
      url: cfg.ldap.url,
      bind: cfg.ldap.bindDn ? "service-account" : "direct",
      ...res,
    };
  });
}
