/**
 * Общий построитель WHERE для списка задач и счётчиков. Фильтры, сортировка и
 * поиск выполняются здесь, на сервере: при ленивой загрузке клиент видит лишь
 * часть набора, и фильтр «по уже загруженному» молча искал бы только в ней.
 */
import type { z } from "zod";
import { escLike } from "../db.js";
import type { CustomFieldType, IssueFilterQuery } from "../contract.js";
import type { IssueCursorSort } from "../issueListCursor.js";

export type IssueFilters = z.infer<typeof IssueFilterQuery>;

/** Поле проекта для условия `cf*` — его тип решает, как сравнивать (значения хранятся текстом). */
export type FilterField = { id: string; field_type: CustomFieldType };

/** Граница диапазона для числа: как значение поля, плюс экспонента — `<input type="number">` отдаёт «1e3», а
 *  PostgreSQL приводит её к numeric без потерь. Сами значения поля экспоненту не принимают (validateValueForField). */
const BOUND_NUM_RE = /^-?\d+(\.\d+)?(e[+-]?\d{1,3})?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Те же форматы для SQL — без «?»: `add()` подставляет параметры на место первого «?» в тексте условия. */
const NUM_SQL = "^-{0,1}[0-9]+([.][0-9]+){0,1}$";
const DATE_SQL = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

/** Запросу нужен JOIN workflow_statuses под алиасом `ws` (категория статуса).
 *  `sprintsEnabled` — project.sprintsEnabled: `f.sprintId` молча игнорируется,
 *  если у проекта выключен модуль спринтов, а не 404-ит список (см. contract.ts).
 *  `customField` — поле из `f.cf`, уже найденное в ЭТОМ проекте (routes/issues.ts); null — такого поля нет. */
export function buildIssueFilter(
  projectId: string,
  f: IssueFilters,
  { sprintsEnabled = true, customField }: { sprintsEnabled?: boolean; customField?: FilterField | null } = {},
): { clauses: string[]; params: unknown[] } {
  // Архив (миграция 016) из активного набора исключён по умолчанию: доска и
  // «Список задач» показывают живые задачи. ?archived=1 — только архивные,
  // ?archived=all — всё вместе (для отчётов и сквозного поиска).
  const clauses: string[] = ["i.project_id = $1"];
  if (f.archived === "1") clauses.push("i.archived_at IS NOT NULL");
  else if (f.archived !== "all") clauses.push("i.archived_at IS NULL");
  const params: unknown[] = [projectId];
  const add = (clause: string, ...vals: unknown[]) => {
    for (const v of vals) {
      params.push(v);
      clause = clause.replace("?", `$${params.length}`);
    }
    clauses.push(clause);
  };

  if (f.status) add("i.status_id = ?", f.status);
  // has_assignee ведёт триггер на issue_assignees (миграция 20260920T1410); он же
  // даёт частичный индекс idx_issues_active_unassigned вместо anti-join.
  if (f.assignee === "none") clauses.push("i.has_assignee = false");
  else if (f.assignee) add("EXISTS (SELECT 1 FROM issue_assignees ia WHERE ia.issue_id = i.id AND ia.user_id = ?)", f.assignee);
  if (f.type) add("i.type_id = ?", f.type);
  if (f.priority) add("i.priority_id = ?", f.priority);
  if (f.label) add("? = ANY(i.labels)", f.label);
  if (f.sprintId && sprintsEnabled) add("i.sprint_id = ?", f.sprintId);
  if (f.parentId) add("i.parent_id = ?", f.parentId);
  if (f.epicId) add("i.epic_id = ?", f.epicId);
  // ТЗ 3.4 (план v2 Трек 3) сознательно НЕ трогает этот `q` — он живой
  // as-you-type фильтр списка (Backlog.tsx), а не отдельный поиск: подстрочный
  // ILIKE ловит "impl" в середине "implementation", полнотекстовый поиск по
  // токенам (search_vector, routes/search.ts) — нет, слово либо есть целиком,
  // либо нет. Замена здесь была бы регрессией UX-контракта, а не апгрейдом;
  // индекс (SEARCH-01, pg_trgm) уже даёт этому ILIKE приемлемую скорость.
  // Полнотекстовый поиск (описание/комментарии/чек-лист, ранжирование) — в
  // отдельном кросс-проектном /api/issues/search, для него UX другой:
  // осмысленный запрос, не префикс на каждую нажатую клавишу.
  if (f.cf) addCustomField(f, customField ?? null, add, clauses);
  if (f.q) add("(i.title ILIKE ? OR i.key ILIKE ?)", `%${escLike(f.q)}%`, `%${escLike(f.q)}%`);
  if (f.dueFrom) add("i.due_date >= ?", f.dueFrom);
  if (f.dueTo) add("i.due_date <= ?", f.dueTo);
  if (f.overdue) clauses.push("i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND ws.category <> 'done'");
  if (f.closed === "hide") clauses.push("ws.category <> 'done'");
  else if (f.closed === "recent") {
    add("(ws.category <> 'done' OR i.done_at IS NULL OR i.done_at >= now() - (? * interval '1 day'))", f.closedDays);
  } else if (f.closed === "older") {
    add("(ws.category = 'done' AND i.done_at IS NOT NULL AND i.done_at < now() - (? * interval '1 day'))", f.closedDays);
  }
  return { clauses, params };
}

