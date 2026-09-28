/** Шаблоны проектов (ТЗ 5.10): встроенные (templates/builtin.json) и шаблоны организации (project_templates).
 *  Шаблон — набор уже существующих настроек проекта; применение — внутри транзакции создания проекта
 *  (routes/projects.ts), поэтому сбой на любом шаге откатывает и сам проект. */
import type pg from "pg";
import { one, q } from "../db.js";
import { ProjectTemplateSpec, type ProjectTemplateDto } from "../contract.js";
import builtinJson from "../templates/builtin.json" with { type: "json" };

export const BUILTIN_PREFIX = "builtin:";

/** Встроенные шаблоны проверяются той же схемой, что и пользовательские, при загрузке модуля: ошибка в JSON
 *  роняет старт сервера (и тест), а не всплывает у первого, кто выберет шаблон. */
export const BUILTIN_TEMPLATES: ProjectTemplateDto[] = builtinJson.templates.map((t) => ({
  id: `${BUILTIN_PREFIX}${t.id}`,
  name: t.name,
  description: t.description,
  builtin: true,
  spec: ProjectTemplateSpec.parse(t.spec),
}));

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  spec: unknown;
}
const rowToDto = (r: TemplateRow): ProjectTemplateDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  builtin: false,
  // Спецификация проверена при сохранении; здесь не парсим повторно — только приводим тип.
  spec: r.spec as ProjectTemplateDto["spec"],
});

export async function listProjectTemplates(): Promise<ProjectTemplateDto[]> {
  const rows = await q<TemplateRow>(`SELECT id, name, description, spec FROM project_templates ORDER BY lower(name)`);
  return [...BUILTIN_TEMPLATES, ...rows.map(rowToDto)];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getProjectTemplate(id: string): Promise<ProjectTemplateDto | null> {
  if (id.startsWith(BUILTIN_PREFIX)) return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
  if (!UUID_RE.test(id)) return null;
  const r = await one<TemplateRow>(`SELECT id, name, description, spec FROM project_templates WHERE id = $1`, [id]);
  return r ? rowToDto(r) : null;
}

/** Записать конфигурацию шаблона в только что созданный проект. Вызывается внутри транзакции создания. */
export async function applyProjectTemplate(client: pg.PoolClient, projectId: string, spec: ProjectTemplateDto["spec"]): Promise<void> {
  const sidToId = new Map<string, string>();
  for (const [i, s] of spec.statuses.entries()) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO workflow_statuses (project_id, sid, name, category, position) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [projectId, s.sid, s.name, s.category, i],
    );
    sidToId.set(s.sid, r.rows[0].id);
  }
  for (const [from, to] of spec.transitions) {
    await client.query(`INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES ($1, $2, $3)`, [
      projectId,
      sidToId.get(from),
      sidToId.get(to),
    ]);
  }
  for (const [i, f] of spec.customFields.entries()) {
    await client.query(`INSERT INTO custom_fields (project_id, name, field_type, options, position) VALUES ($1, $2, $3, $4::jsonb, $5)`, [
      projectId,
      f.name,
      f.fieldType,
      JSON.stringify(f.fieldType === "select" ? f.options : []),
      i,
    ]);
  }
  for (const [i, t] of spec.issueTemplates.entries()) {
    await client.query(
      `INSERT INTO issue_templates (project_id, name, type_id, priority_id, title, description, status_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [projectId, t.name, t.typeId, t.priorityId, t.title, t.description, t.statusSid ? sidToId.get(t.statusSid) : null, i],
    );
  }
  await client.query(`UPDATE projects SET default_view = $2, suggested_labels = $3, sprints_enabled = sprints_enabled OR $4 WHERE id = $1`, [
    projectId,
    spec.defaultView,
    spec.labels,
    spec.sprintsEnabled,
  ]);
}

/** Снимок конфигурации проекта в спецификацию шаблона («Сохранить проект как шаблон»). Проверяется схемой:
 *  проект с одним статусом или без статуса категории done шаблоном не станет — ответ 400 с причиной. */
export async function snapshotProject(projectId: string) {
  const [statuses, transitions, fields, templates, project] = await Promise.all([
    q<{ id: string; sid: string; name: string; category: "todo" | "inprogress" | "done" }>(
      `SELECT id, sid, name, category FROM workflow_statuses WHERE project_id = $1 ORDER BY position, sid`,
      [projectId],
    ),
    q<{ from_status_id: string; to_status_id: string }>(`SELECT from_status_id, to_status_id FROM workflow_transitions WHERE project_id = $1`, [projectId]),
    q<{ name: string; field_type: string; options: string[] }>(`SELECT name, field_type, options FROM custom_fields WHERE project_id = $1 ORDER BY position, created_at`, [
      projectId,
    ]),
    q<{ name: string; type_id: string; priority_id: string; title: string; description: string; status_id: string | null }>(
      `SELECT name, type_id, priority_id, title, description, status_id FROM issue_templates WHERE project_id = $1 ORDER BY position, created_at`,
      [projectId],
    ),
    one<{ default_view: string | null; suggested_labels: string[]; sprints_enabled: boolean; icon: string | null }>(
      `SELECT default_view, suggested_labels, sprints_enabled, icon FROM projects WHERE id = $1`,
      [projectId],
    ),
  ]);
  const sidOf = new Map(statuses.map((s) => [s.id, s.sid]));
  return ProjectTemplateSpec.safeParse({
    statuses: statuses.map((s) => ({ sid: s.sid, name: s.name, category: s.category })),
    transitions: transitions.map((t) => [sidOf.get(t.from_status_id), sidOf.get(t.to_status_id)]),
    customFields: fields.map((f) => ({ name: f.name, fieldType: f.field_type, options: f.options })),
    issueTemplates: templates.map((t) => ({
      name: t.name,
      typeId: t.type_id,
      priorityId: t.priority_id,
      title: t.title,
      description: t.description,
      statusSid: t.status_id ? (sidOf.get(t.status_id) ?? null) : null,
    })),
    defaultView: project?.default_view ?? "board",
    labels: project?.suggested_labels ?? [],
    sprintsEnabled: project?.sprints_enabled ?? false,
    icon: project?.icon ?? undefined,
  });
}
