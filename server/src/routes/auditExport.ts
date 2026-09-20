import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { q } from "../db.js";
import { requireGlobalAdmin, zquery } from "../middleware.js";

const ExportQuery = z.object({
  format: z.enum(["jsonl", "csv"]).default("jsonl"),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100_000).default(10_000),
});

interface AuditExportRow {
  created_at: Date;
  actor: string;
  action: string;
  object: string;
  result: "success" | "denied" | "error";
  details: Record<string, unknown>;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function auditExportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/audit-log/export",
    { preHandler: requireGlobalAdmin, preValidation: zquery(ExportQuery) },
    async (req, reply) => {
      const query = ExportQuery.parse(req.query);
      const result = await q<AuditExportRow>(
        `SELECT a.created_at,
                COALESCE(u.username, a.actor_id::text, 'anonymous') AS actor,
                a.action,
                a.entity || CASE WHEN a.entity_id IS NULL THEN '' ELSE ':' || a.entity_id::text END AS object,
                a.result,
                a.details
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actor_id
          WHERE ($1::timestamptz IS NULL OR a.created_at >= $1)
            AND ($2::timestamptz IS NULL OR a.created_at < $2)
          ORDER BY a.created_at, a.id
          LIMIT $3`,
        [query.from ?? null, query.to ?? null, query.limit + 1],
      );
      const truncated = result.length > query.limit;
      const rows = truncated ? result.slice(0, query.limit) : result;
      reply.header("X-Taskira-Truncated", String(truncated));
      reply.header("X-Taskira-Limit", String(query.limit));

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await audit(req.user.sub, "audit.export", "audit", null, {
        format: query.format,
        from: query.from ?? null,
        to: query.to ?? null,
        rows: rows.length,
        truncated,
      });

      if (query.format === "csv") {
        const lines = ["timestamp,actor,action,object,result,details"];
        for (const row of rows) {
          lines.push([
            row.created_at.toISOString(),
            row.actor,
            row.action,
            row.object,
            row.result,
            JSON.stringify(row.details),
          ].map(csvCell).join(","));
        }
        reply.type("text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="taskira-audit-${stamp}.csv"`);
        return `${lines.join("\n")}\n`;
      }

      reply.type("application/x-ndjson; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="taskira-audit-${stamp}.jsonl"`);
      return rows.map((row) => JSON.stringify({
        timestamp: row.created_at.toISOString(),
        actor: row.actor,
        action: row.action,
        object: row.object,
        result: row.result,
        details: row.details,
      })).join("\n") + (rows.length ? "\n" : "");
    },
  );
}
