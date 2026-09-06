/** Проекты: список видимых пользователю + DTO. Резолв одного проекта — services/project.ts. */
import { q } from "../db.js";
import type { ProjectRow } from "./project.js";

export interface ProjectDto {
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

const toDto = (r: ProjectDbRow): ProjectDto => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  departmentId: r.department_id,
  isShared: r.is_shared,
});

export const projectRowToDto = (p: ProjectRow): ProjectDto => ({
  id: p.id,
  key: p.key,
  name: p.name,
  description: p.description,
  departmentId: p.departmentId,
  isShared: p.isShared,
});

const COLS = `p.id, p.key, p.name, p.description, p.department_id, p.is_shared`;

/**
 * Видимость (временно, до LDAP — DEPT_MIGRATION.md §3.5):
 *   глобальный admin — все проекты;
 *   иначе — где есть строка в project_members ИЛИ проект is_shared.
 */
export async function listVisibleProjects(userId: string, isGlobalAdmin: boolean): Promise<ProjectDto[]> {
  if (isGlobalAdmin) {
    return (await q<ProjectDbRow>(`SELECT ${COLS} FROM projects p ORDER BY p.key`)).map(toDto);
  }
  return (
    await q<ProjectDbRow>(
      `SELECT DISTINCT ${COLS}
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
        WHERE pm.user_id IS NOT NULL OR p.is_shared
        ORDER BY p.key`,
      [userId],
    )
  ).map(toDto);
}
