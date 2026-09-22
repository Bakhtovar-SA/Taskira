/** Чистые URL-хелперы роутера (ТЗ 3.1, план v2 Трек 3): человекочитаемые ключи в пути
 *  (`/p/:projectKey/board`, `/p/:projectKey/issue/:issueKey`), не UUID — id используются
 *  только внутри стора/API. Разбор путей — регулярками, в духе прежнего
 *  `HASH_ISSUE_RE`/`readIssueHash` (`src/store/mappers.ts`), которые этот модуль заменяет;
 *  `wouter` (ADR-0008) даёт реактивную подписку на `location` в компоненте (`App.tsx`),
 *  сам разбор путей — здесь, чистыми функциями, без хуков, чтобы быть тестируемым без DOM.
 *
 *  `reports` — единственный вид без префикса `/p/:projectKey/` (`/reports`): он
 *  project-less и на сервере, и в данных (см. CLAUDE.md, ReportsView.tsx). Остальные виды
 *  всегда идут внутри контекста текущего проекта. */
import type { ViewId } from "./types";

/** Виды, для которых имеет смысл прямая ссылка вида /p/:projectKey/<vid> — то есть все,
 *  кроме `reports` (свой отдельный путь). Порядок — как в `ViewId`, не важен. */
const PATH_VIEWS: readonly ViewId[] = [
  "board", "backlog", "sprints", "timeline", "workflow", "access", "admin", "docs", "collaborating",
];

const isPathView = (v: string): v is (typeof PATH_VIEWS)[number] => (PATH_VIEWS as readonly string[]).includes(v);

const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** URL для вида внутри проекта (или /reports — единственное исключение). */
export const pathForView = (projectKey: string, view: ViewId): string =>
  view === "reports" ? "/reports" : `/p/${enc(projectKey)}/${view}`;

/** URL прямой ссылки на задачу — всегда открывает её поверх доски (ТЗ 3.1 п.2:
 *  «модалка задачи открыта поверх доски сразу»), независимо от того, на каком виде
 *  задачу открыли — не о полноте истории навигации, а о простоте и предсказуемости
 *  адреса, который можно вставить в письмо. */
export const pathForIssue = (projectKey: string, issueKey: string): string =>
  `/p/${enc(projectKey)}/issue/${enc(issueKey)}`;

const RE_ISSUE = /^\/p\/([^/]+)\/issue\/([^/]+)\/?$/;
const RE_VIEW = /^\/p\/([^/]+)\/([^/]+)\/?$/;

export type ParsedPath =
  | { kind: "issue"; projectKey: string; issueKey: string }
  | { kind: "view"; projectKey: string; view: ViewId }
  | { kind: "reports" }
  | { kind: "root" };

/** Разбор `pathname` (без query/hash) в одну из ожидаемых форм роутера. Путь, который
 *  не подходит ни под одну схему (опечатка, устаревшая ссылка, чужой формат) —
 *  трактуется как `root`, а не как ошибка: та же терпимость, что была у старого
 *  `readIssueHash` к «хэш есть, но не похож на наш» (тихо игнорировался). */
export const parsePath = (pathname: string): ParsedPath => {
  if (pathname === "/reports") return { kind: "reports" };
  const mi = pathname.match(RE_ISSUE);
  if (mi) return { kind: "issue", projectKey: dec(mi[1]), issueKey: dec(mi[2]) };
  const mv = pathname.match(RE_VIEW);
  if (mv && isPathView(dec(mv[2]))) return { kind: "view", projectKey: dec(mv[1]), view: dec(mv[2]) as ViewId };
  return { kind: "root" };
};

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
