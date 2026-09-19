/** Аватарки пользователей — самообслуживание (миграция 027, только свой профиль,
 *  без admin-загрузки за другого — см. план). Project-less, смонтировано на
 *  уровне /api рядом с userRoutes/notificationRoutes (app.ts).
 */
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { badRequest, notFound, requireAuth, type JwtPayload } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { audit } from "../audit.js";
import { uploadAvatar, removeAvatar, getAvatarMeta, openAvatar } from "../services/avatars.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  /* ---- своя аватарка: загрузить/заменить (multipart/form-data, поле file) ---- */
  app.post("/me/avatar", { preHandler: requireAuth }, async (req, reply) => {
    const user: JwtPayload = req.user;

    let part: MultipartFile | undefined;
    try {
      part = await req.file();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") throw badRequest("Ожидается multipart/form-data с полем file");
      if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiHttpError(413, "AVATAR_TOO_LARGE", "Файл слишком большой");
      throw e;
    }
    if (!part) throw badRequest("Файл не приложен (поле file)");

    const { avatarUpdatedAt } = await uploadAvatar({ userId: user.sub, part });
    await audit(user.sub, "user.avatar.set", "user", user.sub, {});
    reply.code(200).send({ avatarUpdatedAt });
  });

  /* ---- своя аватарка: снять ---- */
  app.delete("/me/avatar", { preHandler: requireAuth }, async (req, reply) => {
    const user: JwtPayload = req.user;
    await removeAvatar(user.sub);
    await audit(user.sub, "user.avatar.remove", "user", user.sub, {});
    reply.code(204).send();
  });

  /* ---- чья угодно аватарка: отдать (карточка пользователя видна всем аутентифицированным) ---- */
  app.get("/users/:id/avatar", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound("Аватарка не найдена");

    const meta = await getAvatarMeta(id);
    if (!meta) throw notFound("Аватарка не найдена");

    reply
      .header("Content-Type", meta.contentType)
      .header("X-Content-Type-Options", "nosniff")
      // Клиент версионирует ссылку через ?v=<avatarUpdatedAt> — само содержимое
      // объекта под неизменным ключом не меняется, длинный кэш безопасен.
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(await openAvatar(meta.key));
  });
}
