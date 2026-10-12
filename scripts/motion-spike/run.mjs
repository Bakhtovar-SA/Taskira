// ADR-0035 — драйвер спайка «библиотека motion под production CSP». Метод и сервер — из csp-spike (ADR-0010):
// csp-spike/server.mjs читает строку CSP из nginx.conf и отдаёт страницу этого каталога с тем же заголовком;
// Chromium открывает её через Playwright, проверки пишут результат и нарушения (securitypolicyviolation).
//
// motion НЕ зависимость репозитория (пока ADR-0035 Proposed) — его ставят во временный каталог вне репо:
//
//   mkdir -p /tmp/motion-spike && (cd /tmp/motion-spike && npm i --ignore-scripts motion@13.4.4)
//   SPIKE_NODE_MODULES=/tmp/motion-spike/node_modules npm run motion:spike   # или node scripts/motion-spike/run.mjs [--json]
//   SPIKE_NODE_MODULES=/tmp/motion-spike/node_modules node scripts/motion-spike/size.mjs   # размеры gzip
//
// react/react-dom, esbuild и playwright (версия @playwright/test — её браузер уже стоит) берутся из node_modules репозитория (один React на страницу).
// JSX пробы React собирается с jsxImportSource "#secure-jsx" — как продукт (vite.config.js).
// Два прохода: обычный и с эмуляцией prefers-reduced-motion: reduce (?reduced=1, только группа (d)).
// Код выхода 1 — если контрольные проверки прошли (CSP не действует) или страница не отработала.
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { startServer } from "../csp-spike/server.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..");
const spikeNm = process.env.SPIKE_NODE_MODULES;
if (!spikeNm) {
  console.error("motion не найден: задайте SPIKE_NODE_MODULES (см. шапку файла)");
  process.exit(2);
}
const { chromium } = createRequire(join(repoRoot, "package.json"))("playwright");
const motionVersion = createRequire(join(spikeNm, "noop.js"))("motion/package.json").version;

const PROBES = {
  mini: "probes/mini.mjs",
  hybrid: "probes/hybrid.mjs",
  react: "probes/react-probe.jsx",
  wrapper: "probes/motion-wrapper.mjs",
};
const extraVendor = {};
for (const [name, entry] of Object.entries(PROBES)) {
  const outdir = await mkdtemp(join(tmpdir(), `motion-spike-${name}-`));
  await build({
    entryPoints: [join(here, entry)],
    outdir,
    entryNames: "[name]",
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    jsx: "automatic",
    jsxImportSource: "#secure-jsx",
    nodePaths: [join(repoRoot, "node_modules"), spikeNm],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.PROD": "true", "import.meta.env.DEV": "false" },
    logLevel: "error",
  });
  for (const f of await readdir(outdir)) extraVendor[`/vendor/${name}/${f}`] = join(outdir, f);
}

const { server, url, csp } = await startServer({ extraVendor, root: join(here, "page"), floatingUiNodeModules: null });
const browser = await chromium.launch();
const passes = [];
const consoleLines = [];
try {
  for (const reduced of [false, true]) {
    const context = await browser.newContext({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    page.on("console", (m) => consoleLines.push(`[${reduced ? "reduce" : "normal"}][${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => consoleLines.push(`[${reduced ? "reduce" : "normal"}][pageerror] ${e.message}`));
    const resp = await page.goto(reduced ? `${url}?reduced=1` : url);
    if (resp.headers()["content-security-policy"] !== csp) throw new Error("сервер отдал не ту CSP");
    await page.waitForSelector("body[data-done='1']", { timeout: 60_000 });
    passes.push(await page.evaluate(() => window.__spike));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const controlsHold = passes.every((p) => p.results.filter((r) => r.id.startsWith("ctl-")).every((r) => !r.works && r.violations.length > 0));
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ csp, motionVersion, browser: browser.version(), passes, console: consoleLines, controlsHold }, null, 2));
} else {
  console.log(`Браузер: Chromium ${browser.version()}; motion ${motionVersion}`);
  console.log(`CSP (из nginx.conf): ${csp}\n`);
  for (const p of passes) {
    console.log(`### Проход: ${p.reducedPass ? "prefers-reduced-motion: reduce" : "обычный"}\n`);
    console.log("| проверка | эффект | нарушения CSP | Δ CSS-правил | Δ <style> | наблюдение |");
    console.log("|---|---|---|---|---|---|");
    for (const r of p.results) {
      const v = r.violations.length ? r.violations.map((x) => `${x.directive}${x.sample ? ` «${x.sample.slice(0, 30)}»` : ""}`).join("; ") : "—";
      const works = r.works === null ? "наблюдение" : r.works ? "работает" : "НЕ работает";
      console.log(`| ${r.id} — ${r.label} | ${works} | ${v} | ${r.rulesDelta} | ${r.styleElementsDelta} | ${r.observed} |`);
    }
    console.log(`\nВсего securitypolicyviolation: ${p.violationsTotal}\n`);
  }
  const cspConsole = consoleLines.filter((l) => /Content Security Policy/i.test(l));
  console.log(`Сообщений CSP в консоли браузера: ${cspConsole.length}`);
  for (const l of cspConsole) console.log(`  ${l.slice(0, 200)}`);
  const other = consoleLines.filter((l) => !/Content Security Policy/i.test(l));
  if (other.length) console.log(`Прочая консоль:\n${other.map((l) => `  ${l.slice(0, 200)}`).join("\n")}`);
  console.log(`\nКонтроли (CSP действует): ${controlsHold ? "да" : "НЕТ — результатам верить нельзя"}`);
}
process.exit(controlsHold ? 0 : 1);
