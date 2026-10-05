/** Shared bounds for session freshness and positively verified API credentials. */
export const AUTH_CACHE_TTL_MS = 30_000;
const AUTH_CACHE_MAX = 10_000;
export function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= AUTH_CACHE_MAX) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
