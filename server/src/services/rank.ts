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
import { withClient } from "../db.js";

const STEP = 1000;
const MIN_GAP = 1e-9;

interface RankRow {
  id: string;
  rank: number;
}

async function rebalanceColumn(client: PoolClient, statusId: string): Promise<void> {
  await client.query(
    `UPDATE issues AS i
       SET rank = sub.rn * $2
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY rank, id) AS rn
          FROM issues
         WHERE status_id = $1
      ) AS sub
     WHERE i.id = sub.id AND i.status_id = $1`,
    [statusId, STEP],
  );
}

async function listRanks(client: PoolClient, statusId: string, excludeId?: string): Promise<RankRow[]> {
  const res = await client.query<RankRow>(
    `SELECT id, rank FROM issues
      WHERE status_id = $1 AND ($2::uuid IS NULL OR id <> $2)
      ORDER BY rank, id`,
    [statusId, excludeId ?? null],
  );
  return res.rows;
}

/** Возвращает rank для вставки в колонку statusId перед beforeId (null = в конец). */
export async function computeRank(statusId: string, beforeId: string | null, excludeId?: string): Promise<number> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const rank = await computeInTx(client, statusId, beforeId, excludeId);
      await client.query("COMMIT");
      return rank;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
}

async function computeInTx(
  client: PoolClient,
  statusId: string,
  beforeId: string | null,
  excludeId?: string,
): Promise<number> {
  {
    // Лок на время транзакции, ключ — статус-колонка. Второй параллельный расчёт
    // по той же колонке ждёт здесь и увидит уже записанные соседями ранги.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [statusId]);
    const pick = (rows: RankRow[]): number => {
      if (!beforeId) {
        const last = rows[rows.length - 1];
        return last ? last.rank + STEP : STEP;
      }
      const idx = rows.findIndex((r) => r.id === beforeId);
      if (idx < 0) {
        // beforeId не в этой колонке (удалён/перемещён конкурентом) — встаём в конец
        const last = rows[rows.length - 1];
        return last ? last.rank + STEP : STEP;
      }
      const target = rows[idx];
      const prev = rows[idx - 1];
      return prev ? (prev.rank + target.rank) / 2 : target.rank - STEP;
    };

    let rows = await listRanks(client, statusId, excludeId);
    let rank = pick(rows);

    // Проверяем зазор с соседями; при вырождении — rebalance и пересчёт (однократно)
    const gapOk = (r: number, rs: RankRow[]): boolean => {
      if (!beforeId) {
        const last = rs[rs.length - 1];
        return !last || Math.abs(r - last.rank) >= MIN_GAP;
      }
      const idx = rs.findIndex((x) => x.id === beforeId);
      if (idx < 0) return true;
      const next = rs[idx];
      const prev = rs[idx - 1];
      return (
        Math.abs(next.rank - r) >= MIN_GAP && (!prev || Math.abs(r - prev.rank) >= MIN_GAP)
      );
    };

    if (!gapOk(rank, rows)) {
      await rebalanceColumn(client, statusId);
      rows = await listRanks(client, statusId, excludeId);
      rank = pick(rows);
    }
    return rank;
  }
}
