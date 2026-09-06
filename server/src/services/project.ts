/** Текущий проект. Multi-tenant не делаем — внутренняя система одной компании. */
import { one } from "../db.js";
import { notFound } from "../middleware.js";

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
}

let cached: ProjectRow | null = null;

export async function currentProject(): Promise<ProjectRow> {
  if (cached) return cached;
  const row = await one<ProjectRow>(`SELECT id, key, name, description FROM projects ORDER BY created_at LIMIT 1`);
  if (!row) throw notFound("Проект не найден — запустите seed (npm run seed)");
  cached = row;
  return row;
}

/** Сброс кэша — если когда-нибудь появится правка проекта. */
export function invalidateProjectCache(): void {
  cached = null;
}
