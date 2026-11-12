import { APPLICATIONS, applicationSettings, assertApplicationWritable } from "../applications/registry.js";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import { q, one } from "../db.js";
import {
  badRequest,
  forbidden,
  notFound,
  ApiHttpError,
} from "../middleware.js";
import {
  DEFAULT_MODULES,
  type WorkspaceModules,
  type EntityRef,
  type EntityLink,
  type WorkspaceHistory,
  type LibraryItem,
  type ObjectField,
  type FieldValue,
} from "../workspaceContract.js";
import { listVisibleProjects } from "./projects.js";

export const iso = (v: Date | string) =>
  v instanceof Date ? v.toISOString() : v;
export const query = async <T>(
  client: PoolClient | undefined,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> =>
  client ? (await client.query(sql, params)).rows : q<T>(sql, params);
export function conflict(): never {
  throw new ApiHttpError(
    409,
    "CONFLICT",
    "Данные изменились. Обновите страницу и повторите действие",
  );
}
export async function storedModules(
  projectId: string,
  client?: PoolClient,
): Promise<WorkspaceModules> {
  return (
    (
      await query<WorkspaceModules>(
        client,
        "SELECT documents,objects,processes,planning,files FROM workspace_modules WHERE project_id=$1",
        [projectId],
      )
    )[0] ?? { ...DEFAULT_MODULES }
  );
}
/** Effective write switches; the settings endpoint always returns storedModules instead. */
export async function modules(projectId: string, client?: PoolClient): Promise<WorkspaceModules> {
  const [stored, applications] = await Promise.all([storedModules(projectId, client), applicationSettings(client)]);
  for (const application of APPLICATIONS)
    if (!applications[application.id]) for (const module of application.modules) stored[module] = false;
  return stored;
}
export async function writable(
  req: FastifyRequest,
  module: keyof WorkspaceModules,
): Promise<void> {
  if (!(await modules(req.project!.id))[module])
    throw new ApiHttpError(
      409,
      "MODULE_DISABLED",
      "Модуль выключен. Существующие материалы доступны для чтения",
    );
}
export async function history(
  projectId: string,
  kind: string,
  id: string,
  actor: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  client?: PoolClient,
) {
  await query(
    client,
    "INSERT INTO workspace_history(project_id,kind,entity_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [projectId, kind, id, actor, action, JSON.stringify(detail)],
  );
}
export async function entityHistory(
  projectId: string,
  kind: string,
  id: string,
): Promise<WorkspaceHistory[]> {
  return (
    await q<{
      id: string;
      action: string;
      actor_id: string | null;
      detail: Record<string, unknown>;
      created_at: Date;
    }>(
      "SELECT * FROM workspace_history WHERE project_id=$1 AND kind=$2 AND entity_id=$3 ORDER BY created_at DESC LIMIT 200",
      [projectId, kind, id],
    )
  ).map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    detail: r.detail,
    createdAt: iso(r.created_at),
  }));
}
export async function entity(
  projectId: string,
  ref: EntityRef,
  client?: PoolClient,
): Promise<{ id: string; title: string; archived: boolean }> {
  const tables = {
    issue: "issues",
    document: "workspace_documents",
    object: "workspace_objects",
    process: "workspace_process_runs",
  } as const;
  const arch =
    ref.kind === "issue"
      ? "archived_at IS NOT NULL"
      : ref.kind === "process"
        ? "state='cancelled'"
        : "archived";
  const row = (
    await query<{ id: string; title: string; archived: boolean }>(
      client,
      `SELECT id,title,${arch} AS archived FROM ${tables[ref.kind]} WHERE project_id=$1 AND id=$2`,
      [projectId, ref.id],
    )
  )[0];
  if (!row) throw notFound();
  return row;
}
export async function linkEntities(
  projectId: string,
  source: EntityRef,
  target: EntityRef,
  actor: string,
  client?: PoolClient,
) {
  if (source.kind === target.kind && source.id === target.id)
    throw badRequest("Нельзя связать материал с самим собой");
  await entity(projectId, source, client);
  await entity(projectId, target, client);
  // Canonical ordering makes the relationship bidirectional and prevents reversed duplicates.
  if (`${source.kind}:${source.id}` > `${target.kind}:${target.id}`)
    [source, target] = [target, source];
  const r = (
    await query<{ id: string }>(
      client,
      `INSERT INTO workspace_entity_links(project_id,source_kind,source_id,target_kind,target_id,created_by) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(project_id,source_kind,source_id,target_kind,target_id) DO UPDATE SET source_id=EXCLUDED.source_id RETURNING id`,
      [projectId, source.kind, source.id, target.kind, target.id, actor],
    )
  )[0];
  return r;
}
export async function links(
  projectId: string,
  ref: EntityRef,
): Promise<EntityLink[]> {
  await entity(projectId, ref);
  const rows = await q<{
    id: string;
    source_kind: EntityRef["kind"];
    source_id: string;
    target_kind: EntityRef["kind"];
    target_id: string;
  }>(
    "SELECT * FROM workspace_entity_links WHERE project_id=$1 AND ((source_kind=$2 AND source_id=$3) OR (target_kind=$2 AND target_id=$3))",
    [projectId, ref.kind, ref.id],
  );
  const result: EntityLink[] = [];
  for (const r of rows) {
    const other: EntityRef =
      r.source_kind === ref.kind && r.source_id === ref.id
        ? { kind: r.target_kind, id: r.target_id }
        : { kind: r.source_kind, id: r.source_id };
    try {
      const target = await entity(projectId, other);
      result.push({
        id: r.id,
        source: ref,
        target: other,
        title: target.title,
        archived: target.archived,
      });
    } catch (e) {
      if (!(e instanceof ApiHttpError && e.statusCode === 404)) throw e;
    }
  }
  return result;
}
export async function validateUser(
  projectId: string,
  userId: string | null,
  client?: PoolClient,
) {
  if (!userId) return;
  const found = (
    await query(
      client,
      `SELECT u.id FROM users u WHERE u.id=$2 AND u.is_active AND u.auth_source<>'service' AND (u.global_role='admin' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=$1 AND m.user_id=u.id) OR EXISTS(SELECT 1 FROM department_members dm JOIN projects p ON p.department_id=dm.department_id WHERE p.id=$1 AND dm.user_id=u.id))`,
      [projectId, userId],
    )
  )[0];
  if (!found) throw badRequest("Пользователь недоступен в проекте");
}
export async function ownerCanManage(
  projectId: string,
  userId: string,
  client?: PoolClient,
): Promise<boolean> {
  return !!(
    await query(
      client,
      `SELECT u.id FROM users u WHERE u.id=$2 AND u.is_active AND (u.global_role='admin' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=$1 AND m.user_id=u.id AND m.role='manager'))`,
      [projectId, userId],
    )
  )[0];
}
export async function assertLinkWrite(req: FastifyRequest, ref: EntityRef) {
  if (req.projectRole === "viewer") throw forbidden("Нет права изменять связи");
  if (ref.kind === "issue" && req.projectRole === "employee") {
    const r = await one(
      "SELECT id FROM issues WHERE id=$1 AND project_id=$2 AND (reporter_id=$3 OR EXISTS(SELECT 1 FROM issue_assignees a WHERE a.issue_id=issues.id AND a.user_id=$3))",
      [ref.id, req.project!.id, req.user.sub],
    );
    if (!r) throw forbidden("Можно изменять связи только своих задач");
  }
  await assertApplicationWritable(ref.kind === "document" ? "knowledge" : ref.kind === "object" ? "objects" : "work");
}
export async function validateValues(
  projectId: string,
  fields: ObjectField[],
  values: Record<string, FieldValue>,
  client?: PoolClient,
) {
  const keys = new Set(fields.map((f) => f.key));
  if (Object.keys(values).some((k) => !keys.has(k)))
    throw badRequest("Неизвестное поле объекта");
  for (const f of fields) {
    const v = values[f.key];
    if (v === null || v === undefined || v === "") {
      if (f.required) throw badRequest(`Заполните поле «${f.name}»`);
      continue;
    }
    if (
      (f.type === "text" && typeof v !== "string") ||
      (f.type === "number" && typeof v !== "number") ||
      (f.type === "checkbox" && typeof v !== "boolean")
    )
      throw badRequest(`Неверный тип поля «${f.name}»`);
    if (
      f.type === "select" &&
      (typeof v !== "string" || !f.options.includes(v))
    )
      throw badRequest(`Неверный вариант поля «${f.name}»`);
    if (
      f.type === "date" &&
      (typeof v !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        Number.isNaN(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v)
    )
      throw badRequest("Некорректная дата");
    if (f.type === "user" || f.type === "reference") {
      if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v))
        throw badRequest("Некорректная ссылка");
      if (f.type === "user") await validateUser(projectId, v, client);
      else await entity(projectId, { kind: "object", id: v }, client);
    }
  }
}
export async function library(
  userId: string,
  admin: boolean,
  search = "",
  includeArchived = false,
  filter: { projectId?: string; kind?: EntityRef["kind"] } = {},
): Promise<{ items: LibraryItem[]; truncated: boolean }> {
  const projects = (await listVisibleProjects(userId, admin)).filter(
    (p) => !filter.projectId || p.id === filter.projectId,
  );
  if (!projects.length) return { items: [], truncated: false };
  const rows = await q<{
    id: string;
    kind: EntityRef["kind"];
    project_id: string;
    title: string;
    text: string;
    updated_at: Date;
    archived: boolean;
  }>(
    `WITH materials AS(
    SELECT id,'document'::text kind,project_id,title,search_text text,updated_at,archived FROM workspace_documents
    UNION ALL SELECT id,'object',project_id,title,field_values::text,updated_at,archived FROM workspace_objects
    UNION ALL SELECT id,'process',project_id,title,''::text,created_at,state='cancelled' FROM workspace_process_runs
    UNION ALL SELECT id,'issue',project_id,title,description,updated_at,archived_at IS NOT NULL FROM issues)
    SELECT * FROM materials WHERE project_id=ANY($1::uuid[]) AND ($4::text IS NULL OR kind=$4) AND ($3 OR NOT archived) AND ($2='' OR to_tsvector('simple',title||' '||text) @@ websearch_to_tsquery('simple',$2) OR title ILIKE '%'||$2||'%') ORDER BY updated_at DESC LIMIT 201`,
    [projects.map((p) => p.id), search, includeArchived, filter.kind ?? null],
  );
  return {
    items: rows.slice(0, 200).map((r) => {
      const p = projects.find((p) => p.id === r.project_id)!;
      return {
        ref: { kind: r.kind, id: r.id },
        projectId: r.project_id,
        projectKey: p.key,
        projectName: p.name,
        title: r.title,
        text: r.text.slice(0, 300),
        updatedAt: iso(r.updated_at),
        archived: r.archived,
      };
    }),
    truncated: rows.length > 200,
  };
}
