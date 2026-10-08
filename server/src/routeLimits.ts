import { loadConfig } from "./config.js";

/**
 * Лимиты на чувствительные маршруты (SEC-RATE-01). Это тот же @fastify/rate-limit, что зарегистрирован в app.ts, —
 * второго механизма нет: маршрут лишь переопределяет `max`/`timeWindow` через `config.rateLimit`. Ключ берётся из
 * глобального keyGenerator (`token:…` / `user:…` / `ip:…` для неаутентифицированных), корзина у каждого маршрута своя.
 * Счёт — в памяти процесса (ADR-0024: один серверный процесс на БД). Значения читаются на каждый запрос, поэтому
 * тест может менять `loadConfig().rateLimit`. При `RATE_LIMIT_ENABLED=false` плагин не регистрируется и всё это — no-op.
 */
export type RouteLimitKind = "sensitive" | "export" | "search" | "dashboardData";

export function routeLimit(kind: RouteLimitKind) {
  const rl = () => loadConfig().rateLimit;
  const max = () => {
    const c = rl();
    return kind === "sensitive" ? c.sensitiveMax : kind === "export" ? c.exportMax : kind === "search" ? c.searchMax : c.dashboardDataMax;
  };
  return { config: { rateLimit: { max, timeWindow: () => rl().actionWindowMs } } };
}
