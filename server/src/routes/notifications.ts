/** In-app-уведомления: лента, счётчик непрочитанных, отметка прочитанным,
 *  настройки (NOTIFICATIONS_MIGRATION.md Фаза 2). Смонтировано на уровне /api,
 *  все ручки — только `requireAuth` (уведомление привязано к user_id, не к проекту).
 *  Доставка — polling клиента; WebSocket-пуш — Фаза 6.
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { badRequest, formatZod, requireAuth, zbody, zquery, type JwtPayload } from "../middleware.js";
import { MarkReadBody, NotificationsQuery, NotifyPrefsBody, DismissNotificationsBody } from "../contract.js";

interface NRow {
  id: string;
  type: string;
  actor_id: string | null;
  project_id: string | null;
  issue_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
  actor_name: string | null;
  actor_initials: string | null;
  actor_color: string | null;
}

const mapN = (r: NRow) => ({
  id: r.id,
  type: r.type,
  actorId: r.actor_id,
  actor: r.actor_id ? { id: r.actor_id, name: r.actor_name, initials: r.actor_initials, color: r.actor_color } : null,
  projectId: r.project_id,
  issueId: r.issue_id,
  payload: r.payload ?? {},
  createdAt: new Date(r.created_at).toISOString(),
  read: r.read_at != null,
});

const unreadOf = async (uid: string): Promise<number> => {
  const r = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
    [uid],
  );
  return Number(r?.n ?? 0);
};

/** Общая ручка read/dismiss: { ids } или пустое тело = все свои. `column` —
 *  read_at или dismissed_at, ставится только там, где ещё не проставлена. */
const markNotifications = async (uid: string, ids: string[] | undefined, column: "read_at" | "dismissed_at") => {
  if (ids && ids.length > 0) {
    await q(`UPDATE notifications SET ${column} = now() WHERE user_id = $1 AND ${column} IS NULL AND id = ANY($2)`, [uid, ids]);
  } else {
    await q(`UPDATE notifications SET ${column} = now() WHERE user_id = $1 AND ${column} IS NULL`, [uid]);
  }
};

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /* лента получателя, курсорная пагинация по created_at */
  app.get("/notifications", { preHandler: requireAuth, preValidation: zquery(NotificationsQuery) }, async (req) => {
    const uid = (req.user as JwtPayload).sub;
    const f = req.query as z.infer<typeof NotificationsQuery>;
    const limit = f.limit ?? 20;

    const params: unknown[] = [uid];
    let where = "n.user_id = $1 AND n.dismissed_at IS NULL";
    if (f.cursor) {
      params.push(f.cursor);
      where += ` AND n.created_at < $${params.length}`;
    }
    params.push(limit + 1);
    const rows = await q<NRow>(
      `SELECT n.id, n.type, n.actor_id, n.project_id, n.issue_id, n.payload, n.created_at, n.read_at,
              a.name AS actor_name, a.initials AS actor_initials, a.color AS actor_color
         FROM notifications n
         LEFT JOIN users a ON a.id = n.actor_id
        WHERE ${where}
        ORDER BY n.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map(mapN),
      nextCursor: hasMore ? new Date(items[items.length - 1].created_at).toISOString() : null,
      unread: await unreadOf(uid),
    };
  });

  /* число непрочитанных — для бейджа (partial-индекс, дёшево) */
  app.get("/notifications/unread-count", { preHandler: requireAuth }, async (req) => {
    return { count: await unreadOf((req.user as JwtPayload).sub) };
  });

  /* отметить прочитанными: { ids } или пустое тело = все */
  app.post("/notifications/read", { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req.user as JwtPayload).sub;
    const parsed = MarkReadBody.safeParse(req.body ?? {}); // тело может быть пустым
    if (!parsed.success) throw badRequest(formatZod(parsed.error));
    await markNotifications(uid, parsed.data.ids, "read_at");
    reply.code(204).send();
  });

  /* скрыть из своей ленты: { ids } или пустое тело = все свои. Мягкое скрытие
   *  (dismissed_at), не удаление строки — аудит/email_state не трогаются, на
   *  чужие уведомления не влияет (WHERE user_id = $1). */
  app.post("/notifications/dismiss", { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req.user as JwtPayload).sub;
    const parsed = DismissNotificationsBody.safeParse(req.body ?? {}); // тело может быть пустым
    if (!parsed.success) throw badRequest(formatZod(parsed.error));
    await markNotifications(uid, parsed.data.ids, "dismissed_at");
    reply.code(204).send();
  });

  /* настройки уведомлений — частичный мерж в users.notify_prefs */
  app.patch(
    "/notifications/prefs",
    { preHandler: requireAuth, preValidation: zbody(NotifyPrefsBody) },
    async (req) => {
      const uid = (req.user as JwtPayload).sub;
      const patch = req.body as z.infer<typeof NotifyPrefsBody>;
      const row = await one<{ notify_prefs: unknown }>(
        `UPDATE users SET notify_prefs = notify_prefs || $2::jsonb WHERE id = $1 RETURNING notify_prefs`,
        [uid, JSON.stringify(patch)],
      );
      return { notifyPrefs: row?.notify_prefs ?? {} };
    },
  );
}
