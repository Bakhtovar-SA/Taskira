/** PUT /api/me/lang — язык, на котором человеку уходят письма и сводки (трек E, миграция 20260929T1510_users_lang.sql).
 *  Сам интерфейс живёт в браузере (taskira.lang); серверу язык нужен только для почты. Клиент сообщает его при каждом
 *  входе и переключении — побеждает последний вход. Порядок хуков как у остальных маршрутов с телом: requireAuth —
 *  preHandler, zbody — preValidation (плохое тело без входа получит 400 раньше 401 — так же, как везде). */
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
