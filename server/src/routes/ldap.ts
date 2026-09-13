/** /api/ldap — диагностика подключения и ручной ресинк членства (глобальный admin).
 *  LDAP_MIGRATION.md Фаза 2/4; ping используется в LDAP_SETUP.md. */
import type { FastifyInstance } from "fastify";
import { badRequest, requireGlobalAdmin } from "../middleware.js";
import { loadConfig } from "../config.js";
import { ldapPing } from "../services/ldap.js";
import { resyncAllLdapUsers } from "../services/departmentSync.js";

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

  /** Пересобрать department_members для всех LDAP-пользователей из их текущих
   *  групп. До фонового воркера (LDAP_MIGRATION.md D3). Может быть небыстрым. */
  app.post("/resync", { preHandler: requireGlobalAdmin }, async (req) => {
    const cfg = loadConfig();
    if (cfg.authMode !== "ldap") throw badRequest("Ресинк доступен только при AUTH_MODE=ldap");
    if (!cfg.ldap?.bindDn) throw badRequest("Ресинк требует LDAP_BIND_DN (сервис-аккаунт)");

    return resyncAllLdapUsers(req.user.sub);
  });
}
