/** Durable, commit-ordered invalidations. Pending ids must never be used as cursors:
 *  a transaction with a smaller id can commit after a newer transaction. Only the
 *  dispatcher assigns delivery sequences, while holding one transaction-level lock. */
import type { FastifyInstance } from "fastify";
import { one, q, withTransaction } from "../db.js";
import type { RealtimeSyncMessage } from "../contract.js";

const PENDING_BATCH = 1000;
const MAX_DRAIN_BATCHES = 4;
const MAX_CATCHUP_EVENTS = 500;
const MAX_ISSUE_IDS = 500;
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH = 10_000;
let lastCleanupAt = 0;
let draining: Promise<void> | null = null;

/** Cursors remain strings: Postgres bigint exceeds JavaScript's safe integer range. */
export function isRealtimeCursor(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}

async function drain(): Promise<void> {
  for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
    const consumed = await withTransaction(async (client) => {
      const lock = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext('taskira:realtime-dispatch')) AS locked`,
      );
      if (!lock.rows[0]?.locked) return 0;

      const candidates = await client.query<{ project_id: string }>(
        `SELECT DISTINCT project_id FROM (
           SELECT project_id FROM realtime_pending ORDER BY id LIMIT $1
         ) AS candidates`, [PENDING_BATCH],
      );
      // Project deletion locks the parent before cascading into pending rows.
      // Take parent locks first too, otherwise pending->event(FK) versus
      // project->pending(cascade) can deadlock. Skip an already locked/deleting
      // parent; its next tick either sees the committed delete or processes it.
      const parents = candidates.rows.length === 0 ? [] : (await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = ANY($1::uuid[])
          ORDER BY id FOR KEY SHARE SKIP LOCKED`, [candidates.rows.map(row => row.project_id)],
      )).rows;
      const pending = parents.length === 0 ? { rows: [] } : await client.query<{
        id: string; project_id: string; issue_id: string | null;
      }>(
        `SELECT id, project_id, issue_id FROM realtime_pending
          WHERE project_id = ANY($1::uuid[])
          ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [parents.map(row => row.id), PENDING_BATCH],
      );
      const projects = new Map<string, { ids: Set<string>; reset: boolean }>();
      for (const row of pending.rows) {
        let project = projects.get(row.project_id);
        if (!project) projects.set(row.project_id, project = { ids: new Set(), reset: false });
        if (row.issue_id === null) project.reset = true;
        else project.ids.add(row.issue_id);
      }
      for (const [projectId, project] of projects) {
        const reset = project.reset || project.ids.size > MAX_ISSUE_IDS;
        await client.query(
          `INSERT INTO realtime_events (project_id, issue_ids, reset) VALUES ($1, $2::uuid[], $3)`,
          [projectId, reset ? [] : [...project.ids], reset],
        );
      }
      if (pending.rows.length > 0) {
        await client.query(`DELETE FROM realtime_pending WHERE id = ANY($1::bigint[])`,
          [pending.rows.map(row => row.id)]);
      }
      if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
        // Delete a sequence prefix, never isolated old timestamps: clock
        // adjustments must not create invisible holes inside retained history.
        // Keep the final global event as a watermark even after a quiet week.
        const cleanup = await client.query(`DELETE FROM realtime_events WHERE sequence IN (
          SELECT sequence FROM realtime_events
           WHERE sequence < COALESCE(
             (SELECT min(sequence) FROM realtime_events WHERE created_at >= now() - interval '7 days'),
             (SELECT max(sequence) FROM realtime_events)
           )
           ORDER BY sequence LIMIT ${CLEANUP_BATCH}
        )`);
        // If a backlog remains, continue bounded cleanup on the next drain
        // rather than waiting another full interval and falling behind writes.
        if ((cleanup.rowCount ?? 0) < CLEANUP_BATCH) lastCleanupAt = Date.now();
      }
      return pending.rows.length;
    });
    if (consumed < PENDING_BATCH) return;
  }
}

/** Coalesce concurrent REST/WS drains in this process; the DB lock covers replicas. */
export function materializeRealtimeChanges(): Promise<void> {
  if (!draining) {
    const operation = drain();
    draining = operation.finally(() => { draining = null; });
  }
  return draining;
}

/** Drain even when nobody has a board open; otherwise the transactional pending
 *  queue would grow for the entire quiet/off-hours period. Scoped to app lifetime. */
export function attachRealtimeLifecycle(app: FastifyInstance): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      if (running) return;
      running = materializeRealtimeChanges().catch(error => {
        app.log.error({ err: error }, "realtime background drain failed");
      }).finally(() => { running = null; });
    }, 5000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    await running;
  });
}

/** The bounds and events come from ONE SQL snapshot, preventing a watermark
 *  from advancing past a row that was invisible to a preceding SELECT. */
export async function readRealtimeChanges(
  projectId: string,
  cursor: string | null,
  options: { materialize?: boolean } = {},
): Promise<RealtimeSyncMessage> {
  if (cursor !== null && !isRealtimeCursor(cursor)) throw new Error("Invalid realtime cursor");
  if (options.materialize !== false) await materializeRealtimeChanges();
  const rows = await q<{
    high: string; low: string | null; sequence: string | null;
    issue_ids: string[] | null; reset: boolean | null;
  }>(`WITH bounds AS (
      SELECT COALESCE((SELECT sequence FROM realtime_events ORDER BY sequence DESC LIMIT 1), 0)::text AS high,
             (SELECT sequence FROM realtime_events ORDER BY sequence LIMIT 1)::text AS low
    ), changes AS (
      SELECT sequence::text, issue_ids, reset FROM realtime_events
       WHERE project_id = $1 AND sequence > COALESCE($2::bigint, 0)
       ORDER BY realtime_events.sequence LIMIT $3
    )
    SELECT bounds.high, bounds.low, changes.sequence, changes.issue_ids, changes.reset
      FROM bounds LEFT JOIN changes ON true`, [projectId, cursor, MAX_CATCHUP_EVENTS + 1]);
  const bounds = rows[0];
  const high = bounds?.high ?? "0";
  const expired = cursor !== null && bounds?.low !== null && bounds?.low !== undefined &&
    BigInt(cursor) < BigInt(bounds.low) - 1n;
  let reset = cursor === null || BigInt(cursor) > BigInt(high) || expired ||
    rows.length > MAX_CATCHUP_EVENTS;
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.reset) reset = true;
    for (const id of row.issue_ids ?? []) ids.add(id);
    if (ids.size > MAX_ISSUE_IDS) reset = true;
  }
  return { type: "sync", projectId, cursor: high, issueIds: reset ? [] : [...ids], reset, ts: Date.now() };
}

/** Same browse policy as requirePerm, without its 30s authorization caches.
 *  A project-level feed never inherits an invitation to one individual issue. */
export async function realtimeAccess(
  userId: string, sessionVersion: number | undefined, projectId: string | null,
  apiToken = false,
): Promise<"allowed" | "denied" | "expired"> {
  const row = await one<{ session_ok: boolean; can_browse: boolean }>(
    `SELECT (u.is_active AND ($4::boolean OR (u.session_version = $2 AND NOT u.must_change_password))) AS session_ok,
            EXISTS (
              SELECT 1 FROM projects p WHERE p.id = $3::uuid AND (
                (NOT $4::boolean AND u.global_role = 'admin') OR p.is_shared
                OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id)
                OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = p.department_id AND dm.user_id = u.id)
              )
            ) AS can_browse
       FROM users u WHERE u.id = $1`, [userId, sessionVersion ?? null, projectId, apiToken],
  );
  if (!row?.session_ok) return "expired";
  return projectId === null || row.can_browse ? "allowed" : "denied";
}
