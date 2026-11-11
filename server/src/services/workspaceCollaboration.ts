import { Hocuspocus } from "@hocuspocus/server";
import { ApiHttpError } from "../errors.js";
import * as Y from "yjs";
import type { JwtPayload } from "../middleware.js";
import { assertFreshUser, forbidden } from "../middleware.js";
import { q } from "../db.js";
import { getDocument, saveContent } from "./workspaceDocuments.js";
import { modules } from "./workspace.js";

export interface CollaborationContext {
  projectId: string;
  documentId: string;
  generation: number;
  user: JwtPayload;
  readOnly: boolean;
}
async function access(ctx: CollaborationContext) {
  if (ctx.user.exp && ctx.user.exp * 1000 <= Date.now())
    throw forbidden("Сессия истекла");
  const global = await assertFreshUser(ctx.user.sub, ctx.user.sessionVersion);
  const rows = await q<{ role: string }>(
    `SELECT CASE WHEN $3 THEN 'admin' ELSE COALESCE(m.role,'viewer') END role FROM projects p
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=$2 WHERE p.id=$1 AND ($3 OR m.user_id IS NOT NULL OR p.is_shared OR EXISTS(SELECT 1 FROM department_members dm WHERE dm.department_id=p.department_id AND dm.user_id=$2))`,
    [ctx.projectId, ctx.user.sub, global === "admin"],
  );
  if (!rows.length) throw forbidden("Доступ к проекту отозван");
  const d = await getDocument(ctx.projectId, ctx.documentId);
  if (d.generation !== ctx.generation)
    throw forbidden("Версия документа изменилась");
  return (
    ctx.readOnly ||
    rows[0].role === "viewer" ||
    d.archived ||
    !(await modules(ctx.projectId)).documents
  );
}
export function createCollaboration() {
  const server = new Hocuspocus<CollaborationContext>({
    name: "taskira-documents",
    debounce: 500,
    maxDebounce: 1500,
    timeout: 30000,
    async onAuthenticate({ context, documentName, connectionConfig }) {
      if (
        documentName !==
        `${context.projectId}:${context.documentId}:${context.generation}`
      )
        throw forbidden("Неверный документ");
      connectionConfig.readOnly = await access(context);
      return context;
    },
    async beforeHandleMessage({ context, connection }) {
      connection.readOnly = await access(context);
    },
    async onLoadDocument({ context }) {
      const row = await getDocument(context.projectId, context.documentId);
      const doc = new Y.Doc();
      if (row.content) Y.applyUpdate(doc, row.content);
      return doc;
    },
    async onStateless({ connection, document, payload }) {
      let request: { type?: string; requestId?: string };
      try {
        request = JSON.parse(payload);
      } catch {
        return;
      }
      if (
        request?.type !== "persist" ||
        (request.requestId !== undefined &&
          !/^[0-9a-f-]{36}$/.test(request.requestId))
      )
        return;
      const context = connection.context as CollaborationContext;
      if (await access(context)) {
        connection.sendStateless(JSON.stringify({ type: "readonly" }));
        return;
      }
      const saved = await saveContent(
        context.projectId,
        context.documentId,
        context.generation,
        document,
        context.user.sub,
      );
      connection.sendStateless(
        JSON.stringify({
          type: "persisted",
          requestId: request.requestId,
          ...saved,
        }),
      );
    },
    async onStoreDocument({ lastContext: context, document }) {
      try {
        const saved = await saveContent(
          context.projectId,
          context.documentId,
          context.generation,
          document,
          context.user.sub,
        );
        document.broadcastStateless(
          JSON.stringify({ type: "persisted", ...saved }),
        );
      } catch (error) {
        if (
          error instanceof ApiHttpError &&
          (error.statusCode === 404 || error.code === "DOCUMENT_RESTORED")
        )
          return;
        throw error;
      }
    },
  });
  async function flush(projectId: string, id: string) {
    const row = await getDocument(projectId, id),
      doc = server.documents.get(`${projectId}:${id}:${row.generation}`);
    if (doc) await saveContent(projectId, id, row.generation, doc, null);
  }
  function close(projectId: string, id: string) {
    for (const name of server.documents.keys())
      if (name.startsWith(`${projectId}:${id}:`)) server.closeConnections(name);
  }
  async function destroy() {
    for (const name of [...server.documents.keys()]) {
      const [projectId, id] = name.split(":");
      await flush(projectId, id);
      server.closeConnections(name);
      const doc = server.documents.get(name);
      if (doc) await server.unloadDocument(doc);
    }
  }
  return { server, flush, close, destroy, checkAccess: access };
}
export type CollaborationService = ReturnType<typeof createCollaboration>;
