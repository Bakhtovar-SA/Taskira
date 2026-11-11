import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requirePerm, zquery } from "../middleware.js";
import {
  ProjectFilesQuery,
  type ProjectFilesResult,
} from "../workspaceContract.js";

/** A project catalogue over existing attachments; downloads keep their source permissions. */
export async function projectFileRoutes(app: FastifyInstance) {
  app.get(
    "/files",
    {
      preHandler: requirePerm("browse"),
      preValidation: zquery(ProjectFilesQuery),
    },
    async (req): Promise<ProjectFilesResult> => {
      const filter = req.query as ProjectFilesQuery;
      const order = {
        newest: "created_at DESC, id DESC",
        oldest: "created_at ASC, id ASC",
        name: "lower(filename), id",
        size: "size DESC, id",
      }[filter.sort];
      const [result] = await q<{
        items: Array<{
          id: string;
          filename: string;
          content_type: string;
          size: number;
          created_at: string;
          uploaded_by: string | null;
          uploader_name: string | null;
          source_kind: "issue" | "document";
          source_id: string;
          source_title: string;
          source_key: string | null;
          archived: boolean;
        }>;
        total: number;
        total_bytes: string;
      }>(
        `WITH files AS (
      SELECT a.id,a.filename,a.content_type,a.byte_size AS size,a.created_at,
        a.uploaded_by,u.name AS uploader_name,'issue'::text AS source_kind,
        i.id AS source_id,i.title AS source_title,i.key AS source_key,
        i.archived_at IS NOT NULL AS archived
      FROM attachments a JOIN issues i ON i.id=a.issue_id
      LEFT JOIN users u ON u.id=a.uploaded_by WHERE i.project_id=$1
      UNION ALL
      SELECT a.id,a.filename,a.content_type,a.size,a.created_at,
        a.created_by,u.name,'document',d.id,d.title,NULL,d.archived
      FROM workspace_document_files a JOIN workspace_documents d ON d.id=a.document_id
      LEFT JOIN users u ON u.id=a.created_by WHERE d.project_id=$1
    ), filtered AS (
      SELECT * FROM files WHERE ($2='all' OR source_kind=$2)
      AND ($3='' OR strpos(lower(filename||' '||source_title||' '||coalesce(source_key,'')),lower($3))>0)
    ) SELECT coalesce((SELECT jsonb_agg(p) FROM (
      SELECT * FROM filtered ORDER BY ${order} LIMIT $4 OFFSET $5
    ) p),'[]'::jsonb) AS items,
    count(*)::integer AS total,coalesce(sum(size),0)::text AS total_bytes FROM filtered`,
        [req.project!.id, filter.source, filter.q, filter.limit, filter.offset],
      );
      return {
        items: result.items.map((row) => ({
          id: row.id,
          filename: row.filename,
          contentType: row.content_type,
          size: row.size,
          createdAt: new Date(row.created_at).toISOString(),
          uploadedBy: row.uploaded_by,
          uploaderName: row.uploader_name,
          source: {
            kind: row.source_kind,
            id: row.source_id,
            title: row.source_title,
            key: row.source_key,
            archived: row.archived,
          },
        })),
        total: result.total,
        totalBytes: Number(result.total_bytes),
        offset: filter.offset,
        limit: filter.limit,
      };
    },
  );
}
