import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { issuesApi, type IssueCounts, type IssueEpic, type IssueFilterParams, type IssueSortKey } from "./api";
import { mapIssue, useStore } from "./store";
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

/** Стабильное значение «без фильтров» для useIssueCounts (счётчики всего проекта). */
export const NO_ISSUE_FILTERS: IssueFilterParams = {};

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

export interface IssueSetOptions {
  /** Запрашивать счётчик набора (по умолчанию да). Доска считает колонки одним
   *  запросом на весь экран и отключает его в каждой колонке. */
  withCounts?: boolean;
}

/** `query = null` — набор не нужен (нет проекта). */
export function useIssueSet(query: IssueSetQuery | null, options: IssueSetOptions = {}): IssueSet {
  const withCounts = options.withCounts !== false;
  const withCountsRef = useRef(withCounts);
  withCountsRef.current = withCounts;
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
    Promise.all([
      issuesApi.page(q.projectId, base),
      withCountsRef.current ? issuesApi.counts(q.projectId, q.filters) : Promise.resolve(null),
    ]).then(
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
        const countsP = withCountsRef.current ? issuesApi.counts(q.projectId, q.filters) : Promise.resolve(null);
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

/* ------------------------------------------------------------------------- */

/** Значение с задержкой: поле ввода отвечает сразу, запрос к серверу — после паузы. */
export function useDebounced<T>(value: T, ms: number, immediate?: (v: T) => boolean): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), immediate?.(value) ? 0 : ms);
    return () => clearTimeout(id);
  }, [value, ms, immediate]);
  return v;
}

/**
 * Ревизия задач в сторе — явный счётчик, который стор увеличивает при
 * изменениях, способных поменять состав или порядок наборов (создание, импорт,
 * удаление, правка полей, смена статуса). Наборы перечитываются, когда он
 * меняется. Раньше ревизия считалась обходом всего массива задач на каждый
 * рендер (O(n)).
 */
export function useIssuesRevision(): string {
  return String(useStore().issuesRevision);
}

/** Вызывает `fn` при смене ревизии (но не при первом рендере). */
export function useOnRevision(revision: string, fn: () => void): void {
  const seen = useRef(revision);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    fnRef.current();
  }, [revision]);
}

/**
 * Строки набора в актуальном виде: если задачу правили (в том числе из модалки), берётся
 * свежая версия из стора, иначе — та, что пришла с сервера. Порядок — серверный, не
 * пересчитывается. Задачи, которых нет в сторе, НЕ отбрасываются: стор больше не держит
 * все задачи проекта, и «нет в сторе» не значит «удалена». Удаление отражает ревизия
 * (`issuesRevision` растёт при удалении, и набор перечитывается).
 */
export function freshRows(items: Issue[], byId: ReadonlyMap<string, Issue>): Issue[] {
  return items.map((i) => byId.get(i.id) ?? i);
}

export interface IssueCountsState {
  counts: IssueCounts | null;
  loading: boolean;
  error: string | null;
}

/**
 * Счётчики набора (`GET …/issues/counts`): один запрос на набор фильтров, не на
 * страницу и не на рендер. `filters = null` — счётчик не нужен. Перечитывается
 * при смене ревизии, не сбрасывая показанное.
 */
export function useIssueCounts(projectId: string | null, filters: IssueFilterParams | null, revision: string): IssueCountsState {
  const key = projectId && filters ? issueSetKey({ projectId, filters, sort: "rank", dir: "asc" }) : "";
  const argsRef = useRef({ projectId, filters });
  argsRef.current = { projectId, filters };
  const [state, setState] = useState<{ key: string; counts: IssueCounts | null; error: string | null }>({ key: "", counts: null, error: null });
  const gen = useRef(0);
  const currentKey = useRef(key);
  currentKey.current = key;

  const fetchCounts = useCallback((forKey: string, keepShown: boolean) => {
    const { projectId: pid, filters: f } = argsRef.current;
    const my = ++gen.current;
    if (!pid || !f) {
      setState({ key: "", counts: null, error: null });
      return;
    }
    if (!keepShown) setState({ key: forKey, counts: null, error: null });
    issuesApi.counts(pid, f).then(
      (counts) => {
        if (gen.current === my) setState({ key: forKey, counts, error: null });
      },
      (e: unknown) => {
        if (gen.current !== my) return;
        setState((prev) => (keepShown && prev.key === forKey ? prev : { key: forKey, counts: null, error: errText(e) }));
      },
    );
  }, []);

  useEffect(() => {
    fetchCounts(key, false);
    return () => {
      gen.current++;
    };
  }, [key, fetchCounts]);

  useOnRevision(revision, () => {
    if (currentKey.current) fetchCounts(currentKey.current, true);
  });

  const fresh = state.key === key;
  return {
    counts: fresh ? state.counts : null,
    loading: !!key && (!fresh || (state.counts === null && state.error === null)),
    error: fresh ? state.error : null,
  };
}

