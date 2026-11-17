import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requirePerm, zquery } from "../middleware.js";
import { ProjectFilesQuery, type ProjectFileDto, type ProjectFilesResultDto } from "../contract.js";

interface FileRow {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  file_type: ProjectFileDto["type"];
  issue_id: string;
  issue_key: string;
  issue_title: string;
  archived: boolean;
}

/** Read-only catalogue over existing task attachments. No duplicate storage or permissions. */
export async function projectFileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/files", {
    // Deliberately project-scoped: an invitation to one issue never opens this catalogue.
    preHandler: requirePerm("browse"),
    preValidation: zquery(ProjectFilesQuery),
  }, async (req): Promise<ProjectFilesResultDto> => {
    const filter = req.query as ProjectFilesQuery;
    // Every SQL fragment comes from this closed map, never from query text.
    const order = {
      newest: "created_at DESC, id DESC",
      oldest: "created_at ASC, id ASC",
      name: "lower(filename), id",
      size: "byte_size DESC, id",
    }[filter.sort];
    const [result] = await q<{ items: FileRow[]; total: number; total_bytes: string }>(
      `WITH files AS (
        SELECT a.id, a.filename, a.content_type, a.byte_size, a.created_at,
          a.uploaded_by, u.name AS uploader_name,
          i.id AS issue_id, i.key AS issue_key, i.title AS issue_title,
          i.archived_at IS NOT NULL AS archived,
          CASE
            WHEN a.content_type LIKE 'image/%' THEN 'images'
            WHEN lower(a.filename) ~ '\\.(zip|rar|7z|gz|gzip|tgz|bz2|xz|tar)$'
              OR a.content_type IN ('application/zip', 'application/x-zip-compressed',
                'application/x-7z-compressed', 'application/vnd.rar', 'application/x-rar-compressed',
                'application/gzip', 'application/x-gzip', 'application/x-tar', 'application/x-bzip2', 'application/x-xz') THEN 'archives'
            WHEN a.content_type LIKE 'text/%'
              OR a.content_type IN ('application/pdf', 'application/msword', 'application/rtf',
                'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/json', 'application/xml')
              OR a.content_type LIKE 'application/vnd.openxmlformats-officedocument.%'
              OR a.content_type LIKE 'application/vnd.oasis.opendocument.%'
              OR lower(a.filename) ~ '\\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|log|csv|md)$' THEN 'documents'
            ELSE 'other'
          END AS file_type
        FROM attachments a
        JOIN issues i ON i.id = a.issue_id
        LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE i.project_id = $1
      ), filtered AS (
        SELECT * FROM files
        WHERE ($2::text = 'all' OR file_type = $2::text)
          AND ($3::text = '' OR strpos(lower(filename || ' ' || issue_key || ' ' || issue_title), lower($3::text)) > 0)
      )
      SELECT coalesce((SELECT jsonb_agg(p) FROM (
        SELECT * FROM filtered ORDER BY ${order} LIMIT $4 OFFSET $5
      ) p), '[]'::jsonb) AS items,
        count(*)::integer AS total, coalesce(sum(byte_size), 0)::text AS total_bytes
      FROM filtered`,
      [req.project!.id, filter.type, filter.q, filter.limit, filter.offset],
    );
    return {
      items: result.items.map((row) => ({
        id: row.id,
        filename: row.filename,
        contentType: row.content_type,
        byteSize: row.byte_size,
        createdAt: new Date(row.created_at).toISOString(),
        uploadedById: row.uploaded_by,
        uploaderName: row.uploader_name,
        type: row.file_type,
        issue: { id: row.issue_id, key: row.issue_key, title: row.issue_title, archived: row.archived },
      })),
      total: result.total,
      totalBytes: Number(result.total_bytes),
      limit: filter.limit,
      offset: filter.offset,
    };
  });
}
