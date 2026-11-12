import { projectFileRoutes } from "./projectFiles.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { q, withTransaction } from "../db.js";
import {
  badRequest,
  forbidden,
  notFound,
  requireAuth,
  requirePerm,
  requireSession,
  zbody,
  zparams,
} from "../middleware.js";
import { loadConfig } from "../config.js";
import { conflict as resultConflict } from "../services/workflow.js";
import {
  WorkspaceModulesBody,
  DocumentCreateBody,
  DocumentPatchBody,
  VersionBody,
  VerifyDocumentBody,
  DocumentCommentBody,
  ObjectTypeBody,
  ObjectTypeShape,
  ObjectCreateBody,
  ObjectPatchBody,
  ProcessTemplateBody,
  ProcessStartBody,
  AutomationRuleBody,
  PlanBody,
  EntityRef,
  EntityLinkBody,
  IdParams,
  type ObjectType,
  type ObjectRecord,
  type PlanScenario,
  type AutomationRule,
  type PlanItem,
  type DocumentFile,
} from "../workspaceContract.js";
import {
  storedModules,
  writable,
  history,
  entityHistory,
  iso,
  entity,
  links,
  linkEntities,
  assertLinkWrite,
  validateUser,
  validateValues,
  conflict,
  library,
} from "../services/workspace.js";
import {
  getDocument,
  mapDocument,
  initialContent,
  checkpoint,
  listVersions,
  restoreDocument,
  comments,
  saveFile,
} from "../services/workspaceDocuments.js";
import type {
  CollaborationService,
  CollaborationContext,
} from "../services/workspaceCollaboration.js";
import {
  registerSocket,
  unregisterSocket,
  revokedSince,
} from "../services/wsHub.js";
import {
  templates,
  validateProcess,
  startProcess,
  getRun,
  advanceRun,
} from "../services/workspaceProcesses.js";
import {
  matches,
  validateGraph,
  forecast,
} from "../services/workspaceLogic.js";
import { createIssueInTx } from "../services/issueCreate.js";
import { assertSelfAssignment } from "../services/issues.js";
import { transitionIssue } from "../services/issueTransition.js";
import { getStorage } from "../services/storage.js";

import { remainingPlan } from "../services/workspacePlanning.js";

