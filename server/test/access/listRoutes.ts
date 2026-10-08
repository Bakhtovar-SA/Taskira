/**
 * Перечисление ВСЕХ маршрутов приложения для матрицы доступа (SEC-IDOR-01).
 *
 * Источник — `app.printRoutes({ commonPrefix: false })`, а не хук `onRoute`: хук, добавленный после
 * `buildApp()`, не видит маршруты, которые `buildApp()` регистрирует синхронно (`/health`, `/ready`,
 * `/api/health`, `/metrics`), а печать дерева роутера видит всё, что реально обслуживается.
 *
 * Формат дерева (Fastify 5 / find-my-way) разбирается построчно: глубина — по префиксу из `│   `/`    `,
 * полный путь — конкатенация сегментов предков. Узлы без методов (разветвители общего префикса) пропускаются.
 * HEAD (создаётся Fastify автоматически вслед за GET) и OPTIONS (CORS-преflight) в манифест не входят.
 */
import type { FastifyInstance } from "fastify";

const IGNORED_METHODS = new Set(["HEAD", "OPTIONS"]);

export function listRoutes(app: FastifyInstance): string[] {
  const tree = app.printRoutes({ commonPrefix: false });
  const stack: string[] = [];
  const found = new Set<string>();
  for (const line of tree.split("\n")) {
    const m = /^((?:│ {3}| {4})*)[├└]── (.*)$/.exec(line);
    if (!m) continue;
    const depth = m[1].length / 4;
    const withMethods = /^(.*?)(?: \(([A-Z, ]+)\))?$/.exec(m[2]);
    const segment = withMethods?.[1] ?? m[2];
    stack.length = depth;
    stack[depth] = segment;
    const methods = withMethods?.[2];
    if (!methods) continue;
    // `/saved-views` и `/saved-views/` — один и тот же маршрут (ignoreTrailingSlash): сводим к одному.
    let path = stack.join("");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    for (const method of methods.split(", ")) {
      if (!IGNORED_METHODS.has(method)) found.add(`${method} ${path}`);
    }
  }
  return [...found].sort();
}
