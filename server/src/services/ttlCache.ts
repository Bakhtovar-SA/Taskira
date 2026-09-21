/**
 * Маленький кэш «ключ → результат» с временем жизни, на процесс. Для дорогих агрегатов, точность которых
 * «на эту секунду» пользователю не нужна (например, аватарки фильтра доски).
 *
 * - Одновременные запросы одного ключа делят одну загрузку (нет «стада» при истёкшем кэше).
 * - Ошибка загрузки не кэшируется.
 * - `ttlMs = 0` — кэш выключен, каждый вызов идёт в загрузчик (тесты, отладка).
 * - При нескольких процессах сервера у каждого свой кэш: данные могут отличаться между процессами
 *   на величину TTL, и это допустимо ровно там, где кэш применяется.
 */
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

const MAX_ENTRIES = 1000;

export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  const done = new Map<string, { value: T; expires: number }>();
  const inflight = new Map<string, Promise<T>>();

  function prune(at: number): void {
    if (done.size < MAX_ENTRIES) return;
    for (const [k, v] of done) if (v.expires <= at) done.delete(k);
    // всё ещё много живых записей: отбрасываем самые старые по порядку вставки
    while (done.size >= MAX_ENTRIES) done.delete(done.keys().next().value as string);
  }

  return {
    get(key, load) {
      if (ttlMs <= 0) return load();
      const at = now();
      const hit = done.get(key);
      if (hit && hit.expires > at) return Promise.resolve(hit.value);
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = load().then(
        (value) => {
          inflight.delete(key);
          prune(now());
          done.set(key, { value, expires: now() + ttlMs });
          return value;
        },
        (err) => {
          inflight.delete(key);
          throw err;
        },
      );
      inflight.set(key, p);
      return p;
    },
    clear() {
      done.clear();
      inflight.clear();
    },
  };
}
