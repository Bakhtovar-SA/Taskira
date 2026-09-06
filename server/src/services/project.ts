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
}

interface ProjectDbRow {
  id: string;
  key: string;
  name: string;
  description: string;
  department_id: string;
  is_shared: boolean;
}

const SELECT_COLS = `id, key, name, description, department_id, is_shared`;

const toRow = (r: ProjectDbRow): ProjectRow => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  departmentId: r.department_id,
  isShared: r.is_shared,
});

/* Кэш по id — проекты меняются редко (создание/правка админом → invalidate). */
const cache = new Map<string, ProjectRow>();

export async function projectById(id: string): Promise<ProjectRow | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await one<ProjectDbRow>(`SELECT ${SELECT_COLS} FROM projects WHERE id = $1`, [id]);
  if (!row) return null;
  const p = toRow(row);
  cache.set(id, p);
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
