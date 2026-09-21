/** Шаблоны задач проекта (issue_templates, миграция 022). По образцу
 *  customFields.ts: определения — уровень проекта, применение — чистый
 *  client-side prefill формы создания, никакой связи с созданной задачей. */
import { one, q } from "../db.js";
import type { IssueTemplateDto } from "../contract.js";
export type { IssueTemplateDto };

interface Row {
  id: string;
  name: string;
  type_id: IssueTemplateDto["typeId"]; // CHECK (022)
  priority_id: IssueTemplateDto["priorityId"]; // CHECK (022)
  title: string;
  description: string;
  status_id: string | null;
  position: number;
}

const toDto = (r: Row): IssueTemplateDto => ({
  id: r.id,
  name: r.name,
  typeId: r.type_id,
  priorityId: r.priority_id,
  title: r.title,
  description: r.description,
  statusId: r.status_id,
  position: r.position,
});

export async function listIssueTemplates(projectId: string): Promise<IssueTemplateDto[]> {
  const rows = await q<Row>(
    `SELECT id, name, type_id, priority_id, title, description, status_id, position
       FROM issue_templates WHERE project_id = $1 ORDER BY position, created_at`,
    [projectId],
  );
  return rows.map(toDto);
}

export interface IssueTemplateInput {
  name: string;
  typeId: string;
  priorityId: string;
  title: string;
  description: string;
  statusId: string | null;
}

export async function createIssueTemplate(projectId: string, args: IssueTemplateInput): Promise<IssueTemplateDto> {
  const row = await one<Row>(
    `INSERT INTO issue_templates (project_id, name, type_id, priority_id, title, description, status_id, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT MAX(position) + 1 FROM issue_templates WHERE project_id = $1), 0))
     RETURNING id, name, type_id, priority_id, title, description, status_id, position`,
    [projectId, args.name, args.typeId, args.priorityId, args.title, args.description, args.statusId],
  );
  return toDto(row!);
}

export async function getIssueTemplateInProject(projectId: string, templateId: string): Promise<{ id: string; name: string } | null> {
  return one<{ id: string; name: string }>(
    `SELECT id, name FROM issue_templates WHERE id = $1 AND project_id = $2`,
    [templateId, projectId],
  );
}

export async function updateIssueTemplate(templateId: string, args: IssueTemplateInput): Promise<IssueTemplateDto> {
  const row = await one<Row>(
    `UPDATE issue_templates
        SET name = $2, type_id = $3, priority_id = $4, title = $5, description = $6, status_id = $7
      WHERE id = $1
      RETURNING id, name, type_id, priority_id, title, description, status_id, position`,
    [templateId, args.name, args.typeId, args.priorityId, args.title, args.description, args.statusId],
  );
  return toDto(row!);
}

export async function deleteIssueTemplate(templateId: string): Promise<void> {
  await q(`DELETE FROM issue_templates WHERE id = $1`, [templateId]);
}