/** Условие по своему полю (ROUTE-02). Значения хранятся текстом; числа сравниваются после приведения, а приведение
 *  защищено проверкой формата внутри CASE — строка, записанная до проверок, не роняет запрос.
 *
 *  Условие, которое не подходит к ТЕКУЩЕМУ полю (поле удалили или сменили ему тип, а сохранённый фильтр или ссылка
 *  остались; граница не того формата; значение там, где нужен диапазон), ничего не находит — пустой набор, а не 400:
 *  список и счётчики доски не должны ломаться из-за устаревшей ссылки, а кнопка фильтра честно показывает условие,
 *  которое и дало пустоту. `cfEmpty` важнее остальных частей (клиент их вместе не шлёт). */
function addCustomField(
  f: IssueFilters,
  field: FilterField | null,
  add: (clause: string, ...vals: unknown[]) => void,
  clauses: string[],
): void {
  const nothing = () => void clauses.push("false");
  if (!field) return nothing();
  const v = (extra: string, ...vals: unknown[]) =>
    add(`EXISTS (SELECT 1 FROM custom_field_values cfv WHERE cfv.issue_id = i.id AND cfv.custom_field_id = ? AND ${extra})`, field.id, ...vals);
  const range = !!(f.cfFrom || f.cfTo);
  if (f.cfEmpty) {
    // У чекбокса «не задан» и «снят» — одно и то же: для него есть «Не отмечено», а «не задано» не бывает.
    if (field.field_type === "checkbox") return nothing();
    return add("NOT EXISTS (SELECT 1 FROM custom_field_values cfv WHERE cfv.issue_id = i.id AND cfv.custom_field_id = ?)", field.id);
  }
  switch (field.field_type) {
    case "text":
      if (range) return nothing();
      if (f.cfValue) v("cfv.value ILIKE ?", `%${escLike(f.cfValue)}%`);
      return;
    case "select":
      if (range) return nothing();
      if (f.cfValue) v("cfv.value = ?", f.cfValue);
      return;
    case "checkbox":
      if (range) return nothing();
      if (f.cfValue === "true") v("cfv.value = 'true'");
      else if (f.cfValue === "false") add("NOT EXISTS (SELECT 1 FROM custom_field_values cfv WHERE cfv.issue_id = i.id AND cfv.custom_field_id = ? AND cfv.value = 'true')", field.id);
      else if (f.cfValue) nothing();
      return;
    case "number":
    case "date": {
      if (f.cfValue) return nothing();
      const re = field.field_type === "number" ? BOUND_NUM_RE : DATE_RE;
      if ((f.cfFrom && !re.test(f.cfFrom)) || (f.cfTo && !re.test(f.cfTo))) return nothing();
      // Число приводится к numeric только после проверки формата. Дата сравнивается как текст: ГГГГ-ММ-ДД
      // упорядочен так же, как сами даты, а приведение к date упало бы на «2026-02-30», которую формат пропускает.
      const [typed, cast] =
        field.field_type === "number"
          ? [`(CASE WHEN cfv.value ~ '${NUM_SQL}' THEN cfv.value::numeric END)`, "::numeric"]
          : [`(CASE WHEN cfv.value ~ '${DATE_SQL}' THEN cfv.value END)`, ""];
      if (f.cfFrom && f.cfTo) v(`${typed} BETWEEN ?${cast} AND ?${cast}`, f.cfFrom, f.cfTo);
      else if (f.cfFrom) v(`${typed} >= ?${cast}`, f.cfFrom);
      else if (f.cfTo) v(`${typed} <= ?${cast}`, f.cfTo);
      return;
    }
  }
}

/** Нужна ли категория статуса (`ws`) — иначе JOIN в счётчике лишний. */
export const needsStatusJoin = (f: IssueFilters): boolean => !!f.overdue || !!f.closed;

/** SQL-выражения ключей сортировки, приведённые к float8 — и для ORDER BY, и
 *  для сравнения с курсором, чтобы значения совпадали побитово. Порядок
 *  приоритетов — PRIORITY_ORDER клиента; задачи без срока — в конце.
 *  Выражения ДОЛЖНЫ дословно совпадать с индексами миграций 20260920T14xx_*:
 *  иначе планировщик не сможет использовать индекс для ORDER BY. */
export const SORT_EXPR: Record<IssueCursorSort, string> = {
  priority: "(CASE i.priority_id WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)::float8",
  due: "COALESCE((i.due_date - DATE '1970-01-01'), 1000000)::float8",
  // AT TIME ZONE 'UTC' делает выражение IMMUTABLE — иначе его нельзя положить в индекс.
  updated: "floor(EXTRACT(EPOCH FROM (i.updated_at AT TIME ZONE 'UTC')) * 1000)::float8",
  key: "i.num",
};
