/** Роадмап проектов (ТЗ 5.15): даты проекта, вехи, зависимости между проектами.
 *
 *  Видимость — та же, что у списка проектов (listVisibleProjects): глобальный admin — все; иначе участник,
 *  член отдела проекта или общий проект. Зависимость показывается, только если видны обе стороны.
 *  Циклы зависимостей запрещены: проверка и вставка идут в одной транзакции под одной advisory-блокировкой на
 *  весь граф — иначе два встречных запроса (A ждёт B и B ждёт A) могли бы оба пройти проверку. Граф маленький
 *  (десятки–сотни проектов), глобальная блокировка на время одной вставки ничего не стоит. */
import { q, one, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { roleHas, type AccessRole, type ProjectRole } from "../permissions.js";
import { LIMITS, type MilestoneDto, type RoadmapDto, type RoadmapProjectDto } from "../contract.js";

const DEPS_LOCK = "taskira:project_dependencies";

interface Row {
  id: string;
  key: string;
  name: string;
  department_id: string;
  icon: RoadmapProjectDto["icon"];
  color: RoadmapProjectDto["color"];
  created_at: string;
  start_date: string | null;
  target_date: string | null;
  role: ProjectRole | null;
  done: number;
  total: number;
}

/** Условие видимости проекта `p` для пользователя $1 (как в services/projects.ts). */
const VISIBLE = `(p.is_shared
   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
   OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = p.department_id AND dm.user_id = $1))`;

export async function getRoadmap(userId: string, isGlobalAdmin: boolean): Promise<RoadmapDto> {
  const rows = await q<Row>(
    `SELECT p.id, p.key, p.name, p.department_id, p.icon, p.color,
            to_char(p.created_at, 'YYYY-MM-DD') AS created_at,
            to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(p.target_date, 'YYYY-MM-DD') AS target_date,
            (SELECT pm.role FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1) AS role,
            COALESCE(c.done, 0)::int AS done, COALESCE(c.total, 0)::int AS total
       FROM projects p
       LEFT JOIN (SELECT project_id, count(*) AS total, count(done_at) AS done FROM issues GROUP BY project_id) c
              ON c.project_id = p.id
      WHERE $2::boolean OR ${VISIBLE}
      ORDER BY p.start_date NULLS LAST, p.key`,
    [userId, isGlobalAdmin],
  );
  const ids = rows.map((r) => r.id);
  const milestones = ids.length
    ? await q<MilestoneDto & { project_id: string }>(
        `SELECT id, project_id, name, to_char(date, 'YYYY-MM-DD') AS date
           FROM project_milestones WHERE project_id = ANY($1::uuid[]) ORDER BY date, position, created_at`,
        [ids],
      )
    : [];
  const deps = ids.length
    ? await q<{ source_project_id: string; dependent_project_id: string }>(
        `SELECT source_project_id, dependent_project_id FROM project_dependencies
          WHERE source_project_id = ANY($1::uuid[]) AND dependent_project_id = ANY($1::uuid[])
          ORDER BY created_at`,
        [ids],
      )
    : [];
  const byProject = new Map<string, MilestoneDto[]>();
  for (const m of milestones) {
    const list = byProject.get(m.project_id) ?? [];
    list.push({ id: m.id, name: m.name, date: m.date });
    byProject.set(m.project_id, list);
  }
  return {
    projects: rows.map((r) => {
      const role: AccessRole | null = isGlobalAdmin ? "admin" : r.role;
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        departmentId: r.department_id,
        icon: r.icon,
        color: r.color,
        createdAt: r.created_at,
        startDate: r.start_date,
        targetDate: r.target_date,
        done: r.done,
        total: r.total,
        milestones: byProject.get(r.id) ?? [],
        canEdit: !!role && roleHas(role, "editRoadmap"),
      };
    }),
    dependencies: deps.map((d) => ({ sourceId: d.source_project_id, dependentId: d.dependent_project_id })),
  };
}

/** Даты проекта. Порядок проверяется по итоговой паре (одна дата может прийти, другая — остаться прежней). */
export async function patchRoadmapDates(projectId: string, body: { startDate?: string | null; targetDate?: string | null }): Promise<void> {
  const cur = await one<{ start_date: string | null; target_date: string | null }>(
    `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(target_date, 'YYYY-MM-DD') AS target_date FROM projects WHERE id = $1`,
    [projectId],
  );
  if (!cur) throw new ApiHttpError(404, "NOT_FOUND", "Проект не найден");
  const start = body.startDate !== undefined ? body.startDate : cur.start_date;
  const target = body.targetDate !== undefined ? body.targetDate : cur.target_date;
  if (start && target && start > target) throw new ApiHttpError(400, "BAD_REQUEST", "Дата цели раньше даты начала");
  await q(`UPDATE projects SET start_date = $2::date, target_date = $3::date WHERE id = $1`, [projectId, start, target]);
}

