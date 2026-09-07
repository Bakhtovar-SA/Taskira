/** Комментарии к задачам: GET /api/issues/:id/comments · POST — то же. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { q } from "../db.js";
import { requireIssuePerm, requirePerm, zbody, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";
import { loadIssue } from "../services/issues.js";
import { CommentBody } from "../contract.js";

interface CommentRow {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: Date;
  author_name: string;
  author_initials: string;
  author_color: string;
}

export interface CommentDto {
  id: string;
  issueId: string;
  authorId: string;
  author: { id: string; name: string; initials: string; color: string };
  body: string;
  createdAt: string;
}

const mapComment = (r: CommentRow): CommentDto => ({
  id: r.id,
  issueId: r.issue_id,
  authorId: r.author_id,
  author: { id: r.author_id, name: r.author_name, initials: r.author_initials, color: r.author_color },
  body: r.body,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/comments", { preHandler: requirePerm("browse") }, async (req) => {
    const project = req.project!;
    const { id } = req.params as { id: string };
    const iss = await loadIssue(project.id, id);
    const rows = await q<CommentRow>(
      `SELECT c.id, c.issue_id, c.author_id, c.body, c.created_at,
              u.name AS author_name, u.initials AS author_initials, u.color AS author_color
         FROM comments c
         JOIN users u ON u.id = c.author_id
        WHERE c.issue_id = $1
        ORDER BY c.created_at`,
      [iss.id],
    );
    return rows.map(mapComment);
  });

  app.post(
    "/:id/comments",
    { preHandler: requireIssuePerm("comment"), preValidation: zbody(CommentBody) },
    async (req, reply) => {
      const project = req.project!;
      const { id } = req.params as { id: string };
      const user: JwtPayload = req.user;
      const body = req.body as z.infer<typeof CommentBody>;
      const iss = await loadIssue(project.id, id);

      const row = (
        await q<CommentRow>(
          `INSERT INTO comments (issue_id, author_id, body)
           VALUES ($1, $2, $3)
           RETURNING id, issue_id, author_id, body, created_at,
                     (SELECT name FROM users WHERE id = $2) AS author_name,
                     (SELECT initials FROM users WHERE id = $2) AS author_initials,
                     (SELECT color FROM users WHERE id = $2) AS author_color`,
          [iss.id, user.sub, body.body],
        )
      )[0];

      await audit(user.sub, "comment.create", "issue", iss.id, { key: iss.key });
      reply.code(201).send(mapComment(row));
    },
  );
}