const pid = (r: FastifyRequest) => r.project!.id;
const id = (r: FastifyRequest) => (r.params as { id: string }).id;
const reader = {
  preHandler: requirePerm("browse"),
  preValidation: zparams(IdParams),
};
const page = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const requireManager = (r: FastifyRequest) => {
  if (r.projectRole !== "manager" && r.projectRole !== "admin")
    throw forbidden("Требуется менеджер проекта");
};
const mapType = (r: {
  id: string;
  project_id: string;
  name: string;
  fields: ObjectType["fields"];
  revision: number;
}): ObjectType => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  fields: r.fields,
  revision: r.revision,
});
type ObjectRow = {
  id: string;
  project_id: string;
  type_id: string;
  title: string;
  owner_id: string | null;
  field_values: ObjectRecord["values"];
  archived: boolean;
  revision: number;
  updated_at: Date;
  open_issues?: string;
  last_check?: string | null;
};
const mapObject = (r: ObjectRow): ObjectRecord => ({
  id: r.id,
  projectId: r.project_id,
  typeId: r.type_id,
  title: r.title,
  ownerId: r.owner_id,
  values: r.field_values,
  archived: r.archived,
  revision: r.revision,
  updatedAt: iso(r.updated_at),
  openIssues: Number(r.open_issues ?? 0),
  lastCheck: r.last_check ?? null,
});
type PlanRow = {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  target_date: string | null;
  items: PlanItem[];
  revision: number;
};
const mapPlan = (r: PlanRow): PlanScenario => ({
  id: r.id,
  projectId: r.project_id,
  planId: r.plan_id,
  name: r.name,
  targetDate: r.target_date,
  items: r.items,
  revision: r.revision,
});
async function validatePlan(projectId: string, items: PlanItem[]) {
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw badRequest("Единицы работы не должны повторяться");
  const issues = new Set<string>();
  for (const item of items) {
    if (item.kind === "issue") {
      await entity(projectId, { kind: "issue", id: item.id });
      issues.add(item.id);
    } else {
      const s = (
        await q<{ issue_id: string | null }>(
          "SELECT s.issue_id FROM workspace_process_steps s JOIN workspace_process_runs r ON r.id=s.run_id WHERE r.project_id=$1 AND s.id=$2",
          [projectId, item.id],
        )
      )[0];
      if (!s) throw notFound("Этап не найден");
      if (s.issue_id) {
        if (
          issues.has(s.issue_id) ||
          items.some((i) => i.kind === "issue" && i.id === s.issue_id)
        )
          throw badRequest("Этап и его задача учитываются один раз");
        issues.add(s.issue_id);
      }
    }
  }
}
export async function workspaceGlobalRoutes(app: FastifyInstance) {
  const search = z.object({
    q: z.string().max(200).default(""),
    projectId: z.string().uuid().optional(),
    kind: EntityRef.shape.kind.optional(),
    archived: z.enum(["true", "false"]).default("false"),
  });
  app.get("/library", { preHandler: requireAuth }, async (req) => {
    const f = search.parse(req.query);
    return library(
      req.user.sub,
      req.user.globalRole === "admin",
      f.q,
      f.archived === "true",
      { projectId: f.projectId, kind: f.kind },
    );
  });
  app.get("/search", { preHandler: requireAuth }, async (req) => {
    const f = search.parse(req.query);
    return library(
      req.user.sub,
      req.user.globalRole === "admin",
      f.q,
      f.archived === "true",
      { projectId: f.projectId, kind: f.kind },
    );
  });
}
export async function workspaceRoutes(
  app: FastifyInstance,
  collaboration: CollaborationService,
) {
  await app.register(projectFileRoutes);
  app.get(
    "/workspace/modules",
    { preHandler: requirePerm("browse") },
    async (req) => storedModules(pid(req)),
  );
  app.patch(
    "/workspace/modules",
    {
      preHandler: requirePerm("manageWorkspace"),
      preValidation: zbody(WorkspaceModulesBody),
    },
    async (req) => {
      const b = req.body as WorkspaceModulesBody;
      for (const name of collaboration.server.documents.keys())
        if (name.startsWith(`${pid(req)}:`)) {
          const [, docId] = name.split(":");
          await collaboration.flush(pid(req), docId);
          if (!b.documents) collaboration.close(pid(req), docId);
        }
      await q(
        `INSERT INTO workspace_modules(project_id,documents,objects,processes,planning,files) VALUES($1,$2,$3,$4,$5,coalesce($6,true)) ON CONFLICT(project_id) DO UPDATE SET documents=$2,objects=$3,processes=$4,planning=$5,files=coalesce($6,workspace_modules.files)`,
        [pid(req), b.documents, b.objects, b.processes, b.planning, b.files ?? null],
      );
      await history(
        pid(req),
        "project",
        pid(req),
        req.user.sub,
        "modules.changed",
        b,
      );
      return storedModules(pid(req));
    },
  );
  app.get("/documents", { preHandler: requirePerm("browse") }, async (req) => ({
    items: (
      await q<Awaited<ReturnType<typeof getDocument>>>(
        "SELECT * FROM workspace_documents WHERE project_id=$1 ORDER BY title LIMIT 1001",
        [pid(req)],
      )
    ).map(mapDocument),
  }));
  app.post(
    "/documents",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: zbody(DocumentCreateBody),
    },
    async (req, reply) => {
      await writable(req, "documents");
      const b = req.body as z.infer<typeof DocumentCreateBody>;
      await validateUser(pid(req), b.ownerId);
      if (b.parentId) await getDocument(pid(req), b.parentId);
      return withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `documents:${pid(req)}`,
        ]);
        const count = +(
          await client.query<{ n: string }>(
            "SELECT count(*) n FROM workspace_documents WHERE project_id=$1",
            [pid(req)],
          )
        ).rows[0].n;
        if (count >= 1000)
          throw badRequest("Достигнут лимит документов проекта");
        const initial = initialContent(b.template);
        const r = (
          await client.query<{ id: string }>(
            "INSERT INTO workspace_documents(project_id,title,parent_id,owner_id,content,content_json,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id",
            [
              pid(req),
              b.title,
              b.parentId,
              b.ownerId ?? req.user.sub,
              initial.content,
              JSON.stringify(initial.json),
              req.user.sub,
            ],
          )
        ).rows[0];
        await checkpoint(
          pid(req),
          r.id,
          req.user.sub,
          "Начальная версия",
          client,
        );
        await history(
          pid(req),
          "document",
          r.id,
          req.user.sub,
          "document.created",
          {},
          client,
        );
        reply.code(201);
        return mapDocument(await getDocument(pid(req), r.id, client));
      });
    },
  );
  app.get("/documents/:id", reader, async (req) => {
    const d = await getDocument(pid(req), id(req));
    return { document: mapDocument(d), content: d.content_json };
  });
  app.patch(
    "/documents/:id",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: [zparams(IdParams), zbody(DocumentPatchBody)],
    },
    async (req) => {
      await writable(req, "documents");
      const b = req.body as z.infer<typeof DocumentPatchBody>;
      if (b.archived !== undefined) requireManager(req);
      await collaboration.flush(pid(req), id(req));
      if (b.ownerId !== undefined) await validateUser(pid(req), b.ownerId);
      if (b.parentId) {
        await getDocument(pid(req), b.parentId);
        const cycle = await q(
          `WITH RECURSIVE ancestors AS(SELECT id,parent_id FROM workspace_documents WHERE id=$1 AND project_id=$3 UNION SELECT d.id,d.parent_id FROM workspace_documents d JOIN ancestors a ON d.id=a.parent_id WHERE d.project_id=$3) SELECT id FROM ancestors WHERE id=$2`,
          [b.parentId, id(req), pid(req)],
        );
        if (cycle.length) throw badRequest("Цикл в дереве документов");
      }
      const current = await getDocument(pid(req), id(req));
      if (current.archived && b.archived !== false)
        throw badRequest("Документ в архиве");
      const rows = await q<Awaited<ReturnType<typeof getDocument>>>(
        `UPDATE workspace_documents SET title=$4,parent_id=$5,owner_id=$6,archived=$7,revision=revision+1,updated_at=now() WHERE project_id=$1 AND id=$2 AND revision=$3 RETURNING *`,
        [
          pid(req),
          id(req),
          b.revision,
          b.title ?? current.title,
          b.parentId === undefined ? current.parent_id : b.parentId,
          b.ownerId === undefined ? current.owner_id : b.ownerId,
          b.archived ?? current.archived,
        ],
      );
      if (!rows.length) conflict();
      if (b.archived !== undefined) collaboration.close(pid(req), id(req));
      await history(
        pid(req),
        "document",
        id(req),
        req.user.sub,
        "document.updated",
        { archived: b.archived ?? false },
      );
      return mapDocument(rows[0]);
    },
  );
  app.get("/documents/:id/versions", reader, async (req) => {
    const p = page.parse(req.query);
    return { items: await listVersions(pid(req), id(req), p.offset) };
  });
  app.post(
    "/documents/:id/versions",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: [zparams(IdParams), zbody(VersionBody)],
    },
    async (req) => {
      await writable(req, "documents");
      if ((await getDocument(pid(req), id(req))).archived)
        throw badRequest("Документ в архиве");
      await collaboration.flush(pid(req), id(req));
      return checkpoint(
        pid(req),
        id(req),
        req.user.sub,
        (req.body as z.infer<typeof VersionBody>).name,
      );
    },
  );
  app.post(
    "/documents/:id/restore",
    {
      preHandler: requirePerm("manageDocuments"),
      preValidation: [
        zparams(IdParams),
        zbody(z.object({ versionId: z.string().uuid() }).strict()),
      ],
    },
    async (req) => {
      await writable(req, "documents");
      await collaboration.flush(pid(req), id(req));
      const d = await restoreDocument(
        pid(req),
        id(req),
        (req.body as { versionId: string }).versionId,
        req.user.sub,
      );
      collaboration.close(pid(req), id(req));
      return d;
    },
  );
  app.post(
    "/documents/:id/verify",
    {
      preHandler: requirePerm("manageDocuments"),
      preValidation: [zparams(IdParams), zbody(VerifyDocumentBody)],
    },
    async (req) => {
      await writable(req, "documents");
      await collaboration.flush(pid(req), id(req));
      const b = req.body as z.infer<typeof VerifyDocumentBody>;
      const d = await getDocument(pid(req), id(req));
      if (d.archived) throw badRequest("Документ в архиве");
      const version = (
        await q<{ content_revision: number }>(
          "SELECT content_revision FROM workspace_document_versions WHERE document_id=$1 AND id=$2",
          [id(req), b.versionId],
        )
      )[0];
      if (!version) throw notFound();
      await q(
        "UPDATE workspace_documents SET verified_version_id=$3,verified_content_revision=$4,valid_until=$5,revision=revision+1 WHERE project_id=$1 AND id=$2",
        [
          pid(req),
          id(req),
          b.versionId,
          version.content_revision,
          b.validUntil,
        ],
      );
      await history(
        pid(req),
        "document",
        id(req),
        req.user.sub,
        "document.verified",
        { versionId: b.versionId, validUntil: b.validUntil },
      );
      return mapDocument(await getDocument(pid(req), id(req)));
    },
  );
  app.get("/documents/:id/comments", reader, async (req) => ({
    items: await comments(pid(req), id(req)),
  }));
  app.post(
    "/documents/:id/comments",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: [zparams(IdParams), zbody(DocumentCommentBody)],
    },
    async (req) => {
      await writable(req, "documents");
      const d = await getDocument(pid(req), id(req));
      if (d.archived) throw badRequest("Документ в архиве");
      const b = req.body as z.infer<typeof DocumentCommentBody>;
      if (
        b.parentId &&
        !(
          await q(
            "SELECT id FROM workspace_document_comments WHERE document_id=$1 AND id=$2",
            [id(req), b.parentId],
          )
        ).length
      )
        throw notFound();
      await q(
        "INSERT INTO workspace_document_comments(document_id,body,block_id,parent_id,author_id) VALUES($1,$2,$3,$4,$5)",
        [id(req), b.body, b.blockId, b.parentId, req.user.sub],
      );
      return { items: await comments(pid(req), id(req)) };
    },
  );
  app.patch(
    "/documents/:id/comments/:commentId",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: [
        zparams(IdParams.extend({ commentId: z.string().uuid() })),
        zbody(z.object({ resolved: z.boolean() }).strict()),
      ],
    },
    async (req) => {
      await writable(req, "documents");
      const d = await getDocument(pid(req), id(req));
      if (d.archived) throw badRequest("Документ в архиве");
      const rows = await q(
        "UPDATE workspace_document_comments SET resolved=$3 WHERE document_id=$1 AND id=$2 RETURNING id",
        [
          id(req),
          (req.params as { commentId: string }).commentId,
          (req.body as { resolved: boolean }).resolved,
        ],
      );
      if (!rows.length) throw notFound();
      return { items: await comments(pid(req), id(req)) };
    },
  );
  app.get("/documents/:id/attachments", reader, async (req) => {
    await getDocument(pid(req), id(req));
    return {
      items: (
        await q<{
          id: string;
          filename: string;
          content_type: string;
          size: number;
          created_at: Date;
        }>(
          "SELECT * FROM workspace_document_files WHERE document_id=$1 ORDER BY created_at",
          [id(req)],
        )
      ).map(
        (f) =>
          ({
            id: f.id,
            documentId: id(req),
            filename: f.filename,
            contentType: f.content_type,
            size: f.size,
            createdAt: iso(f.created_at),
          }) satisfies DocumentFile,
      ),
    };
  });
  app.post(
    "/documents/:id/attachments",
    {
      preHandler: requirePerm("writeDocuments"),
      preValidation: zparams(IdParams),
    },
    async (req, reply) => {
      await writable(req, "documents");
      if ((await getDocument(pid(req), id(req))).archived)
        throw badRequest("Документ в архиве");
      if (!req.isMultipart())
        throw badRequest("Ожидается multipart/form-data с полем file");
      const part = await req.file();
      if (!part) throw badRequest("Выберите файл");
      reply.code(201);
      return saveFile(pid(req), id(req), req.user.sub, part);
    },
  );
  app.get(
    "/documents/:id/attachments/:fileId",
    {
      preHandler: requirePerm("browse"),
      preValidation: zparams(IdParams.extend({ fileId: z.string().uuid() })),
    },
    async (req, reply) => {
      await getDocument(pid(req), id(req));
      const f = (
        await q<{
          filename: string;
          content_type: string;
          storage_key: string;
          storage_driver: string;
        }>(
          "SELECT * FROM workspace_document_files WHERE document_id=$1 AND id=$2",
          [id(req), (req.params as { fileId: string }).fileId],
        )
      )[0];
      if (!f) throw notFound();
      const cfg = loadConfig();
      if (f.storage_driver !== cfg.storage.driver)
        throw badRequest("Драйвер хранилища изменён");
      const inline = /^image\/(png|jpeg|gif|webp)$/.test(f.content_type);
      reply
        .type(f.content_type)
        .header(
          "Content-Disposition",
          `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        )
        .header("X-Content-Type-Options", "nosniff");
      return reply.send(await (await getStorage(cfg)).get(f.storage_key));
    },
  );
  app.get("/documents/:id/export", reader, async (req, reply) => {
    const d = await getDocument(pid(req), id(req));
    reply
      .type("application/json")
      .header(
        "Content-Disposition",
        `attachment; filename="document-${d.id}.json"`,
      );
    return { title: d.title, content: d.content_json };
  });
  app.post(
    "/documents/:id/issues",
    {
      preHandler: requirePerm("create"),
      preValidation: [
        zparams(IdParams),
        zbody(
          z
            .object({
              title: z.string().trim().min(1).max(240),
              description: z.string().max(30000).default(""),
              blockId: z.string().max(100).nullable().default(null),
              requestId: z.string().uuid(),
              objectId: z.string().uuid().nullable().default(null),
              runId: z.string().uuid().nullable().default(null),
            })
            .strict(),
        ),
      ],
    },
    async (req) => {
      await writable(req, "documents");
      if ((await getDocument(pid(req), id(req))).archived)
        throw badRequest("Документ в архиве");
      const b = req.body as {
        title: string;
        description: string;
        blockId: string | null;
        requestId: string;
        objectId: string | null;
        runId: string | null;
      };
      return withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          b.requestId,
        ]);
        const previous = (
          await client.query<{
            detail: { requestId: string; issueId: string; key: string };
          }>(
            `SELECT detail FROM workspace_history WHERE project_id=$1 AND kind='document' AND entity_id=$2 AND detail->>'requestId'=$3`,
            [pid(req), id(req), b.requestId],
          )
        ).rows[0];
        if (previous)
          return { id: previous.detail.issueId, key: previous.detail.key };
        const assigned = (
          await client.query(
            "SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2",
            [pid(req), req.user.sub],
          )
        ).rowCount
          ? [req.user.sub]
          : [];
        assertSelfAssignment(req.user.sub, [], assigned);
        const source = `/p/${encodeURIComponent(req.project!.key)}/documents?document=${id(req)}${b.blockId ? "#block-" + encodeURIComponent(b.blockId) : ""}`;
        const issue = await createIssueInTx(
          client,
          req.project!,
          {
            title: b.title,
            description: `${b.description}\n\n${source}`,
            typeId: "task",
            priorityId: "medium",
            assigneeIds: assigned,
            labels: [],
            complexity: null,
            checklistItems: [],
          },
          req.user.sub,
        );
        await linkEntities(
          pid(req),
          { kind: "document", id: id(req) },
          { kind: "issue", id: issue.id },
          req.user.sub,
          client,
        );
        for (const ref of [
          { kind: "object" as const, id: b.objectId },
          { kind: "process" as const, id: b.runId },
        ])
          if (ref.id) {
            await writable(
              req,
              ref.kind === "object" ? "objects" : "processes",
            );
            await linkEntities(
              pid(req),
              { kind: "issue", id: issue.id },
              { kind: ref.kind, id: ref.id },
              req.user.sub,
              client,
            );
          }
        await history(
          pid(req),
          "document",
          id(req),
          req.user.sub,
          "document.taskCreated",
          {
            requestId: b.requestId,
            issueId: issue.id,
            key: issue.key,
            blockId: b.blockId,
          },
          client,
        );
        return { id: issue.id, key: issue.key };
      });
    },
  );
  app.get(
    "/documents/:id/collaboration",
    {
      websocket: true,
      preHandler: [requireSession, requirePerm("browse")],
      preValidation: zparams(IdParams),
    },
    (socket, req) => {
      const generation = z.coerce.number().int().positive().safeParse(
        (req.query as { generation?: string }).generation,
      );
      if (!generation.success) {
        socket.close(1008, "Invalid document generation");
        return;
      }
      const started = Date.now(),
        userId = req.user.sub;
      registerSocket(userId, socket);
      socket.on("close", () => unregisterSocket(userId, socket));
      if (revokedSince(userId, started)) {
        socket.close(1008, "Session revoked");
        return;
      }
      const ctx: CollaborationContext = {
        projectId: pid(req),
        documentId: id(req),
        generation: generation.data,
        user: req.user,
        readOnly: req.projectRole === "viewer",
      };
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const connection = collaboration.server.handleConnection(
        socket,
        new Request(`http://localhost${req.url}`, { headers }),
        ctx,
      );
      socket.on("message", (data, isBinary) => {
        if (!isBinary) {
          socket.close(1003, "Binary messages required");
          return;
        }
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : data;
        connection.handleMessage(bytes);
      });
      socket.on("pong", () => connection.touch());
      socket.on("close", () => connection.handleClose());
      let checking = false;
      const accessTimer = setInterval(() => {
        if (checking) return;
        checking = true;
        void collaboration
          .checkAccess(ctx)
          .catch(() => socket.close(1008, "Access revoked"))
          .finally(() => {
            checking = false;
          });
      }, 15000);
      accessTimer.unref();
      socket.on("close", () => clearInterval(accessTimer));
    },
  );
  app.get(
    "/object-types",
    { preHandler: requirePerm("browse") },
    async (req) => ({
      items: (
        await q<Parameters<typeof mapType>[0]>(
          "SELECT * FROM workspace_object_types WHERE project_id=$1 ORDER BY name",
          [pid(req)],
        )
      ).map(mapType),
    }),
  );
  app.post(
    "/object-types",
    {
      preHandler: requirePerm("manageWorkspace"),
      preValidation: zbody(ObjectTypeBody),
    },
    async (req, reply) => {
      await writable(req, "objects");
      const b = req.body as z.infer<typeof ObjectTypeBody>;
      const r = (
        await q<Parameters<typeof mapType>[0]>(
          "INSERT INTO workspace_object_types(project_id,name,fields) VALUES($1,$2,$3::jsonb) RETURNING *",
          [pid(req), b.name, JSON.stringify(b.fields)],
        )
      )[0];
      reply.code(201);
      return mapType(r);
    },
  );
  app.patch(
    "/object-types/:id",
    {
      preHandler: requirePerm("manageWorkspace"),
      preValidation: [
        zparams(IdParams),
        zbody(
          ObjectTypeShape.extend({ revision: z.number().int().positive() }),
        ),
      ],
    },
    async (req) => {
      await writable(req, "objects");
      const b = req.body as z.infer<typeof ObjectTypeBody> & {
        revision: number;
      };
      ObjectTypeBody.parse({ name: b.name, fields: b.fields });
      return withTransaction(async (client) => {
        const existing = (
          await client.query(
            "SELECT id FROM workspace_object_types WHERE project_id=$1 AND id=$2 FOR UPDATE",
            [pid(req), id(req)],
          )
        ).rows[0];
        if (!existing) throw notFound();
        for (const r of (
          await client.query<{ field_values: ObjectRecord["values"] }>(
            "SELECT field_values FROM workspace_objects WHERE project_id=$1 AND type_id=$2",
            [pid(req), id(req)],
          )
        ).rows)
          await validateValues(pid(req), b.fields, r.field_values, client);
        const r = (
          await client.query<Parameters<typeof mapType>[0]>(
            "UPDATE workspace_object_types SET name=$4,fields=$5::jsonb,revision=revision+1 WHERE project_id=$1 AND id=$2 AND revision=$3 RETURNING *",
            [pid(req), id(req), b.revision, b.name, JSON.stringify(b.fields)],
          )
        ).rows[0];
        if (!r) conflict();
        return mapType(r);
      });
    },
  );
  app.get("/objects", { preHandler: requirePerm("browse") }, async (req) => {
    const p = page
      .extend({
        typeId: z.string().uuid().optional(),
        q: z.string().max(200).default(""),
        owner: z.union([z.string().uuid(), z.literal("none")]).optional(),
        archived: z.enum(["all", "true", "false"]).default("false"),
        field: z
          .string()
          .regex(/^[a-z][a-z0-9_]{0,39}$/)
          .optional(),
        value: z.string().max(200).default(""),
        before: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        sort: z.string().max(50).default("title"),
        direction: z.enum(["asc", "desc"]).default("asc"),
      })
      .parse(req.query);
    if (p.field || p.sort.startsWith("field:")) {
      if (!p.typeId) throw badRequest("Для полей выберите реестр");
      const t = (
        await q<Parameters<typeof mapType>[0]>(
          "SELECT * FROM workspace_object_types WHERE project_id=$1 AND id=$2",
          [pid(req), p.typeId],
        )
      )[0];
      if (!t) throw notFound();
      for (const key of [
        p.field,
        p.sort.startsWith("field:") ? p.sort.slice(6) : undefined,
      ].filter(Boolean))
        if (!t.fields.some((f) => f.key === key))
          throw badRequest("Поле реестра не найдено");
      if (
        p.before &&
        !t.fields.some((f) => f.key === p.field && f.type === "date")
      )
        throw badRequest("Ограничение даты требует поле даты");
    }
    const args: unknown[] = [pid(req), p.typeId ?? null, `%${p.q}%`];
    const conditions = [
      "project_id=$1",
      "($2::uuid IS NULL OR type_id=$2)",
      "title ILIKE $3",
    ];
    const param = (value: unknown) => {
      args.push(value);
      return "$" + args.length;
    };
    if (p.owner)
      conditions.push(
        p.owner === "none"
          ? "owner_id IS NULL"
          : `owner_id=${param(p.owner)}::uuid`,
      );
    if (p.archived !== "all")
      conditions.push(`archived=${param(p.archived === "true")}`);
    if (p.field) {
      const key = param(p.field);
      if (p.before)
        conditions.push(`field_values->>${key}<=${param(p.before)}`);
      else if (p.value)
        conditions.push(
          `field_values->>${key} ILIKE ${param("%" + p.value + "%")}`,
        );
    }
    const countArgs = [...args],
      filter = conditions.join(" AND ");
    const sort =
      p.sort === "title"
        ? "title"
        : p.sort === "updatedAt"
          ? "updated_at"
          : p.sort.startsWith("field:")
            ? `field_values->${param(p.sort.slice(6))}`
            : null;
    if (!sort) throw badRequest("Недопустимая сортировка");
    const rows = await q<ObjectRow>(
      `SELECT * FROM workspace_objects WHERE ${filter} ORDER BY ${sort} ${p.direction} NULLS LAST,id LIMIT ${param(p.limit)} OFFSET ${param(p.offset)}`,
      args,
    );
    const total = +(
      await q<{ n: string }>(
        `SELECT count(*) n FROM workspace_objects WHERE ${filter}`,
        countArgs,
      )
    )[0].n;
    return { items: rows.map(mapObject), total };
  });
  app.post(
    "/objects",
    {
      preHandler: requirePerm("writeObjects"),
      preValidation: zbody(ObjectCreateBody),
    },
    async (req, reply) => {
      await writable(req, "objects");
      const b = req.body as z.infer<typeof ObjectCreateBody>;
      const t = (
        await q<Parameters<typeof mapType>[0]>(
          "SELECT * FROM workspace_object_types WHERE project_id=$1 AND id=$2",
          [pid(req), b.typeId],
        )
      )[0];
      if (!t) throw notFound();
      await validateUser(pid(req), b.ownerId);
      await validateValues(pid(req), t.fields, b.values);
      const r = (
        await q<ObjectRow>(
          "INSERT INTO workspace_objects(project_id,type_id,title,owner_id,field_values) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *",
          [pid(req), b.typeId, b.title, b.ownerId, JSON.stringify(b.values)],
        )
      )[0];
      await history(pid(req), "object", r.id, req.user.sub, "object.created");
      reply.code(201);
      return mapObject(r);
    },
  );
  app.get("/objects/:id", reader, async (req) => {
    const r = (
      await q<ObjectRow>(
        "SELECT * FROM workspace_objects WHERE project_id=$1 AND id=$2",
        [pid(req), id(req)],
      )
    )[0];
    if (!r) throw notFound();
    const related = await links(pid(req), { kind: "object", id: id(req) });
    const issueIds = related
      .filter((l) => l.target.kind === "issue")
      .map((l) => l.target.id);
    r.open_issues = (
      await q<{ n: string }>(
        "SELECT count(*) n FROM issues i JOIN workflow_statuses s ON s.id=i.status_id WHERE i.project_id=$1 AND i.id=ANY($2::uuid[]) AND s.category<>'done'",
        [pid(req), issueIds],
      )
    )[0].n;
    const check = (
      await q<{ at: Date }>(
        "SELECT max(h.created_at) at FROM workspace_history h WHERE h.project_id=$1 AND h.kind='process' AND h.action='process.completed' AND h.entity_id=ANY($2::uuid[])",
        [
          pid(req),
          related
            .filter((l) => l.target.kind === "process")
            .map((l) => l.target.id),
        ],
      )
    )[0];
    r.last_check = check?.at ? iso(check.at) : null;
    return {
      object: mapObject(r),
      links: related,
      history: await entityHistory(pid(req), "object", id(req)),
    };
  });
  app.patch(
    "/objects/:id",
    {
      preHandler: requirePerm("writeObjects"),
      preValidation: [zparams(IdParams), zbody(ObjectPatchBody)],
    },
    async (req) => {
      await writable(req, "objects");
      const b = req.body as z.infer<typeof ObjectPatchBody>;
      if (b.archived !== undefined) requireManager(req);
      return withTransaction(async (client) => {
        const r = (
          await client.query<ObjectRow>(
            "SELECT * FROM workspace_objects WHERE project_id=$1 AND id=$2 FOR UPDATE",
            [pid(req), id(req)],
          )
        ).rows[0];
        if (!r) throw notFound();
        if (r.archived && b.archived !== false)
          throw badRequest("Объект в архиве");
        const t = (
          await client.query<{ fields: ObjectType["fields"] }>(
            "SELECT fields FROM workspace_object_types WHERE project_id=$1 AND id=$2",
            [pid(req), r.type_id],
          )
        ).rows[0];
        await validateUser(
          pid(req),
          b.ownerId === undefined ? r.owner_id : b.ownerId,
          client,
        );
        await validateValues(
          pid(req),
          t.fields,
          b.values ?? r.field_values,
          client,
        );
        const saved = (
          await client.query<ObjectRow>(
            "UPDATE workspace_objects SET title=$4,owner_id=$5,field_values=$6::jsonb,archived=$7,revision=revision+1,updated_at=now() WHERE project_id=$1 AND id=$2 AND revision=$3 RETURNING *",
            [
              pid(req),
              id(req),
              b.revision,
              b.title ?? r.title,
              b.ownerId === undefined ? r.owner_id : b.ownerId,
              JSON.stringify(b.values ?? r.field_values),
              b.archived ?? r.archived,
            ],
          )
        ).rows[0];
        if (!saved) conflict();
        await history(
          pid(req),
          "object",
          id(req),
          req.user.sub,
          "object.updated",
          { before: r.field_values, after: saved.field_values },
          client,
        );
        return mapObject(saved);
      });
    },
  );
  app.get(
    "/entity-links",
    { preHandler: requirePerm("browse") },
    async (req) => {
      const ref = EntityRef.parse(req.query);
      return { items: await links(pid(req), ref) };
    },
  );
  app.post(
    "/entity-links",
    { preHandler: requirePerm("create"), preValidation: zbody(EntityLinkBody) },
    async (req) => {
      const b = req.body as z.infer<typeof EntityLinkBody>;
      for (const ref of [b.source, b.target]) {
        await assertLinkWrite(req, ref);
        if (ref.kind !== "issue")
          await writable(
            req,
            ref.kind === "document"
              ? "documents"
              : ref.kind === "object"
                ? "objects"
                : "processes",
          );
      }
      return linkEntities(pid(req), b.source, b.target, req.user.sub);
    },
  );
  app.delete(
    "/entity-links/:id",
    { preHandler: requirePerm("create"), preValidation: zparams(IdParams) },
    async (req) => {
      const r = (
        await q<{
          source_kind: EntityRef["kind"];
          source_id: string;
          target_kind: EntityRef["kind"];
          target_id: string;
        }>(
          "SELECT * FROM workspace_entity_links WHERE project_id=$1 AND id=$2",
          [pid(req), id(req)],
        )
      )[0];
      if (!r) throw notFound();
      for (const ref of [
        { kind: r.source_kind, id: r.source_id },
        { kind: r.target_kind, id: r.target_id },
      ]) {
        await assertLinkWrite(req, ref);
        if (ref.kind !== "issue")
          await writable(
            req,
            ref.kind === "document"
              ? "documents"
              : ref.kind === "object"
                ? "objects"
                : "processes",
          );
      }
      await q(
        "DELETE FROM workspace_entity_links WHERE project_id=$1 AND id=$2",
        [pid(req), id(req)],
      );
      return { ok: true };
    },
  );
  app.get(
    "/process-templates",
    { preHandler: requirePerm("browse") },
    async (req) => ({ items: await templates(pid(req)) }),
  );
  app.post(
    "/process-templates",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zbody(ProcessTemplateBody),
    },
    async (req, reply) => {
      await writable(req, "processes");
      const b = req.body as ProcessTemplateBody;
      await validateProcess(pid(req), b);
      const r = (
        await q<{ id: string }>(
          "INSERT INTO workspace_process_templates(project_id,name,draft) VALUES($1,$2,$3::jsonb) RETURNING id",
          [pid(req), b.name, JSON.stringify(b)],
        )
      )[0];
      reply.code(201);
      return (await templates(pid(req))).find((t) => t.id === r.id)!;
    },
  );
  app.patch(
    "/process-templates/:id",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: [
        zparams(IdParams),
        zbody(
          z
            .object({
              spec: ProcessTemplateBody,
              revision: z.number().int().positive(),
              archived: z.boolean().default(false),
            })
            .strict(),
        ),
      ],
    },
    async (req) => {
      await writable(req, "processes");
      const b = req.body as {
        spec: ProcessTemplateBody;
        revision: number;
        archived: boolean;
      };
      await validateProcess(pid(req), b.spec);
      await entityTemplate(pid(req), id(req));
      const r = await q(
        "UPDATE workspace_process_templates SET name=$4,draft=$5::jsonb,archived=$6,revision=revision+1 WHERE project_id=$1 AND id=$2 AND revision=$3 RETURNING id",
        [
          pid(req),
          id(req),
          b.revision,
          b.spec.name,
          JSON.stringify(b.spec),
          b.archived,
        ],
      );
      if (!r.length) conflict();
      return (await templates(pid(req))).find((t) => t.id === id(req))!;
    },
  );
  app.post(
    "/process-templates/:id/publish",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zparams(IdParams),
    },
    async (req) => {
      await writable(req, "processes");
      return withTransaction(async (client) => {
        const t = (
          await client.query<{ draft: ProcessTemplateBody }>(
            "SELECT draft FROM workspace_process_templates WHERE project_id=$1 AND id=$2 AND NOT archived FOR UPDATE",
            [pid(req), id(req)],
          )
        ).rows[0];
        if (!t) throw notFound();
        await validateProcess(pid(req), t.draft, client);
        const v = (
          await client.query<{ id: string; version: number }>(
            "INSERT INTO workspace_process_versions(template_id,version,spec) SELECT $1,COALESCE(max(version),0)+1,$2::jsonb FROM workspace_process_versions WHERE template_id=$1 RETURNING id,version",
            [id(req), JSON.stringify(t.draft)],
          )
        ).rows[0];
        await client.query(
          "UPDATE workspace_process_templates SET published_version_id=$3,revision=revision+1 WHERE project_id=$1 AND id=$2",
          [pid(req), id(req), v.id],
        );
        await history(
          pid(req),
          "template",
          id(req),
          req.user.sub,
          "template.published",
          { versionId: v.id },
          client,
        );
        return v;
      });
    },
  );
  app.post(
    "/process-templates/:id/preview",
    { preHandler: requirePerm("browse"), preValidation: zparams(IdParams) },
    async (req) => {
      const template = (
        await q<{ spec: z.infer<typeof ProcessTemplateBody>; version_id: string | null }>(
          "SELECT COALESCE(v.spec,t.draft) spec,t.published_version_id version_id FROM workspace_process_templates t LEFT JOIN workspace_process_versions v ON t.published_version_id=v.id WHERE t.project_id=$1 AND t.id=$2",
          [pid(req), id(req)],
        )
      )[0];
      if (!template) throw notFound();
      const spec = template.spec;
      return {
        steps: spec.steps,
        errors: validateGraph(spec),
        versionId: template.version_id,
      };
    },
  );
  app.get(
    "/process-runs",
    { preHandler: requirePerm("browse") },
    async (req) => ({
      items: await q(
        'SELECT id,title,state,error,created_at AS "createdAt" FROM workspace_process_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200',
        [pid(req)],
      ),
    }),
  );
  app.post(
    "/process-runs",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zbody(ProcessStartBody),
    },
    async (req, reply) => {
      await writable(req, "processes");
      const b = req.body as z.infer<typeof ProcessStartBody>;
      const runId = await withTransaction((c) =>
        startProcess(pid(req), req.user.sub, b, c),
      );
      reply.code(201);
      return getRun(pid(req), runId);
    },
  );
  app.get("/process-runs/:id", reader, async (req) =>
    getRun(pid(req), id(req)),
  );
  app.post(
    "/process-runs/:id/control",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: [
        zparams(IdParams),
        zbody(
          z.object({ action: z.enum(["pause", "resume", "cancel"]) }).strict(),
        ),
      ],
    },
    async (req) => {
      await writable(req, "processes");
      const action = (req.body as { action: string }).action;
      await withTransaction(async (client) => {
        const current = (await client.query<{ state: string }>(
          "SELECT state FROM workspace_process_runs WHERE project_id=$1 AND id=$2 FOR UPDATE",
          [pid(req), id(req)],
        )).rows[0];
        if (!current) throw notFound();
        if (current.state === "completed" || current.state === "cancelled")
          throw badRequest("Процесс завершён");
        await client.query(
          "UPDATE workspace_process_runs SET state=$3,error=NULL,owner_id=$4 WHERE project_id=$1 AND id=$2",
          [
            pid(req),
            id(req),
            action === "resume"
              ? "running"
              : action === "pause"
                ? "paused"
                : "cancelled",
            req.user.sub,
          ],
        );
        await history(
          pid(req),
          "process",
          id(req),
          req.user.sub,
          `process.${action}`,
          {},
          client,
        );
        if (action === "resume") {
          const missing = await client.query<{ step_key: string }>(
            "UPDATE workspace_process_steps SET state='waiting',approved=false,review_revision=NULL WHERE run_id=$1 AND issue_id IS NULL AND state IN ('active','review','completed') RETURNING step_key",
            [id(req)],
          );
          for (const step of missing.rows)
            await history(pid(req), "process", id(req), req.user.sub,
              "step.recreated", { key: step.step_key }, client);
          await advanceRun(client, id(req));
        }
      });
      return getRun(pid(req), id(req));
    },
  );
  app.post(
    "/process-runs/:id/review",
    {
      preHandler: requirePerm("browse"),
      preValidation: [
        zparams(IdParams),
        zbody(
          z
            .object({
              stepId: z.string().uuid(),
              action: z.enum(["approve", "return"]),
              reviewRevision: z.number().int().nonnegative(),
              reason: z.string().max(2000).default(""),
            })
            .strict(),
        ),
      ],
    },
    async (req) => {
      await writable(req, "processes");
      const b = req.body as { stepId: string; action: string; reason: string; reviewRevision: number };
      await withTransaction(async (client) => {
        const run = (
          await client.query<{ state: string; owner_id: string }>(
            "SELECT state,owner_id FROM workspace_process_runs WHERE project_id=$1 AND id=$2 FOR UPDATE",
            [pid(req), id(req)],
          )
        ).rows[0];
        if (!run) throw notFound();
        if (run.state !== "running") throw badRequest("Процесс не выполняется");
        const step = (
          await client.query<{
            spec: { reviewerId: string };
            issue_id: string;
            state: string;
            review_revision: number | null;
          }>(
            "SELECT * FROM workspace_process_steps WHERE run_id=$1 AND id=$2 FOR UPDATE",
            [id(req), b.stepId],
          )
        ).rows[0];
        if (!step) throw notFound();
        if (
          req.projectRole === "viewer" ||
          (step.spec.reviewerId !== req.user.sub &&
            req.projectRole !== "admin" &&
            req.projectRole !== "manager")
        )
          throw forbidden("Вы не назначены проверяющим");
        if (step.state !== "review")
          throw badRequest("Этап не ожидает проверки");
        const issue = (await client.query<{ category: string; workspace_result_revision: number }>(
          "SELECT s.category,i.workspace_result_revision FROM issues i JOIN workflow_statuses s ON s.id=i.status_id WHERE i.project_id=$1 AND i.id=$2",
          [pid(req), step.issue_id],
        )).rows[0];
        if (!issue || issue.category !== "done" ||
          issue.workspace_result_revision !== step.review_revision ||
          b.reviewRevision !== step.review_revision)
          throw resultConflict("Результат этапа изменился. Обновите процесс и проверьте новый результат");
        if (b.action === "return") {
          const target = (
            await client.query<{ id: string }>(
              `SELECT t.to_status_id id FROM workflow_transitions t JOIN issues i ON i.status_id=t.from_status_id JOIN workflow_statuses s ON s.id=t.to_status_id WHERE i.id=$1 AND i.project_id=$2 AND s.category='inprogress' ORDER BY s.position LIMIT 1`,
              [step.issue_id, pid(req)],
            )
          ).rows[0];
          if (!target) throw badRequest("В workflow нет перехода на доработку");
          await transitionIssue(
            pid(req),
            step.issue_id,
            target.id,
            null,
            req.user.sub,
            true,
            undefined,
            undefined,
            client,
          );
          await client.query(
            "UPDATE workspace_process_steps SET state='active',approved=false,review_revision=NULL WHERE id=$1",
            [b.stepId],
          );
        } else
          await client.query(
            "UPDATE workspace_process_steps SET approved=true WHERE id=$1",
            [b.stepId],
          );
        await history(
          pid(req),
          "process",
          id(req),
          req.user.sub,
          `step.${b.action}`,
          { stepId: b.stepId, reason: b.reason },
          client,
        );
        await advanceRun(client, id(req));
      });
      return getRun(pid(req), id(req));
    },
  );
  app.get(
    "/automation-rules",
    { preHandler: requirePerm("browse") },
    async (req) => ({
      items: (
        await q<{
          id: string;
          owner_id: string;
          spec: AutomationRuleBody;
          enabled: boolean;
          error: string | null;
        }>("SELECT * FROM workspace_rules WHERE project_id=$1 ORDER BY name", [
          pid(req),
        ])
      ).map(
        (r) =>
          ({
            ...r.spec,
            id: r.id,
            ownerId: r.owner_id,
            enabled: r.enabled,
            error: r.error,
          }) satisfies AutomationRule,
      ),
    }),
  );
  app.post(
    "/automation-rules",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zbody(AutomationRuleBody),
    },
    async (req) => {
      await writable(req, "processes");
      const b = req.body as AutomationRuleBody;
      return (
        await q<{ id: string }>(
          "INSERT INTO workspace_rules(project_id,owner_id,name,spec,enabled) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id",
          [pid(req), req.user.sub, b.name, JSON.stringify(b), b.enabled],
        )
      )[0];
    },
  );
  app.patch(
    "/automation-rules/:id",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: [zparams(IdParams), zbody(AutomationRuleBody)],
    },
    async (req) => {
      await writable(req, "processes");
      const b = req.body as AutomationRuleBody;
      const r = await q(
        "UPDATE workspace_rules SET owner_id=$3,name=$4,spec=$5::jsonb,enabled=$6,error=NULL WHERE project_id=$1 AND id=$2 RETURNING id",
        [pid(req), id(req), req.user.sub, b.name, JSON.stringify(b), b.enabled],
      );
      if (!r.length) throw notFound();
      return r[0];
    },
  );
  app.get("/automation-rules/:id/executions", reader, async (req) => {
    if (
      !(
        await q(
          "SELECT id FROM workspace_rules WHERE project_id=$1 AND id=$2",
          [pid(req), id(req)],
        )
      ).length
    )
      throw notFound();
    const rows = await q<{
      id: string;
      type: string;
      attempts: number;
      error: string | null;
      processed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT e.* FROM workspace_events e WHERE e.project_id=$1 AND (e.failed_rule_id=$2 OR EXISTS(SELECT 1 FROM workspace_rule_executions x WHERE x.event_id=e.id AND x.rule_id=$2)) ORDER BY e.created_at DESC LIMIT 50`,
      [pid(req), id(req)],
    );
    const actions = await q<{
      event_id: string;
      execution_key: string;
      action_type: string;
      result: unknown;
    }>(
      "SELECT * FROM workspace_action_executions WHERE rule_id=$1 AND event_id=ANY($2::uuid[]) ORDER BY action_index",
      [id(req), rows.map((r) => r.id)],
    );
    return {
      items: rows.map((r) => ({
        eventId: r.id,
        type: r.type,
        attempts: r.attempts,
        error: r.error,
        processedAt: r.processed_at ? iso(r.processed_at) : null,
        createdAt: iso(r.created_at),
        actions: actions
          .filter((a) => a.event_id === r.id)
          .map((a) => ({
            key: a.execution_key,
            type: a.action_type,
            result: a.result,
          })),
      })),
    };
  });
  app.post(
    "/automation-rules/:id/executions/:eventId/retry",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zparams(IdParams.extend({ eventId: z.string().uuid() })),
    },
    async (req) => {
      await writable(req, "processes");
      const event = (
        await q<{ id: string; error: string | null }>(
          "SELECT e.id,e.error FROM workspace_events e JOIN workspace_rules r ON r.id=e.failed_rule_id WHERE r.id=$2 AND r.project_id=$1 AND e.project_id=$1 AND e.id=$3",
          [pid(req), id(req), (req.params as { eventId: string }).eventId],
        )
      )[0];
      if (!event) throw notFound();
      if (!event.error) throw badRequest("Нет ошибки для повторения");
      await q(
        "UPDATE workspace_events SET attempts=0,error=NULL WHERE id=$1 AND processed_at IS NULL",
        [event.id],
      );
      return { ok: true };
    },
  );
  app.post(
    "/automation-rules/preview",
    {
      preHandler: requirePerm("manageProcesses"),
      preValidation: zbody(
        z
          .object({ rule: AutomationRuleBody, values: z.record(z.string(), z.unknown()) })
          .strict(),
      ),
    },
    async (req) => {
      const b = req.body as {
        rule: AutomationRuleBody;
        values: Record<string, unknown>;
      };
      return {
        matches: matches(b.rule.when, b.values),
        actions: matches(b.rule.when, b.values) ? b.rule.actions : [],
      };
    },
  );
  app.get("/plans", { preHandler: requirePerm("browse") }, async (req) => ({
    items: (
      await q<PlanRow>(
        "SELECT * FROM workspace_plans WHERE project_id=$1 ORDER BY updated_at DESC",
        [pid(req)],
      )
    ).map(mapPlan),
  }));
  app.post(
    "/plans",
    {
      preHandler: requirePerm("managePlans"),
      preValidation: zbody(
        PlanBody.extend({ planId: z.string().uuid().nullable().default(null) }),
      ),
    },
    async (req, reply) => {
      await writable(req, "planning");
      const b = req.body as z.infer<typeof PlanBody> & {
        planId: string | null;
      };
      await validatePlan(pid(req), b.items);
      if (
        b.planId &&
        !(
          await q(
            "SELECT id FROM workspace_plans WHERE project_id=$1 AND id=$2",
            [pid(req), b.planId],
          )
        ).length
      )
        throw notFound();
      const r = (
        await q<PlanRow>(
          "INSERT INTO workspace_plans(project_id,plan_id,name,target_date,items) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *",
          [pid(req), b.planId, b.name, b.targetDate, JSON.stringify(b.items)],
        )
      )[0];
      reply.code(201);
      return mapPlan(r);
    },
  );
  app.get(
    "/plans/work-items",
    { preHandler: requirePerm("browse") },
    async (req) => {
      const issues = await q<{
        id: string;
        title: string;
        complexity: PlanItem["complexity"];
        assignee_ids: string[];
        due_date: string | null;
      }>(
        "SELECT i.id,i.title,i.complexity,i.due_date,ARRAY(SELECT a.user_id FROM issue_assignees a WHERE a.issue_id=i.id) assignee_ids FROM issues i JOIN workflow_statuses s ON s.id=i.status_id WHERE i.project_id=$1 AND s.category<>'done' AND i.archived_at IS NULL ORDER BY i.priority_id,i.rank LIMIT 501",
        [pid(req)],
      );
      const deps = await q<{ issue_id: string; linked_issue_id: string }>(
        "SELECT l.issue_id,l.linked_issue_id FROM issue_links l JOIN issues i ON i.id=l.issue_id WHERE i.project_id=$1 AND l.link_type='blocks'",
        [pid(req)],
      );
      const steps = await q<{
        id: string;
        spec: z.infer<typeof ProcessTemplateBody>["steps"][number];
        run_id: string;
        step_key: string;
        issue_id: string | null;
        state: string;
      }>(
        "SELECT s.* FROM workspace_process_steps s JOIN workspace_process_runs r ON r.id=s.run_id WHERE r.project_id=$1 AND r.state IN ('running','paused') ",
        [pid(req)],
      );
      return {
        items: [
          ...issues.slice(0, 500).map((i) => ({
            kind: "issue" as const,
            id: i.id,
            title: i.title,
            complexity: i.complexity,
            dependsOn: deps
              .filter((d) => d.linked_issue_id === i.id)
              .map((d) => d.issue_id),
            assigneeIds: i.assignee_ids,
            dueDate: i.due_date,
          })),
          ...steps
            .filter((s) => s.state === "waiting")
            .map((s) => ({
              kind: "step" as const,
              id: s.id,
              title: s.spec.title,
              complexity: s.spec.complexity,
              dependsOn: s.spec.dependsOn
                .map(
                  (k) =>
                    steps.find((d) => d.run_id === s.run_id && d.step_key === k)
                      ?.issue_id ??
                    steps.find(
                      (d) =>
                        d.run_id === s.run_id &&
                        d.step_key === k &&
                        d.state === "waiting",
                    )?.id,
                )
                .filter((v): v is string => !!v),
              assigneeIds: s.spec.assigneeIds,
              dueDate: null,
            })),
        ],
        truncated: issues.length > 500,
      };
    },
  );
  app.patch(
    "/plans/:id",
    {
      preHandler: requirePerm("managePlans"),
      preValidation: [
        zparams(IdParams),
        zbody(PlanBody.extend({ revision: z.number().int().positive() })),
      ],
    },
    async (req) => {
      await writable(req, "planning");
      const b = req.body as z.infer<typeof PlanBody> & { revision: number };
      if (
        !(
          await q(
            "SELECT id FROM workspace_plans WHERE project_id=$1 AND id=$2",
            [pid(req), id(req)],
          )
        ).length
      )
        throw notFound();
      await validatePlan(pid(req), b.items);
      const r = (
        await q<PlanRow>(
          "UPDATE workspace_plans SET name=$4,target_date=$5,items=$6::jsonb,revision=revision+1,updated_at=now() WHERE project_id=$1 AND id=$2 AND revision=$3 RETURNING *",
          [
            pid(req),
            id(req),
            b.revision,
            b.name,
            b.targetDate,
            JSON.stringify(b.items),
          ],
        )
      )[0];
      if (!r) conflict();
      return mapPlan(r);
    },
  );
  app.get("/plans/:id/forecast", reader, async (req) => {
    const plan = (
      await q<PlanRow>(
        "SELECT * FROM workspace_plans WHERE project_id=$1 AND id=$2",
        [pid(req), id(req)],
      )
    )[0];
    if (!plan) throw notFound();
    const completed = await q<{
      id: string;
      complexity: string | null;
      completedAt: Date;
    }>(
      `SELECT issue_id id,complexity,completed_at AS "completedAt" FROM workspace_completion_history WHERE project_id=$1 AND completed_at>=now()-interval '90 days'`,
      [pid(req)],
    );
    return forecast(
      await remainingPlan(pid(req), plan.items),
      completed.map((c) => ({ ...c, completedAt: iso(c.completedAt) })),
    );
  });
}
async function entityTemplate(projectId: string, id: string) {
  const t = (await templates(projectId)).find((t) => t.id === id);
  if (!t) throw notFound();
  return t;
}
