/** PUT /api/me/lang — язык, на котором человеку уходят письма и сводки (трек E, миграция 20260929T1510_users_lang.sql).
 *  Сам интерфейс живёт в браузере (taskira.lang); серверу язык нужен только для почты. Клиент сообщает его при
 *  переключении и при входе, если на сервере записан другой. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { MeLangBody } from "../contract.js";
import { q } from "../db.js";
import { requireAuth, zbody } from "../middleware.js";

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.put("/me/lang", { preHandler: requireAuth, preValidation: zbody(MeLangBody) }, async (req, reply) => {
    const { lang } = req.body as z.infer<typeof MeLangBody>;
    await q(`UPDATE users SET lang = $2 WHERE id = $1 AND lang IS DISTINCT FROM $2`, [req.user.sub, lang]);
    return reply.code(204).send();
  });
}
