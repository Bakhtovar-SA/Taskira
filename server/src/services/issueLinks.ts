/** Доменные хелперы связей между задачами (issue_links, миграция 014).
 *  Модель минимальна: 'relates' (симметрична) + 'blocks' (направлена).
 *  См. ticket-features-polish-round4.md §3.2. */
import { one, q } from "../db.js";
import type { IssueLinkDir } from "../contract.js";

export interface IssueLinkDto {
  id: string;
  /** тип связи со стороны запрошенной задачи */
  dir: IssueLinkDir;
  /** задача на другом конце связи */
  issue: {
    id: string;
    key: string;
    title: string;
    typeId: string;
    statusId: string;
    statusCategory: string;
  };
  createdAt: string;
}

interface Row {
  id: string;
  link_type: "relates" | "blocks";
  /** true — запрошенная задача стоит в issue_id (исходная сторона) */
  outgoing: boolean;
  other_id: string;
  other_key: string;
  other_title: string;
  other_type_id: string;
  other_status_id: string;
  other_status_category: string;
  created_at: Date;
}

/** Все связи задачи, с обеих сторон, с мини-карточкой второй задачи.
 *  `blocks`, увиденная с конца linked_issue_id, отдаётся как `blocked_by`. */
export async function listIssueLinks(issueId: string): Promise<IssueLinkDto[]> {
  const rows = await q<Row>(
    `SELECT l.id, l.link_type, l.created_at,
            (l.issue_id = $1)         AS outgoing,
            o.id                      AS other_id,
            o.key                     AS other_key,
            o.title                   AS other_title,
            o.type_id                 AS other_type_id,
            o.status_id               AS other_status_id,
            s.category                AS other_status_category
       FROM issue_links l
       JOIN issues o
         ON o.id = CASE WHEN l.issue_id = $1 THEN l.linked_issue_id ELSE l.issue_id END
       JOIN workflow_statuses s ON s.id = o.status_id
      WHERE l.issue_id = $1 OR l.linked_issue_id = $1
      ORDER BY l.created_at DESC`,
    [issueId],
  );
  return rows.map((r) => ({
    id: r.id,
    dir:
      r.link_type === "relates"
        ? "relates"
        : r.outgoing
          ? "blocks"
          : "blocked_by",
    issue: {
      id: r.other_id,
      key: r.other_key,
      title: r.other_title,
      typeId: r.other_type_id,
      statusId: r.other_status_id,
      statusCategory: r.other_status_category,
    },
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Существует ли уже такая связь (в любую сторону для relates). */
export async function linkExists(
  a: string,
  b: string,
  type: "relates" | "blocks",
): Promise<boolean> {
  if (type === "relates") {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return !!(await one(`SELECT 1 FROM issue_links WHERE link_type = 'relates' AND issue_id = $1 AND linked_issue_id = $2`, [lo, hi]));
  }
  // blocks: направление значимо, но конфликт и обратное направление тоже считаем дублем
  return !!(await one(
    `SELECT 1 FROM issue_links
      WHERE link_type = 'blocks'
        AND ((issue_id = $1 AND linked_issue_id = $2) OR (issue_id = $2 AND linked_issue_id = $1))`,
    [a, b],
  ));
}

/** Вставка связи. Для 'relates' нормализует порядок пары (issue_id < linked). */
export async function insertIssueLink(
  fromId: string,
  toId: string,
  type: "relates" | "blocks",
  createdBy: string,
): Promise<string> {
  const [issueId, linkedId] = type === "relates" && fromId > toId ? [toId, fromId] : [fromId, toId];
  const row = await one<{ id: string }>(
    `INSERT INTO issue_links (issue_id, linked_issue_id, link_type, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [issueId, linkedId, type, createdBy],
  );
  return row!.id;
}