export async function addMilestone(projectId: string, m: { name: string; date: string }): Promise<MilestoneDto> {
  return withTransaction(async (c) => {
    // Блокировка строки проекта сериализует конкурентные добавления — лимит не перепрыгнуть вдвоём.
    await c.query(`SELECT 1 FROM projects WHERE id = $1 FOR UPDATE`, [projectId]);
    const n = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM project_milestones WHERE project_id = $1`, [projectId]);
    if ((n.rows[0]?.n ?? 0) >= LIMITS.milestonesPerProject)
      throw new ApiHttpError(409, "LIMIT", `Не больше ${LIMITS.milestonesPerProject} вех у проекта`);
    const r = await c.query<MilestoneDto>(
      `INSERT INTO project_milestones (project_id, name, date, position)
       VALUES ($1, $2, $3::date, COALESCE((SELECT MAX(position) + 1 FROM project_milestones WHERE project_id = $1), 0))
       RETURNING id, name, to_char(date, 'YYYY-MM-DD') AS date`,
      [projectId, m.name, m.date],
    );
    return r.rows[0]!;
  });
}

export async function patchMilestone(projectId: string, id: string, m: { name?: string; date?: string }): Promise<MilestoneDto> {
  const r = await one<MilestoneDto>(
    `UPDATE project_milestones SET name = COALESCE($3, name), date = COALESCE($4::date, date)
      WHERE id = $2 AND project_id = $1
      RETURNING id, name, to_char(date, 'YYYY-MM-DD') AS date`,
    [projectId, id, m.name ?? null, m.date ?? null],
  );
  if (!r) throw new ApiHttpError(404, "NOT_FOUND", "Веха не найдена");
  return r;
}

export async function removeMilestone(projectId: string, id: string): Promise<void> {
  const r = await q(`DELETE FROM project_milestones WHERE id = $2 AND project_id = $1 RETURNING id`, [projectId, id]);
  if (r.length === 0) throw new ApiHttpError(404, "NOT_FOUND", "Веха не найдена");
}

/** Виден ли проект пользователю (для источника зависимости: нельзя ссылаться на невидимый проект). */
export async function isProjectVisible(userId: string, isGlobalAdmin: boolean, projectId: string): Promise<boolean> {
  const r = await one<{ ok: boolean }>(`SELECT ($3::boolean OR ${VISIBLE}) AS ok FROM projects p WHERE p.id = $2`, [userId, projectId, isGlobalAdmin]);
  return !!r?.ok;
}

/** Проект dependentId начинает ждать sourceId. 409 CYCLE, если source уже (транзитивно) ждёт dependent. */
export async function addDependency(dependentId: string, sourceId: string): Promise<"added" | "exists"> {
  if (dependentId === sourceId) throw new ApiHttpError(400, "BAD_REQUEST", "Проект не может зависеть от себя");
  return withTransaction(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [DEPS_LOCK]);
    const exists = await c.query(`SELECT 1 FROM project_dependencies WHERE source_project_id = $1 AND dependent_project_id = $2`, [sourceId, dependentId]);
    if (exists.rows.length) return "exists";
    const n = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM project_dependencies WHERE dependent_project_id = $1`, [dependentId]);
    if ((n.rows[0]?.n ?? 0) >= LIMITS.projectDependenciesMax)
      throw new ApiHttpError(409, "LIMIT", `Не больше ${LIMITS.projectDependenciesMax} зависимостей у проекта`);
    // Новое ребро source → dependent замыкает цикл, если из dependent уже можно дойти до source.
    const cycle = await c.query(
      `WITH RECURSIVE reach(id) AS (
         SELECT dependent_project_id FROM project_dependencies WHERE source_project_id = $1
         UNION
         SELECT d.dependent_project_id FROM project_dependencies d JOIN reach r ON d.source_project_id = r.id
       )
       SELECT 1 FROM reach WHERE id = $2 LIMIT 1`,
      [dependentId, sourceId],
    );
    if (cycle.rows.length) throw new ApiHttpError(409, "DEPENDENCY_CYCLE", "Получится цикл: этот проект уже (через другие) ждёт выбранный");
    await c.query(`INSERT INTO project_dependencies (source_project_id, dependent_project_id) VALUES ($1, $2)`, [sourceId, dependentId]);
    return "added";
  });
}

export async function removeDependency(dependentId: string, sourceId: string): Promise<void> {
  const r = await q(`DELETE FROM project_dependencies WHERE source_project_id = $1 AND dependent_project_id = $2 RETURNING 1`, [sourceId, dependentId]);
  if (r.length === 0) throw new ApiHttpError(404, "NOT_FOUND", "Зависимости нет");
}