/**
 * Подгрузка при прокрутке к концу: наблюдает за элементом-«якорем» под списком и
 * вызывает `loadMore`, когда он приближается к видимой области. Запасной путь —
 * кнопка «Показать ещё» рядом. Без IntersectionObserver (тесты, старые браузеры)
 * хук ничего не делает. Колбэки наблюдателя не приходят в фоновой вкладке —
 * поэтому кнопка обязательна.
 */
export function useLoadMoreSentinel(
  loadMore: () => void,
  active: boolean,
  refreshKey: unknown,
  rootMargin = "300px",
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMoreRef.current(), { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
    // refreshKey: после каждой подгрузки якорь уходит вниз, наблюдение начинается заново
  }, [active, refreshKey, rootMargin]);
  return ref;
}

/**
 * Одна задача по id для отображения (бейдж эпика/родителя, родитель создаваемой
 * подзадачи): из кэша стора, а при промахе — один точечный запрос
 * (`GET …/issues/:id`) вместо поиска в списке всех задач. `null`, пока не
 * загружена или недоступна (удалена, нет доступа): вызывающий скрывает бейдж.
 */
export function useIssue(id: string | null | undefined): Issue | null {
  const { idx, lookupIssue } = useStore();
  const known = id ? (idx.issues.get(id) ?? null) : null;
  const [fetched, setFetched] = useState<{ id: string; issue: Issue | null } | null>(null);
  useEffect(() => {
    if (!id || known) return;
    let live = true;
    void lookupIssue(id).then((issue) => live && setFetched({ id, issue }));
    return () => {
      live = false;
    };
    // known как признак, а не объект: перерисовки со сменой ссылки не должны перезапрашивать
  }, [id, !!known, lookupIssue]);
  return known ?? (fetched && fetched.id === id ? fetched.issue : null);
}

export interface EpicsState {
  /** id направления → его данные (для бейджей). */
  byId: ReadonlyMap<string, IssueEpic>;
  list: readonly IssueEpic[];
  /** Направлений больше потолка сервера (500): часть бейджей может отсутствовать. */
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

const NO_EPICS: EpicsState = { byId: new Map(), list: [], truncated: false, loading: false, error: null };

/**
 * Справочник направлений проекта (`GET …/issues/epics`): один запрос на открытие
 * экрана и на смену `revision`, а не на каждую ревалидацию наборов — цена запроса
 * растёт с числом детей направлений (см. EPIC-01). Вызывающий выбирает, что считать
 * сигналом: Доска и Список — `epicsRevision` (меняются заголовок, цвет, привязка),
 * Timeline, которому нужны и счётчики детей, — `issuesRevision`. Показанное не
 * сбрасывается на время перечитывания.
 *
 * Отсутствие направления в справочнике = «не загружено или архивно», а не
 * «не существует»: вызывающий скрывает бейдж, но не считает задачу битой.
 */
export function useEpics(projectId: string | null, revision: string | number): EpicsState {
  const [state, setState] = useState<{ projectId: string | null; value: EpicsState }>({ projectId: null, value: NO_EPICS });
  const gen = useRef(0);
  useEffect(() => {
    const my = ++gen.current;
    if (!projectId) {
      setState({ projectId: null, value: NO_EPICS });
      return;
    }
    setState((prev) => (prev.projectId === projectId ? { ...prev, value: { ...prev.value, loading: true, error: null } } : { projectId, value: { ...NO_EPICS, loading: true } }));
    issuesApi.epics(projectId).then(
      (res) => {
        if (gen.current !== my) return;
        setState({ projectId, value: { byId: new Map(res.items.map((e) => [e.id, e])), list: res.items, truncated: res.truncated, loading: false, error: null } });
      },
      (e: unknown) => {
        if (gen.current !== my) return;
        setState((prev) => ({ projectId, value: { ...(prev.projectId === projectId ? prev.value : NO_EPICS), loading: false, error: errText(e) } }));
      },
    );
    return () => {
      gen.current++;
    };
  }, [projectId, revision]);
  return state.projectId === projectId ? state.value : NO_EPICS;
}
