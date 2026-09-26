/**
 * ЭКСПЕРИМЕНТ ТЗ 5.2 / ADR-0011 — прототип подписки с селектором поверх
 * `useSyncExternalStore` для ОДНОГО домена (список задач). В продукте не
 * используется: его импортирует только замер `src/perf/rerenders.test.tsx`.
 * Не переносить в store.tsx без решения по ADR-0011 — план миграции там.
 *
 * Идея: компонент подписывается не на весь стор, а на значение, которое вернул
 * его селектор; React перерисует компонент, только если это значение изменилось
 * по `isEqual`. Карточка читает свою задачу по id, колонка — список id.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

export interface ExternalStore<T> {
  getState(): T;
  setState(update: (prev: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Значение селектора; ререндер — только если оно изменилось по `isEqual`. */
export function useStoreSelector<T, S>(
  store: ExternalStore<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  // Последний выбранный результат кэшируется, чтобы getSnapshot возвращал ту же
  // ссылку при равном значении (иначе useSyncExternalStore зациклится на новом массиве).
  const cache = useRef<{ state: T; value: S } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const prev = cache.current;
    if (prev && Object.is(prev.state, state)) return prev.value;
    const value = selector(state);
    if (prev && isEqual(prev.value, value)) {
      cache.current = { state, value: prev.value };
      return prev.value;
    }
    cache.current = { state, value };
    return value;
    // selector/isEqual намеренно не в зависимостях: вызывающие передают инлайн-функции,
    // а селектор должен зависеть только от стабильных аргументов (id задачи, id статуса).
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/* ── Домен «список задач» ─────────────────────────────────────────────────── */

export interface IssueListState<I extends { id: string; statusId: string }> {
  byId: ReadonlyMap<string, I>;
  /** Порядок карточек в колонке: statusId → id задач. */
  order: ReadonlyMap<string, readonly string[]>;
}

export function createIssueListStore<I extends { id: string; statusId: string }>(issues: I[]) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const order = new Map<string, string[]>();
  for (const i of issues) order.set(i.statusId, [...(order.get(i.statusId) ?? []), i.id]);
  const store = createExternalStore<IssueListState<I>>({ byId, order });
  return {
    store,
    /** Точечная правка: меняется одна запись byId, порядок — только при смене статуса. */
    patchIssue(id: string, patch: Partial<I>) {
      store.setState((s) => {
        const prev = s.byId.get(id);
        if (!prev) return s;
        const next = { ...prev, ...patch };
        const nextById = new Map(s.byId);
        nextById.set(id, next);
        if (patch.statusId === undefined || patch.statusId === prev.statusId) return { byId: nextById, order: s.order };
        const nextOrder = new Map(s.order);
        nextOrder.set(prev.statusId, (s.order.get(prev.statusId) ?? []).filter((x) => x !== id));
        nextOrder.set(next.statusId, [...(s.order.get(next.statusId) ?? []), id]);
        return { byId: nextById, order: nextOrder };
      });
    },
  };
}

const EMPTY_IDS: readonly string[] = [];

export function useIssue<I extends { id: string; statusId: string }>(store: ExternalStore<IssueListState<I>>, id: string): I | undefined {
  return useStoreSelector(store, (s) => s.byId.get(id));
}

export function useColumnIssueIds<I extends { id: string; statusId: string }>(
  store: ExternalStore<IssueListState<I>>,
  statusId: string,
): readonly string[] {
  return useStoreSelector(store, (s) => s.order.get(statusId) ?? EMPTY_IDS, shallowEqualArray);
}
