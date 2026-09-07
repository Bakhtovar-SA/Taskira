/** /api/ldap — диагностика подключения и ручной ресинк членства (глобальный admin).
 *  LDAP_MIGRATION.md Фаза 2/4; ping используется в LDAP_SETUP.md. */
import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { badRequest, requireGlobalAdmin } from "../middleware.js";
import { loadConfig } from "../config.js";
import { ldapPing, ldapUserGroups } from "../services/ldap.js";
import { syncDepartmentMembership } from "../services/departmentSync.js";
import { audit } from "../audit.js";

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

    const users = await q<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE auth_source = 'ldap' ORDER BY username`,
    );
    let synced = 0;
    const notFound: string[] = [];
    const errors: string[] = [];
    for (const u of users) {
      try {
        const groups = await ldapUserGroups(u.username);
        if (groups === null) {
          notFound.push(u.username);
          continue;
        }
        await syncDepartmentMembership(u.id, groups);
        synced += 1;
      } catch (e) {
        errors.push(`${u.username}: ${(e as Error).message}`);
      }
    }
    await audit(req.user.sub, "ldap.resync", "ldap", null, { total: users.length, synced, notFound: notFound.length, errors: errors.length });
    return { total: users.length, synced, notFound, errors };
  });
}
