/** Брендирование инсталляции (ТЗ 5.14 п.5). Чтение — публично: название, оттенок и знак нужны экрану входа до
 *  аутентификации, секретов в них нет. Запись — глобальный администратор. requiresPlan (ТЗ 4.3) сюда пока не
 *  подключён — по ТЗ 5.14 это «может в будущем стать платной функцией», не сейчас. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { badRequest, notFound, requireGlobalAdmin, zbody, type JwtPayload } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { audit } from "../audit.js";
import { BrandPatchBody } from "../contract.js";
import { getBrand, openBrandLogo, patchBrand, removeBrandLogo, setBrandLogo } from "../services/brand.js";

export async function brandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/instance/brand", async () => getBrand());

  app.get("/instance/brand/logo", async (_req, reply) => {
    const logo = await openBrandLogo();
    if (!logo) throw notFound("Знака нет");
    reply
      .header("Content-Type", logo.contentType)
      .header("X-Content-Type-Options", "nosniff")
      // Клиент версионирует ссылку ?v=<logoUpdatedAt>; новый знак — новый ключ.
      .header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(logo.stream);
  });

  app.patch("/admin/brand", { preHandler: requireGlobalAdmin, preValidation: zbody(BrandPatchBody) }, async (req) => {
    const actor: JwtPayload = req.user;
    const body = req.body as z.infer<typeof BrandPatchBody>;
    const out = await patchBrand(body);
    await audit(actor.sub, "instance.brand", "instance", null, body);
    return out;
  });

  app.post("/admin/brand/logo", { preHandler: requireGlobalAdmin }, async (req) => {
    const actor: JwtPayload = req.user;
    let buf: Buffer;
    try {
      const part = await req.file();
      if (!part) throw badRequest("Файл не приложен (поле file)");
      buf = await part.toBuffer();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") throw badRequest("Ожидается multipart/form-data с полем file");
      if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiHttpError(413, "LOGO_TOO_LARGE", "Знак слишком большой");
      throw e;
    }
    const out = await setBrandLogo(buf);
    await audit(actor.sub, "instance.brand", "instance", null, { logo: "set" });
    return out;
  });

  app.delete("/admin/brand/logo", { preHandler: requireGlobalAdmin }, async (req) => {
    const actor: JwtPayload = req.user;
    const out = await removeBrandLogo();
    await audit(actor.sub, "instance.brand", "instance", null, { logo: "removed" });
    return out;
  });
}
