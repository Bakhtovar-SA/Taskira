/**
 * Внешние хранилища доменов с подпиской по селектору (ADR-0011, решение п. 1): `useSyncExternalStore` без
 * библиотеки состояния. Компонент подписывается не на весь стор, а на значение своего селектора и перерисовывается,
 * только если оно изменилось по `isEqual`. Перенос из прототипа `experimental/selectorStore.ts` (там же замер).
 *
 * Правило для нового кода: селектор возвращает стабильную ссылку — примитив, объект из хранилища как есть или
 * массив, сравниваемый `shallowEqualArray`. Новый объект на каждый вызов без `isEqual` перерисует компонент на любое
 * изменение хранилища.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

export interface ExternalStore<T> {
  getState(): T;
  /** Обновление по функции; тот же объект (`Object.is`) — подписчики не уведомляются. */
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
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const identity = <T,>(x: T) => x;

/** Значение селектора; перерисовка — только если оно изменилось по `isEqual`. Без селектора — всё состояние. */
export function useExternalStore<T, S = T>(
  store: ExternalStore<T>,
  selector: (state: T) => S = identity as (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  // Последний результат кэшируется: getSnapshot обязан возвращать ту же ссылку при равном значении,
  // иначе useSyncExternalStore перерисовывает (или зацикливается на новом массиве).
  const cache = useRef<{ state: T; value: S } | null>(null);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const prev = cache.current;
    if (prev && Object.is(prev.state, state)) return prev.value;
    const value = selectorRef.current(state);
    if (prev && isEqualRef.current(prev.value, value)) {
      cache.current = { state, value: prev.value };
      return prev.value;
    }
    cache.current = { state, value };
    return value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
