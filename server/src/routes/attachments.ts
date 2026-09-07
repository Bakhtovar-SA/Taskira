/** Вложения к задачам: список / загрузка (multipart) / скачивание / удаление.
 *  Смонтировано под /api/projects/:projectId/issues (prefix "/issues"), рядом с
 *  commentRoutes. Видимость наследуется от задачи — все эндпоинты идут через
 *  requireIssuePerm (FILES_MIGRATION.md D4/D5, Фаза 2).
 */
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart"; // подтягивает типы req.file()
import { forbidden, notFound, badRequest, requireIssuePerm, type JwtPayload } from "../middleware.js";
import { ApiHttpError } from "../errors.js";
import { audit } from "../audit.js";
import {
  listAttachments,
  createAttachment,
  getAttachmentInIssue,
  openAttachment,
  deleteAttachment,
  canDeleteAttachment,
} from "../services/attachments.js";

// :attId проверяем инлайн (а не zparams) → 404, как requireIssuePerm делает с :id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Потенциально исполняемые в браузере типы — отдаём как загрузку, не inline (D5). */
const ACTIVE_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml", "application/xml"]);

/** Значение для Content-Disposition filext=... — ASCII-safe запасной вариант. */
const asciiName = (s: string): string => s.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  /* ---- список вложений задачи ---- */
  app.get("/:id/attachments", { preHandler: requireIssuePerm("browse") }, async (req) => {
    return listAttachments(req.issueRef!.id);
  });

  /* ---- загрузка (multipart/form-data, поле file) ---- */
  app.post("/:id/attachments", { preHandler: requireIssuePerm("comment") }, async (req, reply) => {
    const user: JwtPayload = req.user;
    const issue = req.issueRef!;
    const project = req.project!;

    let part: MultipartFile | undefined;
    try {
      part = await req.file();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") throw badRequest("Ожидается multipart/form-data с полем file");
      if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiHttpError(413, "ATTACHMENT_TOO_LARGE", "Файл слишком большой");
      throw e;
    }
    if (!part) throw badRequest("Файл не приложен (поле file)");

    const dto = await createAttachment({ issueId: issue.id, userId: user.sub, part });
    await audit(user.sub, "attachment.add", "issue", issue.id, {
      projectId: project.id,
      attId: dto.id,
      filename: dto.filename,
      byteSize: dto.byteSize,
      viaCollaborator: req.isCollaborator || undefined,
    });
    reply.code(201).send(dto);
  });

  /* ---- скачивание: стрим через API после проверки прав (D5) ---- */
  app.get("/:id/attachments/:attId", { preHandler: requireIssuePerm("browse") }, async (req, reply) => {
    const issue = req.issueRef!;
    const { attId } = req.params as { attId: string };
    if (!UUID_RE.test(attId)) throw notFound("Вложение не найдено");

    // IDOR: вложение обязано принадлежать ИМЕННО этой задаче (уже сверенной с :projectId)
    const row = await getAttachmentInIssue(issue.id, attId);
    if (!row) throw notFound("Вложение не найдено");

    const ct = ACTIVE_TYPES.has(row.content_type) ? "application/octet-stream" : row.content_type;
    reply
      .header("Content-Type", ct)
      .header(
        "Content-Disposition",
        `attachment; filename="${asciiName(row.filename)}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      )
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .header("Content-Length", row.byte_size);
    return reply.send(await openAttachment(row));
  });

  /* ---- удаление: свой файл всегда, чужой — по праву delete (D2) ---- */
  app.delete("/:id/attachments/:attId", { preHandler: requireIssuePerm("browse") }, async (req, reply) => {
    const issue = req.issueRef!;
    const project = req.project!;
    const { attId } = req.params as { attId: string };
    if (!UUID_RE.test(attId)) throw notFound("Вложение не найдено");

    const row = await getAttachmentInIssue(issue.id, attId);
    if (!row) throw notFound("Вложение не найдено");

    if (!canDeleteAttachment(row, req.user.sub, req.projectRole ?? null)) {
      throw forbidden("Удалять чужие вложения может только менеджер или администратор проекта");
    }
    await deleteAttachment(row);
    await audit(req.user.sub, "attachment.remove", "issue", issue.id, {
      projectId: project.id,
      attId,
      filename: row.filename,
    });
    reply.code(204).send();
  });
}
