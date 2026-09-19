/** Проекты: резолв по id с кэшем. Multi-project (миграция 007) — проект
 *  берётся из :projectId роута, не «единственный». */
import { one } from "../db.js";
// ApiHttpError из ./errors.js, не из middleware.js: middleware импортирует
// этот модуль (Фаза 2 ролей), импорт notFound обратно создал бы цикл.
import { ApiHttpError } from "../errors.js";

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  departmentId: string;
  isShared: boolean;
  /** Модуль спринтов (миграция 023) — опциональный, по умолчанию выключен.
   *  См. SPRINTS_MIGRATION.md; routes/sprints.ts 404-ит все свои роуты,
   *  если этот флаг false, независимо от роли вызывающего. */
  sprintsEnabled: boolean;
}

interface ProjectDbRow {
  id: string;
  key: string;
  name: string;
  description: string;
  department_id: string;
  is_shared: boolean;
  sprints_enabled: boolean;
}

const SELECT_COLS = `id, key, name, description, department_id, is_shared, sprints_enabled`;

const toRow = (r: ProjectDbRow): ProjectRow => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  departmentId: r.department_id,
  isShared: r.is_shared,
  sprintsEnabled: r.sprints_enabled,
});

/* Кэш по id — проекты меняются редко (создание/правка админом → invalidate).
 *
 * TTL обязателен, хотя invalidate есть (аудит BLOCK-03): invalidate чистит Map
 * ТОЛЬКО в том процессе, который обработал запись. При нескольких инстансах за
 * балансировщиком остальные о правке не узнают, а в строке лежит is_shared —
 * граница доступа: по нему effectiveRole() выдаёт неявного viewer. Без TTL
 * снятая галка «общий проект» не доезжала бы до других инстансов до перезапуска,
 * то есть посторонние продолжали бы попадать в проект. TTL тот же, что у кэшей
 * ролей и членства в middleware.ts, — рассинхрон ограничен 30 секундами. */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;
const cache = new Map<string, { row: ProjectRow; at: number }>();

export async function projectById(id: string): Promise<ProjectRow | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.row;
  const row = await one<ProjectDbRow>(`SELECT ${SELECT_COLS} FROM projects WHERE id = $1`, [id]);
  if (!row) {
    cache.delete(id);
    return null;
  }
  const p = toRow(row);
  if (!cache.has(id) && cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(id, { row: p, at: Date.now() });
  return p;
}

/** Первый проект по дате создания — для seed и служебных мест (не для роутов). */
export async function firstProject(): Promise<ProjectRow | null> {
  const row = await one<ProjectDbRow>(`SELECT ${SELECT_COLS} FROM projects ORDER BY created_at LIMIT 1`);
  return row ? toRow(row) : null;
}

/** Первый проект или 404 — узкие служебные вызовы, где проект обязан быть. */
export async function requireFirstProject(): Promise<ProjectRow> {
  const p = await firstProject();
  if (!p) throw new ApiHttpError(404, "NOT_FOUND", "Проект не найден — запустите seed (npm run seed)");
  return p;
}

/** Сброс кэша: без аргумента — весь, с id — один проект. */
export function invalidateProjectCache(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}
