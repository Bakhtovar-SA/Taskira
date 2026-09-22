/** ТЗ 3.5 (план v2 Трек 3) — полный экспорт данных инсталляции: не CSV доски,
 *  а машиночитаемый дамп всех сущностей. Мотивация — не «удобная фича», а пункт
 *  корпоративного договора («мы можем в любой момент забрать свои данные») и
 *  снятие страха vendor lock-in у покупателя. Формат — NDJSON (одна запись —
 *  одна строка), не один большой JSON-объект: так поток пишется построчно, без
 *  необходимости держать в памяти открытые массивы/скобки, и ровно тот же
 *  формат уже выбран в этом кодбейзе для похожей задачи (routes/auditExport.ts,
 *  ?format=jsonl) — не изобретаем второй формат экспорта рядом с существующим.
 *
 *  Импорт этого формата — сознательно НЕ в этом PR (обратная операция нужна
 *  отдельно, при миграции клиента между инсталляциями, и это другой объём
 *  работы: разрешение конфликтов id, повторный проход прав и валидации).
 *
 *  Экспорт вложений (файлов, не метаданных) — НЕ здесь: `scripts/backup.sh`
 *  (ТЗ 1.4) уже выгружает всё хранилище рядом с дампом БД (`storage_command
 *  export`) — переиспользуем существующий путь, а не дублируем его сборкой
 *  архива внутри HTTP-ответа; этот роут отдаёт только метаданные вложений
 *  (storage_key), которых достаточно, чтобы сопоставить файл с записью из
 *  бэкапа хранилища.
 *
 *  Личные, а не организационные данные (saved_views, user_favorite_projects,
 *  notifications) сознательно НЕ включены — экспорт закрывает «мы можем забрать
 *  свои РАБОЧИЕ данные» (проекты/задачи/историю), не личные настройки экрана
 *  каждого пользователя.
 *
 *  Стриминг: каждая таблица читается батчами (BATCH строк за раз), а не одним
 *  `SELECT *` — на инсталляции с 50k+ задач второе означало бы держать весь
 *  результат в памяти процесса и в памяти pg-драйвера одновременно. Таблицы с
 *  одиночным uuid PK (`id`) используют keyset-пагинацию (`id > $last`, без
 *  деградации на глубоких страницах); четыре join-таблицы с составным PK
 *  (department_members/project_members/issue_assignees/issue_collaborators)
 *  используют OFFSET — сознательный компромисс: составная keyset-пагинация
 *  на четырёх разных парах колонок увеличила бы объём кода без сопоставимой
 *  пользы, поскольку все четыре ограничены числом пользователей/проектов или
 *  масштабируются с числом задач так же, как сама таблица issues (уже
 *  batched по 1000) — глубина OFFSET здесь того же порядка, что число задач,
 *  не число задач в квадрате.
 */
import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { q } from "../db.js";
import { requireGlobalAdmin, type JwtPayload } from "../middleware.js";
import { audit } from "../audit.js";

// Экспортируется исключительно для теста границы пагинации (вставить BATCH+N
// строк и убедиться, что все страницы отдаются без дублей/пропусков) — не
// используется больше нигде в коде продукта.
export const BATCH = 1000;
const EXPORT_SCHEMA_VERSION = 1;

const toCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const camelizeRow = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));

interface KeyedTable {
  type: string;
  table: string;
  columns: string[];
}

/** Таблицы с одиночным uuid PK `id` — keyset-пагинация. Явный список колонок
 *  (не `SELECT *`): защита от случайной утечки колонки, которую добавят в
 *  таблицу позже (например, будущего секрета) в общий дамп без пересмотра
 *  этого файла, и от generated-колонок (search_vector, ТЗ 3.4 — производные,
 *  не источник данных, импорт бы их всё равно пересчитал). `users` явно
 *  исключает password_hash (буквальное требование ТЗ) и внутреннее
 *  состояние сессии/блокировки (tokens_valid_from, session_version,
 *  failed_login_attempts, locked_until) — это не данные пользователя, а
 *  учётные внутренности сервера. */
