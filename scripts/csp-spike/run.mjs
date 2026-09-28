// ТЗ 5.2, ADR-0010 — драйвер спайка: поднимает server.mjs (production CSP из nginx.conf),
// открывает страницу в Chromium через Playwright, собирает результаты проверок, нарушения
// CSP (событие securitypolicyviolation + консоль браузера) и печатает таблицу.
//
// Ни playwright-core, ни @floating-ui/dom не зависимости репозитория — их ставят во
// временный каталог вне репо и передают пути переменными окружения:
//
//   mkdir -p /tmp/csp-spike && (cd /tmp/csp-spike && npm i playwright-core @floating-ui/dom)
//   SPIKE_NODE_MODULES=/tmp/csp-spike/node_modules \
//   CHROMIUM_PATH=/path/to/chrome \            # необязательно: иначе браузер playwright по умолчанию
//   node scripts/csp-spike/run.mjs [--json]
//
// SPIKE_NODE_MODULES — node_modules, где лежат playwright-core и (необязательно) @floating-ui/dom;
// FLOATING_UI_NODE_MODULES / PLAYWRIGHT_NODE_MODULES переопределяют каждый по отдельности.
// Код выхода 1 — если контрольные проверки прошли (значит, CSP не действует и
// результатам верить нельзя) или страница не отработала.
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";

const shared = process.env.SPIKE_NODE_MODULES;
const pwDir = process.env.PLAYWRIGHT_NODE_MODULES ?? shared;
const fuDir = process.env.FLOATING_UI_NODE_MODULES ?? shared;
const requireFrom = pwDir ? createRequire(join(pwDir, "noop.js")) : createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = requireFrom("playwright-core"));
} catch {
  console.error("playwright-core не найден: задайте SPIKE_NODE_MODULES (см. шапку файла)");
  process.exit(2);
}

// Проба React: обычный `style` prop без secure-jsx. esbuild приходит транзитивно (tsx/vite);
// нет его — проверка помечается skipped, остальное работает.
const extraVendor = {};
try {
  const { build } = await import("esbuild");
  const outDir = await mkdtemp(join(tmpdir(), "csp-spike-"));
  const outfile = join(outDir, "react-probe.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./page/react-probe.mjs", import.meta.url))],
    bundle: true,
    format: "esm",
    minify: true,
    outfile,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  extraVendor["/vendor/react-probe.mjs"] = outfile;
} catch (err) {
  console.error(`проба React пропущена: ${err.message}`);
}

const { server, url, csp } = await startServer({ floatingUiNodeModules: fuDir, extraVendor });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const console_ = [];
let report;
try {
  const page = await browser.newPage();
  page.on("console", (m) => console_.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console_.push(`[pageerror] ${e.message}`));
  const resp = await page.goto(url);
  const headerCsp = resp.headers()["content-security-policy"];
  if (headerCsp !== csp) throw new Error("сервер отдал не ту CSP");
  await page.waitForSelector("body[data-done='1']", { timeout: 20_000 });
  report = await page.evaluate(() => window.__spike);
  report.browserVersion = browser.version();
} finally {
  await browser.close();
  server.close();
}

const rows = report.results.map((r) => {
  const v = r.violations.length ? r.violations.map((x) => `${x.directive}${x.sample ? ` «${x.sample.slice(0, 40)}»` : ""}`).join("; ") : "—";
  const works = r.works === null ? "skipped" : r.works ? "работает" : "НЕ работает";
  return { id: r.id, label: r.label, works, violations: v, observed: r.observed, rulesDelta: r.rulesDelta ?? "—" };
});

const controlsHold = report.results.filter((r) => r.id.startsWith("ctl-")).every((r) => !r.works && r.violations.length > 0);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ csp, ...report, console: console_, controlsHold }, null, 2));
} else {
  console.log(`Браузер: Chromium ${report.browserVersion}`);
  console.log(`CSP (из nginx.conf): ${csp}`);
  console.log(`floating-ui: ${report.floatingUi ?? "не подключён"}\n`);
  console.log("| проверка | эффект применён | нарушения CSP | Δ CSS-правил | наблюдение |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.id} — ${r.label} | ${r.works} | ${r.violations} | ${r.rulesDelta} | ${r.observed} |`);
  console.log(`\nВсего securitypolicyviolation: ${report.violationsTotal}`);
  const cspConsole = console_.filter((l) => /Content Security Policy/i.test(l));
  console.log(`Сообщений CSP в консоли браузера: ${cspConsole.length}`);
  for (const l of cspConsole) console.log(`  ${l.slice(0, 220)}`);
  const other = console_.filter((l) => !/Content Security Policy/i.test(l));
  if (other.length) console.log(`Прочая консоль:\n${other.map((l) => `  ${l}`).join("\n")}`);
  console.log(`\nКонтроли (CSP действует): ${controlsHold ? "да" : "НЕТ — результатам верить нельзя"}`);
}
process.exit(controlsHold ? 0 : 1);
