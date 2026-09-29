/** Дашборды (ADR-0022): хранение и права.
 *
 *  Три вида в одной таблице: личный (виден и правится только владельцем), общий организации (виден всем, правит
 *  глобальный администратор) и обзор проекта (один на проект; права — routes/dashboards.ts через матрицу). Чужой
 *  личный дашборд неотличим от несуществующего — 404, а не 403. */
import type { PoolClient } from "pg";
import { one, q, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { DASHBOARD_GRID, DashboardWidget, LIMITS, type DashboardDto } from "../contract.js";

interface Row {
  id: string;
  name: string;
  owner_id: string | null;
  project_id: string | null;
  shared: boolean;
  widgets: unknown;
  updated_at: Date;
}

const COLS = "id, name, owner_id, project_id, shared, widgets, updated_at";
const notFound = () => new ApiHttpError(404, "NOT_FOUND", "Дашборд не найден");

/** Виджеты из БД: тип, который этот сервер не знает (строка от более новой версии, откат), отбрасывается, а не
 *  ломает весь дашборд. */
export function parseStoredWidgets(raw: unknown): DashboardWidget[] {
  if (!Array.isArray(raw)) return [];
  const out: DashboardWidget[] = [];
  for (const w of raw) {
    const r = DashboardWidget.safeParse(w);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Проверки, которые схема одного виджета сделать не может: виджет не вылезает за 12 колонок, id уникальны. */
export function assertLayout(widgets: DashboardWidget[]): void {
  const seen = new Set<string>();
  for (const w of widgets) {
    if (w.x + w.w > DASHBOARD_GRID.cols) throw new ApiHttpError(400, "VALIDATION", "Виджет выходит за границы сетки");
    if (seen.has(w.id)) throw new ApiHttpError(400, "VALIDATION", "Повторяется id виджета");
    seen.add(w.id);
  }
}

function toDto(r: Row, viewerId: string, isGlobalAdmin: boolean, canEditProject = false): DashboardDto {
  const kind = r.project_id ? "project" : r.shared ? "org" : "personal";
  const canEdit = kind === "project" ? canEditProject : kind === "org" ? isGlobalAdmin : r.owner_id === viewerId;
  return {
    id: r.id,
    name: r.name,
    kind,
    projectId: r.project_id,
    ownerId: r.owner_id,
    canEdit,
    widgets: parseStoredWidgets(r.widgets),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Дашборды уровня организации, которые видит пользователь: общие, затем свои личные. */
export async function listDashboards(userId: string, isGlobalAdmin: boolean): Promise<DashboardDto[]> {
  const rows = await q<Row>(
    `SELECT ${COLS} FROM dashboards
      WHERE project_id IS NULL AND (shared OR owner_id = $1)
      ORDER BY shared DESC, created_at`,
    [userId],
  );
  return rows.map((r) => toDto(r, userId, isGlobalAdmin));
}

async function loadVisible(id: string, userId: string): Promise<Row> {
  const r = await one<Row>(`SELECT ${COLS} FROM dashboards WHERE id = $1 AND project_id IS NULL AND (shared OR owner_id = $2)`, [id, userId]);
  if (!r) throw notFound();
  return r;
}

export async function getDashboard(id: string, userId: string, isGlobalAdmin: boolean): Promise<DashboardDto> {
  return toDto(await loadVisible(id, userId), userId, isGlobalAdmin);
}

/** Есть ли место ещё под один личный дашборд. Вызывается в транзакции: блокировка на пользователя держится до её
 *  конца, поэтому проверка и запись атомарны относительно других запросов того же человека. */
async function assertPersonalRoom(c: PoolClient, userId: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('dashboards:' || $1::text))`, [userId]);
  const n = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM dashboards WHERE owner_id = $1 AND project_id IS NULL AND NOT shared`, [userId]);
  if ((n.rows[0]?.n ?? 0) >= LIMITS.dashboardsPerUser) throw new ApiHttpError(409, "LIMIT", `Не больше ${LIMITS.dashboardsPerUser} личных дашбордов`);
}

export async function createDashboard(
  userId: string,
  isGlobalAdmin: boolean,
  body: { name: string; shared: boolean; widgets: DashboardWidget[] },
): Promise<DashboardDto> {
  if (body.shared && !isGlobalAdmin) throw new ApiHttpError(403, "FORBIDDEN", "Общий дашборд может создать только администратор");
  assertLayout(body.widgets);
  // Проверка лимита и вставка — в одной транзакции под блокировкой на пользователя: иначе два одновременных
  // запроса оба увидели бы «19» и вместе превысили лимит.
  const r = await withTransaction(async (c) => {
    if (!body.shared) await assertPersonalRoom(c, userId);
    const ins = await c.query<Row>(
      `INSERT INTO dashboards (name, owner_id, shared, widgets) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${COLS}`,
      [body.name, userId, body.shared, JSON.stringify(body.widgets)],
    );
    return ins.rows[0];
  });
  return toDto(r, userId, isGlobalAdmin);
}

/** Строка под блокировкой до конца транзакции: проверки прав и лимита смотрят на то же состояние, которое потом
 *  меняется, — два одновременных PATCH/DELETE одного дашборда идут по очереди. */
async function lockVisible(c: PoolClient, id: string, userId: string): Promise<Row> {
  const r = await c.query<Row>(
    `SELECT ${COLS} FROM dashboards WHERE id = $1 AND project_id IS NULL AND (shared OR owner_id = $2) FOR UPDATE`,
    [id, userId],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function patchDashboard(
  id: string,
  userId: string,
  isGlobalAdmin: boolean,
  patch: { name?: string; shared?: boolean; widgets?: DashboardWidget[] },
): Promise<DashboardDto> {
  if (patch.widgets) assertLayout(patch.widgets);
  const r = await withTransaction(async (c) => {
    const cur = await lockVisible(c, id, userId);
    const canEdit = cur.shared ? isGlobalAdmin : cur.owner_id === userId;
    if (!canEdit) throw new ApiHttpError(403, "FORBIDDEN", "Общий дашборд может менять только администратор");
    if (patch.shared !== undefined && patch.shared !== cur.shared) {
      // Сделать общим может только администратор; вернуть в личные — только его владелец-администратор,
      // иначе дашборд «пропал бы» в чужие личные.
      if (!isGlobalAdmin || cur.owner_id !== userId) throw new ApiHttpError(403, "FORBIDDEN", "Сделать дашборд общим или личным может только его автор-администратор");
    }
    // Вернуть общий в личные — это ещё один личный дашборд: тот же лимит и та же блокировка, что при создании.
    if (patch.shared === false && cur.shared) await assertPersonalRoom(c, userId);
    // widgets — полная замена набора. Виджеты неизвестного этому серверу типа (parseStoredWidgets) клиент не видел,
    // поэтому сохранение после отката версии их удаляет; это осознанно: сервер не может ни показать, ни проверить их.
    const upd = await c.query<Row>(
      `UPDATE dashboards
          SET name = COALESCE($2, name),
              shared = COALESCE($3, shared),
              widgets = COALESCE($4::jsonb, widgets),
              updated_at = now()
        WHERE id = $1
        RETURNING ${COLS}`,
      [id, patch.name ?? null, patch.shared ?? null, patch.widgets ? JSON.stringify(patch.widgets) : null],
    );
    return upd.rows[0];
  });
  return toDto(r, userId, isGlobalAdmin);
}

export async function deleteDashboard(id: string, userId: string, isGlobalAdmin: boolean): Promise<DashboardDto> {
  const cur = await withTransaction(async (c) => {
    const row = await lockVisible(c, id, userId);
    const canEdit = row.shared ? isGlobalAdmin : row.owner_id === userId;
    if (!canEdit) throw new ApiHttpError(403, "FORBIDDEN", "Общий дашборд может удалить только администратор");
    await c.query(`DELETE FROM dashboards WHERE id = $1`, [id]);
    return row;
  });
  return toDto(cur, userId, isGlobalAdmin);
}

/* ---------------- обзор проекта ---------------- */

export async function getProjectOverview(projectId: string, userId: string, canEdit: boolean): Promise<DashboardDto | null> {
  const r = await one<Row>(`SELECT ${COLS} FROM dashboards WHERE project_id = $1`, [projectId]);
  return r ? toDto(r, userId, false, canEdit) : null;
}

export async function saveProjectOverview(projectId: string, userId: string, widgets: DashboardWidget[]): Promise<DashboardDto> {
  assertLayout(widgets);
  const r = await one<Row>(
    `INSERT INTO dashboards (name, owner_id, project_id, shared, widgets)
     VALUES ('Обзор', $2, $1, true, $3::jsonb)
     ON CONFLICT (project_id) WHERE project_id IS NOT NULL
     DO UPDATE SET widgets = EXCLUDED.widgets, updated_at = now()
     RETURNING ${COLS}`,
    [projectId, userId, JSON.stringify(widgets)],
  );
  return toDto(r as Row, userId, false, true);
}

/** Вернуть встроенный обзор. true — было что сбрасывать. */
export async function resetProjectOverview(projectId: string): Promise<boolean> {
  const r = await q<{ id: string }>(`DELETE FROM dashboards WHERE project_id = $1 RETURNING id`, [projectId]);
  return r.length > 0;
}
