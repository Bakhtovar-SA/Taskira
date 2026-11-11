import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { recordBackgroundJob } from "../metrics.js";
import { q, withTransaction } from "../db.js";
import { badRequest, notFound, ApiHttpError } from "../middleware.js";
import { loadConfig } from "../config.js";
import { getStorage, newStorageKey } from "./storage.js";
import { checkUpload } from "./fileGuard.js";
import type { UploadPart } from "./attachments.js";
import type {
  Document,
  DocumentVersion,
  DocumentComment,
  DocumentFile,
} from "../workspaceContract.js";
import { iso, history, conflict, query } from "./workspace.js";
import type { PoolClient } from "pg";

export interface DocumentRow {
  id: string;
  project_id: string;
  title: string;
  parent_id: string | null;
  owner_id: string | null;
  generation: number;
  revision: number;
  content_revision: number;
  content: Buffer | null;
  content_json: unknown;
  search_text: string;
  verified_version_id: string | null;
  verified_content_revision: number | null;
  valid_until: string | null;
  archived: boolean;
  updated_at: Date;
}
export const mapDocument = (r: DocumentRow): Document => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  parentId: r.parent_id,
  ownerId: r.owner_id,
  generation: r.generation,
  revision: r.revision,
  contentRevision: r.content_revision,
  updatedAt: iso(r.updated_at),
  archived: r.archived,
  verifiedVersionId: r.verified_version_id,
  verifiedContentRevision: r.verified_content_revision,
  validUntil: r.valid_until,
  text: r.search_text,
});
export async function getDocument(
  projectId: string,
  id: string,
  client?: PoolClient,
): Promise<DocumentRow> {
  const r = (
    await query<DocumentRow>(
      client,
      "SELECT * FROM workspace_documents WHERE project_id=$1 AND id=$2",
      [projectId, id],
    )
  )[0];
  if (!r) throw notFound();
  return r;
}
export function initialContent(template: string) {
  const sections: Record<string, string[]> = {
    blank: [""],
    instruction: [
      "Назначение",
      "Перед началом",
      "Порядок выполнения",
      "Ожидаемый результат",
    ],
    minutes: ["Участники", "Обсуждение", "Принятые решения", "Поручения"],
    decision: ["Вопрос", "Рассмотренные варианты", "Решение", "Основания"],
    regulation: [
      "Цель и область применения",
      "Ответственные",
      "Порядок работы",
      "Контроль выполнения",
    ],
  };
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  for (const text of sections[template] ?? sections.blank) {
    const p = new Y.XmlElement("paragraph");
    p.setAttribute("blockId", randomUUID());
    if (text) {
      const t = new Y.XmlText();
      t.insert(0, text);
      p.insert(0, [t]);
    }
    fragment.push([p]);
  }
  const content = Buffer.from(Y.encodeStateAsUpdate(doc));
  const json = yDocToProsemirrorJSON(doc, "default");
  doc.destroy();
  return { content, json };
}
export function documentText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as {
    type?: string;
    attrs?: { label?: unknown };
    text?: unknown;
    content?: unknown;
  };
  if (n.type === "taskReference") return String(n.attrs?.label ?? "");
  return [
    typeof n.text === "string" ? n.text : "",
    ...(Array.isArray(n.content) ? n.content.map(documentText) : []),
  ]
    .filter(Boolean)
    .join(" ");
}
export async function checkpoint(
  projectId: string,
  id: string,
  actor: string | null,
  name = "",
  client?: PoolClient,
): Promise<DocumentVersion> {
  const r = await getDocument(projectId, id, client);
  const v = (
    await query<{ id: string; created_at: Date }>(
      client,
      `INSERT INTO workspace_document_versions(document_id,name,content,content_json,content_revision,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id,created_at`,
      [
        id,
        name,
        r.content,
        JSON.stringify(r.content_json),
        r.content_revision,
        actor,
      ],
    )
  )[0];
  return {
    id: v.id,
    documentId: id,
    name,
    content: r.content_json,
    contentRevision: r.content_revision,
    createdBy: actor,
    createdAt: iso(v.created_at),
  };
}
const pendingSaves = new Map<
  string,
  Promise<{ revision: number; digest: string }>
