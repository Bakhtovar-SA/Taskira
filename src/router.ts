/** Чистые URL-хелперы роутера (ТЗ 3.1, план v2 Трек 3): человекочитаемые ключи в пути
 *  (`/p/:projectKey/board`, `/p/:projectKey/issue/:issueKey`), не UUID — id используются
 *  только внутри стора/API. Разбор путей — регулярками, в духе прежнего
 *  `HASH_ISSUE_RE`/`readIssueHash` (`src/store/mappers.ts`), которые этот модуль заменяет;
 *  `wouter` (ADR-0008) даёт реактивную подписку на `location` в компоненте (`App.tsx`),
 *  сам разбор путей — здесь, чистыми функциями, без хуков, чтобы быть тестируемым без DOM.
 *
 *  Карта адресов — ADR-0013 §5: представления и настройки проекта под `/p/:projectKey/`,
 *  разделы без проекта (`/reports`, `/admin/departments`, `/help`, `/shared`) — свои пути;
 *  старые `/p/:projectKey/<вид>` разбираются и заменяются новыми. */
import type { ViewId } from "./types";

/** Адреса по ADR-0013 §5. Представления и настройки проекта живут под `/p/:projectKey/…`;
 *  разделы без проекта (отчёты, отделы, справка, приглашения) — свои пути верхнего уровня,
 *  как `/reports` было и раньше. */
const PROJECT_SEGMENT: Partial<Record<ViewId, string>> = {
  board: "board",
  backlog: "list",
  timeline: "timeline",
  sprints: "sprints",
  workflow: "settings/workflow",
  access: "settings/access",
};
const GLOBAL_PATH: Partial<Record<ViewId, string>> = {
  reports: "/reports",
  admin: "/admin/departments",
  docs: "/help",
  collaborating: "/shared",
  inbox: "/inbox",
  my: "/my-issues",
};
/** Старые сегменты `/p/:projectKey/<вид>` (до ADR-0013) — ссылки уже разосланы людьми,
 *  поэтому разбираются как прежде; синхронизация URL тут же заменяет их новым адресом. */
const LEGACY_SEGMENT: Record<string, ViewId> = {
  backlog: "backlog",
  workflow: "workflow",
  access: "access",
  admin: "admin",
  docs: "docs",
  collaborating: "collaborating",
};
const SEGMENT_VIEW: Record<string, ViewId> = {
  ...LEGACY_SEGMENT,
  ...Object.fromEntries(Object.entries(PROJECT_SEGMENT).map(([v, seg]) => [seg, v as ViewId])),
};
const GLOBAL_VIEW: Record<string, ViewId> = Object.fromEntries(Object.entries(GLOBAL_PATH).map(([v, p]) => [p, v as ViewId]));

const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** URL вида: разделы без проекта — свой путь, остальное — внутри проекта. */
export const pathForView = (projectKey: string, view: ViewId): string =>
  GLOBAL_PATH[view] ?? `/p/${enc(projectKey)}/${PROJECT_SEGMENT[view] ?? view}`;

/** URL прямой ссылки на задачу — всегда открывает её поверх доски (ТЗ 3.1 п.2:
 *  «модалка задачи открыта поверх доски сразу»), независимо от того, на каком виде
 *  задачу открыли — не о полноте истории навигации, а о простоте и предсказуемости
 *  адреса, который можно вставить в письмо. */
export const pathForIssue = (projectKey: string, issueKey: string): string =>
  `/p/${enc(projectKey)}/issue/${enc(issueKey)}`;

const RE_ISSUE = /^\/p\/([^/]+)\/issue\/([^/]+)\/?$/;
const RE_VIEW = /^\/p\/([^/]+)\/((?:settings\/)?[^/]+)\/?$/;

export type ParsedPath =
  | { kind: "issue"; projectKey: string; issueKey: string }
  | { kind: "view"; projectKey: string; view: ViewId }
  /** Раздел без проекта: отчёты, отделы, справка, приглашения. */
  | { kind: "global"; view: ViewId }
  | { kind: "root" };

/** Разбор `pathname` (без query/hash) в одну из ожидаемых форм роутера. Путь, который
 *  не подходит ни под одну схему (опечатка, устаревшая ссылка, чужой формат) —
 *  трактуется как `root`, а не как ошибка: та же терпимость, что была у старого
 *  `readIssueHash` к «хэш есть, но не похож на наш» (тихо игнорировался). */
export const parsePath = (pathname: string): ParsedPath => {
  const g = GLOBAL_VIEW[pathname.replace(/\/$/, "")];
  if (g) return { kind: "global", view: g };
  const mi = pathname.match(RE_ISSUE);
  if (mi) return { kind: "issue", projectKey: dec(mi[1]), issueKey: dec(mi[2]) };
  const mv = pathname.match(RE_VIEW);
  const view = mv ? SEGMENT_VIEW[dec(mv[2])] : undefined;
  if (mv && view) return { kind: "view", projectKey: dec(mv[1]), view };
  return { kind: "root" };
};

/** Одно ли место описывают два пути (старый адрес и новый для того же вида/задачи) —
 *  тогда синхронизация заменяет запись в истории, а не добавляет новую, и «Назад» не
 *  возвращает на старый адрес, который тут же снова перепишется. */
export const samePlace = (a: string, b: string): boolean => JSON.stringify(parsePath(a)) === JSON.stringify(parsePath(b));

/** ТЗ 3.2 (план v2 Трек 3): условия фильтра в query-параметрах URL — те же имена
 *  полей, что `IssueFilterParams` (`src/api/index.ts`) и `SavedViewFilter` на сервере
 *  (`contract.ts`), без отдельной схемы кодирования. Пока используется только
 *  `Backlog.tsx` («Список задач» — самый богатый набор фильтров сейчас); `Board.tsx`
 *  не подключён в этом релизе — те же функции переиспользуются, когда дойдёт очередь. */
export interface FilterState {
  status: string;
  assignee: string;
  type: string;
  priority: string;
  label: string;
}
export const EMPTY_FILTERS: FilterState = { status: "", assignee: "", type: "", priority: "", label: "" };
const FILTER_QS_KEYS: (keyof FilterState)[] = ["status", "assignee", "type", "priority", "label"];

export function filtersFromSearch(search: string): FilterState {
  const p = new URLSearchParams(search);
  const out = { ...EMPTY_FILTERS };
  for (const k of FILTER_QS_KEYS) out[k] = p.get(k) ?? "";
  return out;
}

/** `extra` — дополнительные булевы-ish query-параметры вида (overdue/done), которые
 *  не часть `FilterState`, но живут в том же query string и той же семантике
 *  «пусто — снять параметр» (не писать `=false`/`=""` в URL). */
export function searchFromFilters(current: string, f: FilterState, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(current);
  for (const k of FILTER_QS_KEYS) {
    if (f[k]) p.set(k, f[k]);
    else p.delete(k);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return p.toString();
}
