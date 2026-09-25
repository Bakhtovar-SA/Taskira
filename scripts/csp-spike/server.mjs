// ТЗ 5.2, ADR-0010 — статический сервер спайка «динамические стили под CSP».
//
// Отдаёт scripts/csp-spike/page/* с ТОЙ ЖЕ строкой Content-Security-Policy, что и
// production nginx: строка не скопирована сюда, а читается из nginx.conf при старте
// (все add_header Content-Security-Policy в файле обязаны совпадать — иначе спайк
// проверял бы не ту политику, и сервер отказывается стартовать).
//
// @floating-ui/dom НЕ зависимость репозитория: его ставят во временный каталог
// (`npm i @floating-ui/dom` где угодно вне репо) и передают путь к node_modules
// через FLOATING_UI_NODE_MODULES. Без него проверка floating-ui в отчёте — «skipped».
//
// Запуск отдельно (для ручной проверки в браузере): node scripts/csp-spike/server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const pageDir = join(here, "page");

export function productionCsp() {
  const conf = readFileSync(join(repoRoot, "nginx.conf"), "utf8");
  const found = [...conf.matchAll(/add_header\s+Content-Security-Policy\s+"([^"]+)"/g)].map((m) => m[1]);
  if (found.length === 0) throw new Error("nginx.conf: Content-Security-Policy не найден");
  if (new Set(found).size !== 1) throw new Error(`nginx.conf: ${found.length} разных CSP — спайк не знает, какую проверять`);
  return found[0];
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

/** extraVendor: { "/vendor/x.mjs": "/abs/path" } — файлы, собранные драйвером (проба React). */
export function startServer({ port = 0, floatingUiNodeModules = process.env.FLOATING_UI_NODE_MODULES, extraVendor = {} } = {}) {
  const csp = productionCsp();
  const vendor = {};
  for (const [url, file] of Object.entries(extraVendor)) vendor[url] = () => readFile(file, "utf8");
  if (floatingUiNodeModules && existsSync(join(floatingUiNodeModules, "@floating-ui", "dom"))) {
    const fu = join(floatingUiNodeModules, "@floating-ui");
    // Браузерная сборка dom импортирует голый спецификатор "@floating-ui/core"; import map
    // пришлось бы писать инлайн-скриптом, который та же CSP запрещает, — поэтому переписываем путь.
    vendor["/vendor/floating-ui-core.mjs"] = () => readFile(join(fu, "core", "dist", "floating-ui.core.browser.min.mjs"), "utf8");
    vendor["/vendor/floating-ui-dom.mjs"] = async () =>
      (await readFile(join(fu, "dom", "dist", "floating-ui.dom.browser.min.mjs"), "utf8")).replaceAll('"@floating-ui/core"', '"./floating-ui-core.mjs"');
    vendor["/vendor/version.json"] = () => readFile(join(fu, "dom", "package.json"), "utf8").then((s) => JSON.stringify({ version: JSON.parse(s).version }));
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const headers = { "Content-Security-Policy": csp, "Cache-Control": "no-store" };
    try {
      if (path === "/favicon.ico") {
        res.writeHead(204, headers);
        return res.end();
      }
      if (vendor[path]) {
        const body = await vendor[path]();
        res.writeHead(200, { ...headers, "Content-Type": path.endsWith(".json") ? "application/json" : "text/javascript" });
        return res.end(body);
      }
      const rel = normalize(path === "/" ? "/index.html" : path).replace(/^([/\\])+/, "");
      if (rel.startsWith("..")) throw Object.assign(new Error("forbidden"), { code: "ENOENT" });
      const body = await readFile(join(pageDir, rel));
      res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, headers);
      res.end("not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, csp, url: `http://127.0.0.1:${addr.port}/`, hasFloatingUi: Object.keys(vendor).length > 0 });
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url, csp, hasFloatingUi } = await startServer({ port: Number(process.argv[2] ?? 4173) });
  console.log(`CSP spike: ${url}\nCSP: ${csp}\nfloating-ui: ${hasFloatingUi ? "да" : "нет (FLOATING_UI_NODE_MODULES не задан)"}`);
}
