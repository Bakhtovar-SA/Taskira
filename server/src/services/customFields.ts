/** Пользовательские поля проекта (custom_fields/custom_field_values, миграция 020).
 *  Определения — уровень проекта (как workflow_statuses); значения — уровень
 *  задачи, одна строка на (custom_field_id, issue_id), NULL/отсутствие = не задано. */
import { one, q, withTransaction } from "../db.js";
import { badRequest, notFound } from "../middleware.js";
import { conflict } from "./workflow.js";
import type { CustomFieldDto, CustomFieldType, CustomFieldValueDto } from "../contract.js";
export type { CustomFieldDto, CustomFieldValueDto };

interface FieldRow {
  id: string;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  position: number;
}

const toDto = (r: FieldRow): CustomFieldDto => ({
  id: r.id,
  name: r.name,
  fieldType: r.field_type,
  options: r.options ?? [],
  position: r.position,
});

export async function listCustomFields(projectId: string): Promise<CustomFieldDto[]> {
  const rows = await q<FieldRow>(
    `SELECT id, name, field_type, options, position FROM custom_fields
      WHERE project_id = $1 ORDER BY position, created_at`,
    [projectId],
  );
  return rows.map(toDto);
}

export async function createCustomField(
  projectId: string,
  args: { name: string; fieldType: CustomFieldType; options: string[] },
): Promise<CustomFieldDto> {
  const row = await one<FieldRow>(
    `INSERT INTO custom_fields (project_id, name, field_type, options, position)
     VALUES ($1, $2, $3, $4::jsonb, COALESCE((SELECT MAX(position) + 1 FROM custom_fields WHERE project_id = $1), 0))
     RETURNING id, name, field_type, options, position`,
    [projectId, args.name, args.fieldType, JSON.stringify(args.fieldType === "select" ? args.options : [])],
  );
  return toDto(row!);
}

export async function getCustomFieldInProject(projectId: string, fieldId: string): Promise<FieldRow | null> {
  return one<FieldRow>(
    `SELECT id, name, field_type, options, position FROM custom_fields WHERE id = $1 AND project_id = $2`,
    [fieldId, projectId],
  );
}

export async function renameCustomField(fieldId: string, name: string): Promise<CustomFieldDto> {
  const row = await one<FieldRow>(
    `UPDATE custom_fields SET name = $2 WHERE id = $1 RETURNING id, name, field_type, options, position`,
    [fieldId, name],
  );
  return toDto(row!);
}

export async function deleteCustomField(fieldId: string): Promise<void> {
  await q(`DELETE FROM custom_fields WHERE id = $1`, [fieldId]);
}


export async function listValuesForIssue(issueId: string): Promise<CustomFieldValueDto[]> {
  const rows = await q<{ custom_field_id: string; value: string | null }>(
    `SELECT custom_field_id, value FROM custom_field_values WHERE issue_id = $1`,
    [issueId],
  );
  return rows.map((r) => ({ fieldId: r.custom_field_id, value: r.value }));
}

/** Проверка значения под конкретный тип поля — зависит от РЯДА (field_type,
 *  options), поэтому это ручная проверка в сервисе, а не статичная zod-схема
 *  в contract.ts (та не знает, какое именно поле пришло в запросе). */
export function validateValueForField(field: FieldRow, raw: string): string {
  switch (field.field_type) {
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(raw)) throw badRequest("Значение должно быть числом");
      return raw;
    case "checkbox":
      if (raw !== "true" && raw !== "false") throw badRequest("Значение чекбокса — true или false");
      return raw;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest("Ожидается дата в формате ГГГГ-ММ-ДД");
      return raw;
    case "select":
      if (!field.options.includes(raw)) throw badRequest("Значение не входит в список вариантов поля");
      return raw;
    case "text":
    default:
      if (raw.length > 500) throw badRequest("Значение длиннее 500 символов");
      return raw;
  }
}

/** value=null удаляет строку (поле «не задано»), иначе — upsert.
 *  Own compare-and-set (expectedValue against the stored string, never re-validated):
 *  field values deliberately do not bump issues.updated_at / expectedVersion — see
 *  ISSUE_VERSION_SQL in issues.ts and docs/REALTIME.md. */
export async function setCustomFieldValue(
  fieldId: string, issueId: string, value: string | null, expectedValue?: string | null,
): Promise<void> {
  await withTransaction(async client => {
    // Compare-and-set locks the parent even when the value row is absent: two first
    // writes must compare against the same baseline before either can insert it.
    // A blind write needs no issue lock (the upsert is atomic; the FK key-share lock
    // covers deletion), so it does not serialize against PATCH/transition.
    const issue = await client.query(
      `SELECT id FROM issues WHERE id = $1${expectedValue !== undefined ? " FOR UPDATE" : ""}`, [issueId]);
    if (issue.rows.length === 0) throw notFound("Задача не найдена");
    if (expectedValue !== undefined) {
      const current = await client.query<{ value: string | null }>(
        "SELECT value FROM custom_field_values WHERE custom_field_id = $1 AND issue_id = $2", [fieldId, issueId],
      );
      if ((current.rows[0]?.value ?? null) !== expectedValue) {
        throw conflict("Поле уже изменено другим пользователем. Обновите данные и повторите изменение");
      }
    }
    if (value === null) {
      await client.query("DELETE FROM custom_field_values WHERE custom_field_id = $1 AND issue_id = $2", [fieldId, issueId]);
    } else {
      await client.query(
        `INSERT INTO custom_field_values (custom_field_id, issue_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (custom_field_id, issue_id) DO UPDATE SET value = $3, updated_at = now()`,
        [fieldId, issueId, value],
      );
    }
  });
}
