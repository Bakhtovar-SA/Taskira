#!/usr/bin/env node
// ТЗ 5.2 — бюджет размера бандла (docs/design/PERF-BUDGET.md). Запускается ПОСЛЕ
// `npm run build`: читает dist/assets/*.js и *.css, сжимает каждый файл gzip
// (node:zlib, уровень по умолчанию — как в отчёте Vite), суммирует и сравнивает с
// базой в scripts/bundle-budget.json плюс допустимым ростом. Шрифты и картинки не
// считаются: у них отдельное правило (≤ 2 файла шрифтов на первом экране).
//
// Проверяются: весь JS, весь CSS, входной чанк (скрипт из dist/index.html) и
// JS+CSS вместе — это и есть «рост за трек ≤ +80 КБ gzip». Превышение любого — код 1.
//
//   node scripts/check-bundle-size.mjs            проверка (npm run bundle:check)
//   node scripts/check-bundle-size.mjs --json     то же, машинный вывод
//   node scripts/check-bundle-size.mjs --update   переписать base текущими размерами
//                                                 (только осознанно: новая база = новая точка отсчёта трека)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const assets = join(dist, "assets");
const budgetPath = join(root, "scripts", "bundle-budget.json");
const KB = 1024;
const fmt = (b) => `${(b / KB).toFixed(2)} KB`;
const signed = (b) => `${b >= 0 ? "+" : "−"}${fmt(Math.abs(b))}`;

if (!existsSync(assets)) {
  console.error("dist/assets не найден — сначала npm run build");
  process.exit(2);
}

const gz = (file) => gzipSync(readFileSync(file)).length;
const files = readdirSync(assets)
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .sort()
  .map((f) => ({ name: f, kind: f.endsWith(".js") ? "js" : "css", gzip: gz(join(assets, f)) }));

const html = readFileSync(join(dist, "index.html"), "utf8");
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) {
  console.error("входной скрипт в dist/index.html не найден");
  process.exit(2);
}
const entryName = entryMatch[1];
const preloaded = [...html.matchAll(/rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);

const sum = (kind) => files.filter((f) => f.kind === kind).reduce((a, f) => a + f.gzip, 0);
const current = {
  js: sum("js"),
  css: sum("css"),
  entry: files.find((f) => f.name === entryName)?.gzip ?? 0,
};
current.total = current.js + current.css;
// Справочно, не проверяется: JS, который грузится до первого экрана (вход + modulepreload).
const initialJs = [entryName, ...preloaded].reduce((a, n) => a + (files.find((f) => f.name === n)?.gzip ?? 0), 0);

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

if (process.argv.includes("--update")) {
  budget.base = { ...current, note: budget.base?.note ?? "" };
  writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(`база обновлена: ${JSON.stringify(budget.base)}`);
  process.exit(0);
}

const METRICS = [
  ["total", "JS + CSS"],
  ["js", "JS, все чанки"],
  ["css", "CSS"],
  ["entry", `входной чанк (${entryName.replace(/-[\w-]+\.js$/, ".js")})`],
];
const results = METRICS.map(([key, label]) => {
  const base = budget.base[key];
  const allowed = budget.allowedGrowth[key];
  const limit = base + allowed;
  return { key, label, base, allowed, limit, current: current[key], growth: current[key] - base, ok: current[key] <= limit };
});
const failed = results.filter((r) => !r.ok);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ current, initialJs, files, results, ok: failed.length === 0 }, null, 2));
} else {
  console.log("Бюджет бандла (gzip), база и допуски — scripts/bundle-budget.json\n");
  console.log("| метрика | база | сейчас | рост | допуск | итог |");
  console.log("|---|---|---|---|---|---|");
  for (const r of results)
    console.log(`| ${r.label} | ${fmt(r.base)} | ${fmt(r.current)} | ${signed(r.growth)} | +${fmt(r.allowed)} | ${r.ok ? "ok" : "ПРЕВЫШЕН"} |`);
  console.log(`\nСправочно: JS до первого экрана (вход + modulepreload: ${[entryName, ...preloaded].map((n) => basename(n)).join(", ")}) — ${fmt(initialJs)}`);
  console.log("\nЧанки:");
  for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) console.log(`  ${f.name.padEnd(44)} ${fmt(f.gzip).padStart(10)}`);
}

if (failed.length) {
  for (const r of failed)
    console.error(`\nбюджет превышен: ${r.label} = ${fmt(r.current)} > ${fmt(r.limit)} (база ${fmt(r.base)} + ${fmt(r.allowed)})`);
  console.error("Уменьшите бандл или, если рост осознан, обсудите новый допуск/базу в docs/design/PERF-BUDGET.md.");
  process.exit(1);
}
