/** Кросс-проектный поиск задач (миграция 024) — по ВСЕМ видимым пользователю
 *  проектам, не только текущему. Project-less — регистрируется на уровне /api
 *  (по образцу routes/home.ts). Открытие найденной задачи идёт обычным путём
 *  GET /api/projects/:projectId/issues/:id — этот роут отдаёт только то,
 *  что нужно для карточки результата и перехода: id/key/title + принадлежность
 *  проекту. */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { escLike, one, q } from "../db.js";
import { notFound, requireAuth, zquery, type JwtPayload } from "../middleware.js";
import { IssueResolveQuery, SearchQuery } from "../contract.js";
import type { IssueResolveDto, SearchResultDto, SearchResultItemDto } from "../contract.js";

interface Row {
  id: string;
  project_id: string;
  key: string;
  title: string;
  type_id: SearchResultItemDto["typeId"];
  priority_id: SearchResultItemDto["priorityId"];
  status_id: string;
  status_name: string;
  status_category: SearchResultItemDto["statusCategory"];
  project_key: string;
  project_name: string;
}

/** Та же щедрость, что HOME_LIMIT в routes/home.ts — потолок на честный ответ,
 *  не на молчаливое усечение (клиент видит truncated и говорит об этом). */
const SEARCH_LIMIT = 30;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/issues/search", { preHandler: [requireAuth, zquery(SearchQuery)] }, async (req): Promise<SearchResultDto> => {
    const user: JwtPayload = req.user;
    const { q: query } = req.query as z.infer<typeof SearchQuery>;
    const isGlobalAdmin = user.globalRole === "admin";
    const like = `%${escLike(query)}%`;

    // ТЗ 3.4 (план v2 Трек 3): полнотекстовый поиск по названию/описанию,
    // комментариям и пунктам чек-листа (миграция 20260922T1400 — три отдельные
    // generated-tsvector-колонки, см. её комментарий: агрегировать их в одну
    // через LEFT JOIN в generated-выражении технически невозможно, поэтому
    // объединение — здесь, запросом с UNION, не в схеме). Ключ задачи — ОТДЕЛЬНАЯ
    // ветка с ILIKE (не FTS: "CORP-123" — структурный код, а не текст словаря)
    // с фиксированным высоким рангом, чтобы точное/частичное совпадение по
    // ключу не проигрывало посредственному текстовому совпадению по ранжированию.
    // Комментарии/чек-лист дают тот же issue, но с заниженным весом (* 0.5) —
    // совпадение в заголовке/описании обязано ранжироваться выше совпадения в
    // старом комментарии (буквальное требование ТЗ), а не просто "тоже нашлось".
    const rows = await q<Row & { rank: number }>(
      `WITH tsq AS (SELECT websearch_to_tsquery('simple', $1) AS q),
            matches AS (
              SELECT i.id AS issue_id, ts_rank(i.search_vector, tsq.q) AS rank
                FROM issues i CROSS JOIN tsq
               WHERE i.archived_at IS NULL AND i.search_vector @@ tsq.q
              UNION ALL
              SELECT i.id AS issue_id, 1.0 AS rank
                FROM issues i
               WHERE i.archived_at IS NULL AND i.key ILIKE $2
              UNION ALL
              SELECT c.issue_id, ts_rank(c.search_vector, tsq.q) * 0.5 AS rank
                FROM comments c JOIN issues i ON i.id = c.issue_id CROSS JOIN tsq
               WHERE i.archived_at IS NULL AND c.search_vector @@ tsq.q
              UNION ALL
              SELECT ci.issue_id, ts_rank(ci.search_vector, tsq.q) * 0.5 AS rank
                FROM checklist_items ci JOIN issues i ON i.id = ci.issue_id CROSS JOIN tsq
               WHERE i.archived_at IS NULL AND ci.search_vector @@ tsq.q
            ),
            best AS (SELECT issue_id, max(rank) AS rank FROM matches GROUP BY issue_id)
       SELECT i.id, i.project_id, i.key, i.title, i.type_id, i.priority_id, i.status_id,
              ws.name AS status_name, ws.category AS status_category,
              p.key AS project_key, p.name AS project_name, best.rank
         FROM best
         JOIN issues i ON i.id = best.issue_id
         JOIN projects p ON p.id = i.project_id
         JOIN workflow_statuses ws ON ws.id = i.status_id
        -- Предикат видимости ОБЯЗАН совпадать с services/projects.ts listVisibleProjects
        -- (участник ∪ департамент ∪ is_shared ∪ глобальный admin) — тот же инвариант,
        -- что уже прокомментирован в routes/home.ts для assigned-to-me: иначе поиск
        -- покажет задачи из проектов, которые потом не открыть.
        WHERE ($4
               OR EXISTS (SELECT 1 FROM project_members pm
                           WHERE pm.project_id = p.id AND pm.user_id = $3)
               OR EXISTS (SELECT 1 FROM department_members dm
                           WHERE dm.department_id = p.department_id AND dm.user_id = $3)
               OR p.is_shared)
        ORDER BY best.rank DESC, i.updated_at DESC
        LIMIT $5`,
      [query, like, user.sub, isGlobalAdmin, SEARCH_LIMIT + 1],
    );

    const truncated = rows.length > SEARCH_LIMIT;
    const items = (truncated ? rows.slice(0, SEARCH_LIMIT) : rows).map((r): SearchResultItemDto => ({
      id: r.id,
      projectId: r.project_id,
      key: r.key,
      title: r.title,
      typeId: r.type_id,
      priorityId: r.priority_id,
      statusId: r.status_id,
      statusName: r.status_name,
      statusCategory: r.status_category,
      projectKey: r.project_key,
      projectName: r.project_name,
    }));
    return { items, truncated };
  });

  // ТЗ 3.1 (план v2, Трек 3): роутер резолвит /p/:projectKey/issue/:issueKey через
  // этот роут перед открытием карточки. Точное совпадение по ключу (не ILIKE, как в
  // поиске выше) — ключ либо есть целиком в URL, либо нет; частичное совпадение здесь
  // означало бы открывать не ту задачу. 404, а не пустой ответ, если ключ не найден
  // ИЛИ найден, но проект не входит в видимые пользователю — тот же предикат, что и
  // выше, специально не различает эти два случая в ответе (не подсказывать
  // существование чужой задачи стороннему пользователю).
  app.get(
    "/issues/resolve",
    { preHandler: [requireAuth, zquery(IssueResolveQuery)] },
    async (req): Promise<IssueResolveDto> => {
      const user: JwtPayload = req.user;
      const { key } = req.query as z.infer<typeof IssueResolveQuery>;
      const isGlobalAdmin = user.globalRole === "admin";
      const row = await one<{ id: string; project_id: string; project_key: string }>(
        `SELECT i.id, i.project_id, p.key AS project_key
           FROM issues i
           JOIN projects p ON p.id = i.project_id
          WHERE i.key = $1
            AND ($3
                 OR EXISTS (SELECT 1 FROM project_members pm
                             WHERE pm.project_id = p.id AND pm.user_id = $2)
                 OR EXISTS (SELECT 1 FROM department_members dm
                             WHERE dm.department_id = p.department_id AND dm.user_id = $2)
                 OR p.is_shared)`,
        [key, user.sub, isGlobalAdmin],
      );
      if (!row) throw notFound("Задача не найдена");
      return { id: row.id, projectId: row.project_id, projectKey: row.project_key };
    },
  );
}
