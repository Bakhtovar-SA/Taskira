/**
 * Дробное ранжирование порядка задач в колонке (issues.rank float8).
 *
 * Правила:
 *  - вставка в конец колонки: max(rank) + STEP (или STEP для пустой);
 *  - вставка перед beforeId: среднее между соседями (или before - STEP, если before первая);
 *  - если соседние ранги сблизились до |a-b| < 1e-9 — колонка перенумеровывается
 *    (1000, 2000, 3000…) и вычисление повторяется.
 *
 * Всё внутри ОДНОЙ транзакции на выделенном клиенте, под advisory-локом колонки.
 *
 * Раньше здесь было сказано «без гонок», но стоял только withClient(): выделенное
 * соединение защищает от чередования запросов внутри одной операции и никак —
 * от второго пользователя (аудит BUG-02). Два одновременных перетаскивания в одну
 * позицию вычисляли одинаковый средний ранг, и порядок карточек начинал зависеть
 * от id, то есть «прыгал» при обновлении. Лок берётся на статус-колонку: разные
 * колонки по-прежнему обрабатываются параллельно.
 */
import type { PoolClient } from "pg";

const STEP = 1000;
const MIN_GAP = 1e-9;

interface RankRow {
  id: string;
  rank: number;
}

async function rebalanceColumn(client: PoolClient, projectId: string, statusId: string): Promise<void> {
  await client.query(
    `UPDATE issues AS i
       SET rank = sub.rn * $3
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY rank, id) AS rn
          FROM issues
         WHERE project_id = $1 AND status_id = $2
      ) AS sub
     WHERE i.id = sub.id AND i.project_id = $1 AND i.status_id = $2`,
    [projectId, statusId, STEP],
  );
}

interface Neighbors {
  previous?: RankRow;
  next?: RankRow;
}

async function neighbors(
  client: PoolClient, projectId: string, statusId: string, beforeId: string | null, excludeId?: string,
): Promise<Neighbors> {
  const params = [projectId, statusId, excludeId ?? null];
  const next = beforeId ? (await client.query<RankRow>(
    `SELECT id, rank FROM issues
      WHERE project_id = $1 AND status_id = $2 AND ($3::uuid IS NULL OR id <> $3) AND id = $4`,
    [...params, beforeId],
  )).rows[0] : undefined;
  if (!next) {
    // project_id нужен для существующего idx_issues_project_status.
    // Если ориентир исчез/переместился, вставляем в конец, как и раньше.
    const previous = (await client.query<RankRow>(
      `SELECT id, rank FROM issues
        WHERE project_id = $1 AND status_id = $2 AND ($3::uuid IS NULL OR id <> $3)
        ORDER BY rank DESC LIMIT 1`, params,
    )).rows[0];
    return { previous };
  }
  const previous = (await client.query<RankRow>(
    `SELECT id, rank FROM issues
      WHERE project_id = $1 AND status_id = $2 AND ($3::uuid IS NULL OR id <> $3)
        AND (rank, id) < ($4::float8, $5::uuid)
      ORDER BY rank DESC, id DESC LIMIT 1`,
    [...params, next.rank, next.id],
  )).rows[0];
  return { previous, next };
}

/** Возвращает rank для вставки в колонку statusId перед beforeId (null = в конец). */
export async function computeRank(
  client: PoolClient,
  projectId: string,
  statusId: string,
  beforeId: string | null,
  excludeId?: string,
): Promise<number> {
  // Лок на время транзакции, ключ — статус-колонка. Второй параллельный расчёт
  // по той же колонке ждёт здесь и увидит уже записанные соседями ранги.
  await lockRankColumn(client, statusId);
  const pick = ({ previous, next }: Neighbors): number => {
    if (!next) return previous ? previous.rank + STEP : STEP;
    return previous ? (previous.rank + next.rank) / 2 : next.rank - STEP;
  };

  let bounds = await neighbors(client, projectId, statusId, beforeId, excludeId);
  let rank = pick(bounds);

  // Проверяем зазор с соседями; при вырождении — rebalance и пересчёт (однократно)
  const gapOk = (r: number, { previous, next }: Neighbors): boolean => (
    (!next || Math.abs(next.rank - r) >= MIN_GAP) &&
    (!previous || Math.abs(r - previous.rank) >= MIN_GAP)
  );

  if (!gapOk(rank, bounds)) {
    await rebalanceColumn(client, projectId, statusId);
    bounds = await neighbors(client, projectId, statusId, beforeId, excludeId);
    rank = pick(bounds);
  }
  return rank;
}

/** Acquire before issue row locks; retain through the caller's INSERT/UPDATE and COMMIT. */
export async function lockRankColumn(client: PoolClient, statusId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [statusId]);
}
