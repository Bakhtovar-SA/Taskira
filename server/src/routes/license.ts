/** GET /api/admin/license — статус офлайн-лицензии для «Организация → Лицензия» (ТЗ 5.9, IA §3.3).
 *  Только чтение, глобальный admin. Отдаёт разобранный статус `getLicenseStatus()` — сам токен лицензии
 *  (`instance.license_key`) наружу не уходит. Установка лицензии по-прежнему только CLI
 *  (`scripts/install-license.ts`, docs/LICENSE_KEYS.md). */
import type { FastifyInstance } from "fastify";
import { requireGlobalAdmin } from "../middleware.js";
import { getLicenseStatus, type LicenseStatus } from "../services/license.js";

export async function licenseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/license", { preHandler: requireGlobalAdmin }, async (): Promise<LicenseStatus> => getLicenseStatus());
}
