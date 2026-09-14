/** Спринты проекта (sprints, миграция 023) — опциональный модуль, см.
 *  SPRINTS_MIGRATION.md. Определения и переходы статуса живут здесь;
 *  привязка задачи к спринту (issues.sprint_id) — services/issues.ts. */
import { one, q } from "../db.js";
import { notFound } from "../middleware.js";
import type { ProjectRow } from "./project.js";
import { withAdvisoryLocks } from "./issues.js";

/** Общий gate для requirePerm()/requireIssuePerm() (см. их сигнатуры в
 *  middleware.ts) — используется и в routes/sprints.ts, и в routes/issues.ts
 *  (PATCH /:id/sprint), чтобы оба места гарантировали одно и то же: 404
 *  раньше проверки роли, а не внутри хендлера после неё (ревью PR #49 —
 *  иначе requirePerm("manageSprints") успевал бы отдать 403 для employee/
 *  viewer раньше, чем этот gate вообще выполнялся). */
export function assertSprintsEnabled(project: ProjectRow): void {
  if (!project.sprintsEnabled) throw notFound("Модуль спринтов не подключён для этого проекта");
}

export type SprintStatus = "future" | "active" | "completed";

export interface SprintDto {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
}

interface Row {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  start_date: string | null;
  end_date: string | null;
}

const COLS = `id, name, goal, status, start_date, end_date`;

const toDto = (r: Row): SprintDto => ({
  id: r.id,
  name: r.name,
  goal: r.goal,
  status: r.status,
  startDate: r.start_date,
  endDate: r.end_date,
});

export async function listSprints(projectId: string): Promise<SprintDto[]> {
  const rows = await q<Row>(`SELECT ${COLS} FROM sprints WHERE project_id = $1 ORDER BY created_at`, [projectId]);
  return rows.map(toDto);
}

export async function getSprintInProject(projectId: string, sprintId: string): Promise<SprintDto | null> {
  const row = await one<Row>(`SELECT ${COLS} FROM sprints WHERE id = $1 AND project_id = $2`, [sprintId, projectId]);
  return row ? toDto(row) : null;
}

export async function countSprints(projectId: string): Promise<number> {
  const row = await one<{ n: string }>(`SELECT count(*)::text AS n FROM sprints WHERE project_id = $1`, [projectId]);
  return Number(row?.n ?? 0);
}

export interface SprintInput {
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
}

export async function createSprint(projectId: string, args: SprintInput): Promise<SprintDto> {
  const row = await one<Row>(
    `INSERT INTO sprints (project_id, name, goal, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLS}`,
    [projectId, args.name, args.goal, args.startDate, args.endDate],
  );
  return toDto(row!);
}

/** future → active. Возвращает null, если спринт не найден в статусе
 *  «будущий» (гонка/устаревший запрос) — маршрут отличает это от конфликта
 *  «уже есть активный», который ловит 23505 на uq_sprints_one_active_per_project. */
export async function activateSprint(sprintId: string): Promise<SprintDto | null> {
  const row = await one<Row>(
    `UPDATE sprints SET status = 'active' WHERE id = $1 AND status = 'future' RETURNING ${COLS}`,
    [sprintId],
  );
  return row ? toDto(row) : null;
}

/** active → completed + перенос незакрытых задач спринта в бэклог
 *  (sprint_id = NULL) одной транзакцией — по умолчанию (без уточнения
 *  «в следующий спринт»), см. обсуждение архитектуры перед этим ТЗ.
 *  «Незакрытая» = done_at IS NULL — тот же признак, на котором стоит вся
 *  остальная отчётность и архивация (CLAUDE.md «Issue lifecycle»), не
 *  категория статуса.
 *
 *  advisory-лок на sprintId (withAdvisoryLocks, тот же примитив, что
 *  assignParentLocked) — не для сериализации ДВУХ вызовов completeSprint
 *  (их и так сериализует UPDATE ... WHERE status='active' обычной блокировкой
 *  строки), а против кросс-транзакционной гонки с PATCH /:id/sprint
 *  (routes/issues.ts): без общего лока PATCH под READ COMMITTED мог прочитать
 *  ещё не закоммиченный статус 'active' этого же спринта и записать sprint_id
 *  уже ПОСЛЕ того, как перенос незакрытых задач ниже прошёл — задача осталась
 *  бы приклеенной к завершённому спринту навсегда (ревью PR #49, седьмой
 *  раунд). Один и тот же ключ здесь и в PATCH — конкурентные попытки
 *  дожидаются друг друга, а не гонятся за незакоммиченным снимком. */
export async function completeSprint(sprintId: string): Promise<{ sprint: SprintDto; movedToBacklog: number } | null> {
  return withAdvisoryLocks([sprintId], async (client) => {
    const sprintRes = await client.query<Row>(
      `UPDATE sprints SET status = 'completed' WHERE id = $1 AND status = 'active' RETURNING ${COLS}`,
      [sprintId],
    );
    if (sprintRes.rows.length === 0) return null;
    const movedRes = await client.query(`UPDATE issues SET sprint_id = NULL WHERE sprint_id = $1 AND done_at IS NULL`, [sprintId]);
    return { sprint: toDto(sprintRes.rows[0]), movedToBacklog: movedRes.rowCount ?? 0 };
  });
}