const KEYED_TABLES: KeyedTable[] = [
  { type: "department", table: "departments", columns: ["id", "name", "ldap_group_dn", "created_at"] },
  {
    type: "user",
    table: "users",
    columns: [
      "id", "username", "name", "initials", "color", "job_role", "created_at", "is_active", "global_role",
      "auth_source", "ldap_dn", "email", "phone", "notify_prefs", "avatar_driver", "avatar_key",
      "avatar_content_type", "avatar_updated_at",
    ],
  },
  { type: "project", table: "projects", columns: ["id", "key", "name", "description", "created_at", "department_id", "is_shared", "sprints_enabled"] },
  { type: "workflowStatus", table: "workflow_statuses", columns: ["id", "project_id", "sid", "name", "category", "position"] },
  { type: "workflowTransition", table: "workflow_transitions", columns: ["id", "project_id", "from_status_id", "to_status_id"] },
  { type: "customField", table: "custom_fields", columns: ["id", "project_id", "name", "field_type", "options", "position", "created_at"] },
  { type: "customFieldValue", table: "custom_field_values", columns: ["id", "custom_field_id", "issue_id", "value", "updated_at"] },
  { type: "sprint", table: "sprints", columns: ["id", "project_id", "name", "goal", "status", "start_date", "end_date", "created_at"] },
  {
    type: "issue",
    table: "issues",
    columns: [
      "id", "project_id", "num", "key", "title", "description", "type_id", "status_id", "priority_id",
      "reporter_id", "epic_id", "color", "t_start", "t_span", "labels", "rank", "created_at", "updated_at",
      "due_date", "done_at", "archived_at", "complexity", "parent_id", "sprint_id", "has_assignee",
    ],
  },
  { type: "issueLink", table: "issue_links", columns: ["id", "issue_id", "linked_issue_id", "link_type", "created_by", "created_at"] },
  { type: "checklistItem", table: "checklist_items", columns: ["id", "issue_id", "text", "done", "position", "created_at", "updated_at"] },
  { type: "comment", table: "comments", columns: ["id", "issue_id", "author_id", "body", "created_at"] },
  { type: "activity", table: "activity", columns: ["id", "issue_id", "actor_id", "text", "created_at"] },
  {
    type: "attachment",
    table: "attachments",
    columns: ["id", "issue_id", "uploaded_by", "filename", "content_type", "byte_size", "sha256", "storage_driver", "storage_key", "created_at"],
  },
  { type: "auditLogEntry", table: "audit_log", columns: ["id", "actor_id", "action", "entity", "entity_id", "details", "created_at", "result"] },
];

interface OffsetTable {
  type: string;
  table: string;
  columns: string[];
  orderBy: string;
}

const OFFSET_TABLES: OffsetTable[] = [
  { type: "departmentMember", table: "department_members", columns: ["department_id", "user_id", "source", "synced_at"], orderBy: "department_id, user_id" },
  { type: "projectMember", table: "project_members", columns: ["project_id", "user_id", "role", "added_at"], orderBy: "project_id, user_id" },
  { type: "issueAssignee", table: "issue_assignees", columns: ["issue_id", "user_id", "added_by", "added_at"], orderBy: "issue_id, user_id" },
  { type: "issueCollaborator", table: "issue_collaborators", columns: ["issue_id", "user_id", "added_by", "added_at"], orderBy: "issue_id, user_id" },
];

// Имена таблиц/колонок здесь — фиксированный список констант в этом файле,
// НИКОГДА не приходят из запроса: интерполяция в SQL ниже безопасна тем же
// рассуждением, что уже применяется к другим местам с именами таблиц/колонок
// в коде (например, миграции, TRUNCATE в test/helpers.ts) — не пользовательский ввод.
async function* streamKeyed(t: KeyedTable): AsyncGenerator<string> {
  const cols = t.columns.map((c) => `"${c}"`).join(", ");
  let lastId: string | null = null;
  for (;;) {
    const rows: Record<string, unknown>[] = lastId
      ? await q<Record<string, unknown>>(`SELECT ${cols} FROM ${t.table} WHERE id > $1 ORDER BY id LIMIT $2`, [lastId, BATCH])
      : await q<Record<string, unknown>>(`SELECT ${cols} FROM ${t.table} ORDER BY id LIMIT $1`, [BATCH]);
    if (rows.length === 0) return;
    for (const row of rows) yield `${JSON.stringify({ type: t.type, ...camelizeRow(row) })}\n`;
    lastId = String((rows[rows.length - 1] as { id: string }).id);
    if (rows.length < BATCH) return;
  }
}

async function* streamOffset(t: OffsetTable): AsyncGenerator<string> {
  const cols = t.columns.map((c) => `"${c}"`).join(", ");
  let offset = 0;
  for (;;) {
    const rows = await q<Record<string, unknown>>(`SELECT ${cols} FROM ${t.table} ORDER BY ${t.orderBy} LIMIT $1 OFFSET $2`, [BATCH, offset]);
    if (rows.length === 0) return;
    for (const row of rows) yield `${JSON.stringify({ type: t.type, ...camelizeRow(row) })}\n`;
    offset += rows.length;
    if (rows.length < BATCH) return;
  }
}

async function* generateExport(): AsyncGenerator<string> {
  // Первая строка — версия формата и метка времени, а не побочный эффект:
  // будущий импорт (отдельная задача) должен уметь отказаться от файла со
  // слишком новой/незнакомой schemaVersion, не гадая по содержимому.
  yield `${JSON.stringify({ type: "meta", schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), product: "Taskira" })}\n`;
  for (const t of KEYED_TABLES) yield* streamKeyed(t);
  for (const t of OFFSET_TABLES) yield* streamOffset(t);
}

export async function dataExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/export", { preHandler: requireGlobalAdmin }, async (req, reply) => {
    const user: JwtPayload = req.user;
    // Аудит ДО начала передачи (не после) — экспорт всей инсталляции стоит
    // записать как намерение, даже если скачивание потом прервётся на середине.
    await audit(user.sub, "admin.export", "installation", null, {});
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    reply.type("application/x-ndjson; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="taskira-export-${stamp}.jsonl"`);
    return reply.send(Readable.from(generateExport()));
  });
}
