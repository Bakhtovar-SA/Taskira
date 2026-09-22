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

    // Предикат видимости ОБЯЗАН совпадать с services/projects.ts listVisibleProjects
    // (участник ∪ департамент ∪ is_shared ∪ глобальный admin) — тот же инвариант,
    // что уже прокомментирован в routes/home.ts для assigned-to-me: иначе поиск
    // покажет задачи из проектов, которые потом не открыть.
    const rows = await q<Row>(
      `SELECT i.id, i.project_id, i.key, i.title, i.type_id, i.priority_id, i.status_id,
              ws.name AS status_name, ws.category AS status_category,
              p.key AS project_key, p.name AS project_name
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         JOIN workflow_statuses ws ON ws.id = i.status_id
        WHERE i.archived_at IS NULL
          AND (i.title ILIKE $1 OR i.key ILIKE $1)
          AND ($3
               OR EXISTS (SELECT 1 FROM project_members pm
                           WHERE pm.project_id = p.id AND pm.user_id = $2)
               OR EXISTS (SELECT 1 FROM department_members dm
                           WHERE dm.department_id = p.department_id AND dm.user_id = $2)
               OR p.is_shared)
        ORDER BY i.updated_at DESC
        LIMIT $4`,
      [like, user.sub, isGlobalAdmin, SEARCH_LIMIT + 1],
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