>();
export function saveContent(
  projectId: string,
  id: string,
  generation: number,
  doc: Y.Doc,
  actor: string | null,
) {
  const key = `${projectId}:${id}:${generation}`;
  const previous = pendingSaves.get(key);
  const started = Date.now();
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => persistContent(projectId, id, generation, doc, actor))
    .then(
      (saved) => {
        recordBackgroundJob(
          "document-save",
          "success",
          (Date.now() - started) / 1000,
        );
        return saved;
      },
      (error) => {
        recordBackgroundJob(
          "document-save",
          "error",
          (Date.now() - started) / 1000,
        );
        throw error;
      },
    );
  pendingSaves.set(key, next);
  void next
    .finally(() => {
      if (pendingSaves.get(key) === next) pendingSaves.delete(key);
    })
    .catch(() => undefined);
  return next;
}
async function persistContent(
  projectId: string,
  id: string,
  generation: number,
  doc: Y.Doc,
  actor: string | null,
) {
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  if (bytes.length > 1_000_000)
    throw badRequest("Документ превышает 1 МБ");
  const json = yDocToProsemirrorJSON(doc, "default");
  const text = documentText(json);
  if (text.length > 500000) throw badRequest("Слишком большой документ");
  const revision = await withTransaction(async (client) => {
    const previous = (
      await client.query<DocumentRow>(
        "SELECT * FROM workspace_documents WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [projectId, id],
      )
    ).rows[0];
    if (!previous || previous.generation !== generation)
      throw new ApiHttpError(
        409,
        "DOCUMENT_RESTORED",
        "Документ восстановлен. Откройте его заново",
      );
    if (previous.archived && !previous.content?.equals(bytes))
      throw badRequest("Документ в архиве");
    if (!previous.content?.equals(bytes)) {
      await client.query(
        `UPDATE workspace_documents SET content=$3,content_json=$4::jsonb,search_text=$5,content_revision=content_revision+1,updated_at=now() WHERE project_id=$1 AND id=$2`,
        [projectId, id, bytes, JSON.stringify(json), text],
      );
      const last = (
        await client.query<{ created_at: Date }>(
          "SELECT created_at FROM workspace_document_versions WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      if (!last || Date.now() - +last.created_at >= 5 * 60_000)
        await checkpoint(projectId, id, actor, "", client);
    }
    return (await getDocument(projectId, id, client)).content_revision;
  });
  return { revision, digest: createHash("sha256").update(bytes).digest("hex") };
}
export async function listVersions(
  projectId: string,
  id: string,
  offset = 0,
): Promise<DocumentVersion[]> {
  await getDocument(projectId, id);
  return (
    await q<{
      id: string;
      name: string;
      content_json: unknown;
      content_revision: number;
      created_by: string | null;
      created_at: Date;
    }>(
      "SELECT * FROM workspace_document_versions WHERE document_id=$1 ORDER BY created_at DESC,id LIMIT 100 OFFSET $2",
      [id, offset],
    )
  ).map((v) => ({
    id: v.id,
    documentId: id,
    name: v.name,
    content: v.content_json,
    contentRevision: v.content_revision,
    createdBy: v.created_by,
    createdAt: iso(v.created_at),
  }));
}
export async function restoreDocument(
  projectId: string,
  id: string,
  versionId: string,
  actor: string,
) {
  return withTransaction(async (client) => {
    await client.query(
      "SELECT id FROM workspace_documents WHERE project_id=$1 AND id=$2 FOR UPDATE",
      [projectId, id],
    );
    const d = await getDocument(projectId, id, client);
    if (d.archived) throw badRequest("Документ в архиве");
    const v = (
      await client.query<{ content: Buffer; content_json: unknown }>(
        "SELECT content,content_json FROM workspace_document_versions WHERE document_id=$1 AND id=$2",
        [id, versionId],
      )
    ).rows[0];
    if (!v) throw notFound();
    await checkpoint(projectId, id, actor, "Перед восстановлением", client);
    await client.query(
      "UPDATE workspace_documents SET generation=generation+1,revision=revision+1,content_revision=content_revision+1,content=$3,content_json=$4::jsonb,search_text=$5,updated_at=now() WHERE project_id=$1 AND id=$2",
      [
        projectId,
        id,
        v.content,
        JSON.stringify(v.content_json),
        documentText(v.content_json),
      ],
    );
    await history(
      projectId,
      "document",
      id,
      actor,
      "document.restored",
      { versionId },
      client,
    );
    return mapDocument(await getDocument(projectId, id, client));
  });
}
export async function comments(
  projectId: string,
  id: string,
): Promise<DocumentComment[]> {
  await getDocument(projectId, id);
  return (
    await q<{
      id: string;
      body: string;
      block_id: string | null;
      parent_id: string | null;
      author_id: string | null;
      author_name: string;
      resolved: boolean;
      created_at: Date;
    }>(
      `SELECT c.*,COALESCE(u.name,'Удалённый пользователь') author_name FROM workspace_document_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.document_id=$1 ORDER BY c.created_at LIMIT 500`,
      [id],
    )
  ).map((c) => ({
    id: c.id,
    documentId: id,
    body: c.body,
    blockId: c.block_id,
    parentId: c.parent_id,
    authorId: c.author_id,
    authorName: c.author_name,
    resolved: c.resolved,
    createdAt: iso(c.created_at),
  }));
}
export async function saveFile(
  projectId: string,
  id: string,
  userId: string,
  part: UploadPart,
): Promise<DocumentFile> {
  const cfg = loadConfig();
  await getDocument(projectId, id);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of part.file) {
    size += chunk.length;
    if (size > cfg.storage.maxBytes) {
      part.file.resume();
      throw new ApiHttpError(
        413,
        "ATTACHMENT_TOO_LARGE",
        "Слишком большой файл",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  if (part.file.truncated)
    throw new ApiHttpError(413, "ATTACHMENT_TOO_LARGE", "Слишком большой файл");
  const bytes = Buffer.concat(chunks),
    guard = checkUpload({
      filename: part.filename,
      head: bytes.subarray(0, 512),
      maxFilename: cfg.storage.maxFilename,
      blockExt: cfg.storage.blockExt,
    });
  const store = await getStorage(cfg),
    key = newStorageKey(id);
  await store.put(key, Readable.from(bytes), {
    contentType: guard.contentType,
    size,
  });
  try {
    return await withTransaction(async (client) => {
      await client.query(
        "SELECT id FROM workspace_documents WHERE id=$1 FOR UPDATE",
        [id],
      );
      const d = await getDocument(projectId, id, client);
      if (d.archived) throw badRequest("Документ в архиве");
      const count = +(
        await client.query<{ n: string }>(
          "SELECT count(*) n FROM workspace_document_files WHERE document_id=$1",
          [id],
        )
      ).rows[0].n;
      if (count >= cfg.storage.maxPerIssue)
        throw badRequest("Достигнут лимит вложений");
      const f = (
        await client.query<{ id: string; created_at: Date }>(
          "INSERT INTO workspace_document_files(document_id,filename,content_type,size,storage_key,created_by,storage_driver) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at",
          [
            id,
            guard.filename,
            guard.contentType,
            size,
            key,
            userId,
            cfg.storage.driver,
          ],
        )
      ).rows[0];
      return {
        id: f.id,
        documentId: id,
        filename: guard.filename,
        contentType: guard.contentType,
        size,
        createdAt: iso(f.created_at),
      };
    });
  } catch (e) {
    await store.delete(key).catch(() => undefined);
    throw e;
  }
}
