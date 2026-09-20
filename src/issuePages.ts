import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { issuesApi, type IssueCounts, type IssueFilterParams, type IssueSortKey } from "./api";
import { mapIssue } from "./store";
import type { Issue } from "./types";

/**
 * Постраничный набор задач (PERF-05): первая страница + подгрузка по требованию.
 *
 * Набор определяется ключом «проект + фильтры + сортировка». Смена любого
 * элемента ключа сбрасывает набор и начинает загрузку заново — иначе в списке
 * смешались бы результаты двух фильтров. Ответы устаревших запросов (сменили
 * фильтр, пока страница ещё летела) отбрасываются по номеру поколения.
 *
 * Курсор живёт только здесь, в состоянии обхода: ни в URL, ни в сохранённых
 * фильтрах его нет — ссылка описывает фильтр, а не позицию внутри него.
 * Порядок задаёт сервер; на клиенте набор не пересортировывается, новые
 * страницы дописываются в конец и дедуплицируются по id.
 */

export const ISSUE_PAGE_SIZE = 100;

export interface IssueSetQuery {
  projectId: string;
  filters: IssueFilterParams;
  sort: IssueSortKey;
  dir: "asc" | "desc";
}

interface SetState {
  key: string;
  items: Issue[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Первая загрузка набора (skeleton). */
  loading: boolean;
  /** Подгрузка следующей страницы (компактный индикатор). */
  loadingMore: boolean;
  counts: IssueCounts | null;
  error: string | null;
}

const EMPTY: SetState = {
  key: "",
  items: [],
  nextCursor: null,
  hasMore: false,
  loading: false,
  loadingMore: false,
  counts: null,
  error: null,
};

/** Ключ набора: порядок полей фиксирован, пустые значения не влияют. */
export function issueSetKey(q: IssueSetQuery): string {
  const f = Object.entries(q.filters)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([q.projectId, f, q.sort, q.dir]);
}

/** Добавляет страницу в конец набора, пропуская уже присутствующие задачи. */
export function appendUnique(items: Issue[], page: Issue[]): Issue[] {
  if (page.length === 0) return items;
  const seen = new Set(items.map((i) => i.id));
  const fresh = page.filter((i) => !seen.has(i.id));
  return fresh.length === 0 ? items : [...items, ...fresh];
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface IssueSet {
  items: Issue[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Размер всего набора (сервер, один запрос на набор), null пока неизвестен. */
  total: number | null;
  counts: IssueCounts | null;
  error: string | null;
  loadMore: () => void;
  /** Перечитать уже загруженный диапазон, не сбрасывая набор и позицию. */
  revalidate: () => void;
  /** Начать набор заново (после ошибки первой загрузки). */
  reload: () => void;
}

/** `query = null` — набор не нужен (нет проекта). */
export function useIssueSet(query: IssueSetQuery | null): IssueSet {
  const key = query ? issueSetKey(query) : "";
  const queryRef = useRef(query);
  queryRef.current = query;

  const [state, setState] = useState<SetState>(EMPTY);
  // Поколение растёт при смене набора, reload и размонтировании: ответ с
  // чужим номером уже никому не нужен и игнорируется.
  const gen = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Синхронная защёлка подгрузки: state обновится только после рендера, а два
  // вызова loadMore() в одном тике (скролл + клик) прочитали бы loadingMore=false.
  const moreInFlight = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const q = queryRef.current;
    const my = ++gen.current;
    moreInFlight.current = false;
    if (!q) {
      setState(EMPTY);
      return;
    }
    setState({ ...EMPTY, key, loading: true });
    const base = { ...q.filters, sort: q.sort, dir: q.dir, limit: ISSUE_PAGE_SIZE };
    // Страница и счётчик — параллельно, но счётчик один на набор.
    Promise.all([issuesApi.page(q.projectId, base), issuesApi.counts(q.projectId, q.filters)]).then(
      ([page, counts]) => {
        if (gen.current !== my) return;
        setState({
          key,
          items: appendUnique([], page.items.map((d) => mapIssue(d))),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loading: false,
          loadingMore: false,
          counts,
          error: null,
        });
      },
      (e: unknown) => {
        if (gen.current !== my) return;
        setState({ ...EMPTY, key, error: errText(e) });
      },
    );
    return () => {
      gen.current++;
    };
    // key уже включает всё, что определяет набор
  }, [key, reloadTick]);

  const loadMore = useCallback(() => {
    const q = queryRef.current;
    const s = stateRef.current;
    if (moreInFlight.current || !q || s.loading || !s.hasMore || !s.nextCursor || s.key !== issueSetKey(q)) return;
    moreInFlight.current = true;
    const my = gen.current;
    setState((prev) => ({ ...prev, loadingMore: true, error: null }));
    issuesApi
      .page(q.projectId, { ...q.filters, sort: q.sort, dir: q.dir, limit: ISSUE_PAGE_SIZE, cursor: s.nextCursor })
      .then(
        (page) => {
          if (gen.current !== my) return;
          moreInFlight.current = false;
          setState((prev) => ({
            ...prev,
            items: appendUnique(prev.items, page.items.map((d) => mapIssue(d))),
            nextCursor: page.nextCursor,
            // пустая страница при hasMore — защита от бесконечного цикла подгрузки
            hasMore: page.hasMore && page.items.length > 0,
            loadingMore: false,
          }));
        },
        (e: unknown) => {
          if (gen.current !== my) return;
          moreInFlight.current = false;
          setState((prev) => ({ ...prev, loadingMore: false, error: errText(e) }));
        },
      );
  }, []);

  const revalidate = useCallback(() => {
    const q = queryRef.current;
    const s = stateRef.current;
    if (!q || s.loading || s.key !== issueSetKey(q)) return;
    const my = gen.current;
    const want = Math.max(s.items.length, 1);
    void (async () => {
      try {
        const base = { ...q.filters, sort: q.sort, dir: q.dir, limit: ISSUE_PAGE_SIZE };
        const countsP = issuesApi.counts(q.projectId, q.filters);
        countsP.catch(() => undefined); // отказ страницы не должен оставлять необработанный rejection
        let page = await issuesApi.page(q.projectId, base);
        let items = appendUnique([], page.items.map((d) => mapIssue(d)));
        // Дочитываем до прежней глубины: пользователь не теряет позицию в длинном списке.
        while (items.length < want && page.hasMore && page.nextCursor) {
          if (gen.current !== my) return;
          page = await issuesApi.page(q.projectId, { ...base, cursor: page.nextCursor });
          if (page.items.length === 0) break;
          items = appendUnique(items, page.items.map((d) => mapIssue(d)));
        }
        const counts = await countsP;
        if (gen.current !== my) return;
        setState((prev) => ({
          ...prev,
          items,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          counts,
          error: null,
        }));
      } catch {
        // Тихая ревалидация: устаревший список лучше пустого; следующее действие повторит.
      }
    })();
  }, []);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  return useMemo(
    () => ({
      items: state.key === key ? state.items : [],
      // между сменой ключа и эффектом кадр отрисуется с прежним набором — считаем его загрузкой
      loading: state.key !== key ? !!query : state.loading,
      loadingMore: state.loadingMore,
      hasMore: state.key === key && state.hasMore,
      total: state.key === key && state.counts ? state.counts.total : null,
      counts: state.key === key ? state.counts : null,
      error: state.key === key ? state.error : null,
      loadMore,
      revalidate,
      reload,
    }),
    [state, key, query, loadMore, revalidate, reload],
  );
}
