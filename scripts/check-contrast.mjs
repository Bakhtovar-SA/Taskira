#!/usr/bin/env node
// ТЗ 5.4 п.7 — автоматическая проверка контраста семантических пар
// текст/фон во всех темах (базовые светлая/тёмная + курируемые, ТЗ 5.14). Читает src/styles/tokens.css, резолвит var()
// внутри блока темы (светлая = :root, тёмная = :root + [data-theme="dark"]),
// переводит OKLCH → sRGB и считает контраст WCAG 2.x. Падает (exit 1),
// если хоть одна пара ниже порога: 4.5 — текст, 3.0 — элементы интерфейса.
//
// Запуск: node scripts/check-contrast.mjs   (npm run contrast:check)
import { readFileSync } from "node:fs";

/** Убирает @media-блоки целиком: переопределения для prefers-contrast и т.п.
 *  не должны подмешиваться в базовую тему. */
function stripAtRules(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("@media", i)) {
      let depth = 0;
      let j = text.indexOf("{", i);
      for (; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
    } else out += text[i++];
  }
  return out;
}

const rawCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripAtRules(rawCss);

/** Декларации из блоков с точно таким селектором. */
function block(selector, source = css) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[1].trim() !== selector) continue;
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      if (k.startsWith("--")) out[k] = d.slice(i + 1).trim();
    }
  }
  return out;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };
// Курируемые темы (ТЗ 5.14 п.3): базовая + data-skin.
const skin = (base, id) => ({ ...base, ...block(`:root[data-skin="${id}"]`) });

// Actual high-contrast declarations, including the explicit personal glass override.
const contrastCss = /@media \(prefers-contrast: more\)\s*\{([\s\S]*?)\n\}/.exec(rawCss)?.[1];
if (!contrastCss) throw new Error("high-contrast tokens missing");
const contrastVars = block(":root", contrastCss);
const variants = [];
for (const [name, base, isDark] of [
  ["light", light, false], ["dark", dark, true],
  ["dusk", skin(dark, "dusk"), true], ["graphite", skin(dark, "graphite"), true],
  ["dawn", skin(light, "dawn"), false], ["paper", skin(light, "paper"), false],
]) {
  for (const transparency of ["on", "off"]) for (const contrast of [false, true]) {
    const vars = { ...base, ...(contrast ? contrastVars : {}) };
    if (transparency === "off") Object.assign(vars, {
      "--bg-glass": "var(--bg-raised)", "--glass-side": "var(--bg-frame)", "--glass-sheet": "var(--bg-canvas)",
    });
    vars["--palette-glass"] = transparency === "off" ? "var(--bg-overlay)" : base["--bg-overlay"].replace(/\)$/, " / 0.9)");
    variants.push([`${name}/transparency=${transparency}/contrast=${contrast}`, vars, isDark]);
  }
}

function resolve(vars, value, depth = 0) {
  if (depth > 20) throw new Error(`var() cycle: ${value}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    if (!(name in vars)) throw new Error(`unknown token ${name}`);
    return resolve(vars, vars[name], depth + 1);
  });
}

/** oklch(L C H [/ A]) → линейный sRGB [0..1] + альфа. */
function oklch(str) {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(str);
  if (!m) throw new Error(`not oklch: ${str}`);
  const [L, C, H] = [+m[1], +m[2], (+m[3] * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return { rgb, alpha: m[4] === undefined ? 1 : +m[4] };
}

const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Цвет поверх фона: смешение в гамма-пространстве, как у браузера. */
function over(fg, bg) {
  if (fg.alpha >= 1) return fg.rgb;
  return fg.rgb.map((c, i) => toLinear(toGamma(c) * fg.alpha + toGamma(bg[i]) * (1 - fg.alpha)));
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [текст/элемент, фон, порог, подложка под полупрозрачным фоном]
const TEXT = 4.5;
const UI = 3.0;
const PAIRS = [
  ["--text-1", "--bg-canvas", TEXT],
  ["--text-on-accent", "--status-danger-strong", TEXT],
  ["--text-1", "--bg-panel", TEXT],
  ["--text-2", "--bg-canvas", TEXT],
  ["--text-2", "--bg-panel", TEXT],
  ["--text-2", "--bg-frame", TEXT],
  ["--text-2", "--bg-hover", TEXT],
  ["--text-3", "--bg-canvas", TEXT],
  ["--text-3", "--bg-panel", TEXT],
  ["--text-3", "--bg-frame", TEXT],
  ["--text-3", "--bg-sunken", TEXT],
  ["--text-3", "--bg-raised", TEXT],
  ["--text-1", "--bg-sidebar", TEXT, "--bg-frame"],
  ["--text-2", "--bg-sidebar", TEXT, "--bg-frame"],
  ["--text-3", "--bg-sidebar", TEXT, "--bg-frame"],
  ["--text-1", "--bg-glass", TEXT, "--bg-canvas"],
  ["--text-1", "--palette-glass", TEXT, "--bg-canvas"],
  ["--text-2", "--palette-glass", TEXT, "--bg-canvas"],
  ["--text-3", "--palette-glass", TEXT, "--bg-canvas"],
  ["--text-1", "--glass-side", TEXT, "--bg-frame"],
  ["--text-3", "--glass-side", TEXT, "--bg-frame"],
  ["--text-3", "--glass-sheet", TEXT, "--bg-frame"],
  ["--text-on-accent", "--accent-solid", TEXT],
  ["--text-on-accent", "--accent-hover", TEXT],
  ["--accent-text", "--bg-panel", TEXT],
  ["--accent-text", "--bg-canvas", TEXT],
  ["--accent-text", "--accent-subtle", TEXT, "--bg-panel"],
  ["--status-done-fg", "--status-done-bg", TEXT],
  ["--status-progress-fg", "--status-progress-bg", TEXT],
  ["--status-todo-fg", "--status-todo-bg", TEXT],
  ["--status-danger-fg", "--status-danger-bg", TEXT],
  ["--status-danger-fg", "--bg-panel", TEXT],
  ["--status-warn", "--bg-panel", UI],
  ["--accent-solid", "--bg-panel", UI],
  ["--accent-solid", "--bg-canvas", UI],
  ["--status-done", "--bg-panel", UI],
  ["--status-danger", "--bg-panel", UI],
  ["--border-strong", "--bg-panel", 1.3],
];

let failed = 0;
for (const [name, vars] of variants) {
  console.log(`\n${name}`);
  for (const [fgName, bgName, min, baseName] of PAIRS) {
    const base = baseName ? oklch(resolve(vars, vars[baseName])).rgb : [1, 1, 1];
    const bg = over(oklch(resolve(vars, vars[bgName])), base);
    const fg = over(oklch(resolve(vars, vars[fgName])), bg);
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)} ≥ ${min}  ${fgName} on ${bgName}${baseName ? ` (over ${baseName})` : ""}`);
  }
}
// ── Оттенок бренда (ТЗ 5.14 п.5): все пары во всех темах для каждого оттенка допустимого диапазона
// (server/src/contract.ts BRAND_HUE). Сервер принимает только этот диапазон — так «контраст проверяется
// автоматически при сохранении»: сохранить можно лишь то, что здесь уже проверено.
const contract = readFileSync(new URL("../server/src/contract.ts", import.meta.url), "utf8");
const hueRange = /BRAND_HUE = \{ min: (\d+), max: (\d+)/.exec(contract);
if (!hueRange) throw new Error("BRAND_HUE не найден в contract.ts");
const [hueMin, hueMax] = [+hueRange[1], +hueRange[2]];
let hueWorst = Infinity;
const extraHues = JSON.parse(/BRAND_EXTRA_HUES = (\[[\d, ]+\])/.exec(contract)[1]);
for (const h of [...Array.from({ length: hueMax - hueMin + 1 }, (_, i) => hueMin + i), ...extraHues]) {
  for (const [name, base] of variants) {
    const vars = { ...base, ...(extraHues.includes(h) ? block(`:root[data-brand-palette="${h === 55 || h === 345 ? "warm" : "extended"}"]`) : {}), "--brand-h": String(h) };
    for (const [fgName, bgName, min, baseName] of PAIRS) {
      const under = baseName ? oklch(resolve(vars, vars[baseName])).rgb : [1, 1, 1];
      const bg = over(oklch(resolve(vars, vars[bgName])), under);
      const r = ratio(over(oklch(resolve(vars, vars[fgName])), bg), bg);
      if (min === TEXT) hueWorst = Math.min(hueWorst, r);
      if (r < min) {
        failed++;
        console.log(`  FAIL ${r.toFixed(2)} ≥ ${min}  оттенок ${h}, ${name}: ${fgName} on ${bgName}`);
      }
    }
  }
}
console.log(`\nоттенок бренда ${hueMin}…${hueMax}: все пары во всех темах, худший текст ${hueWorst.toFixed(2)}`);

// ── Текст хрома поверх фона (ТЗ 5.14, проверка «≥ 4.5:1 с подложкой»). Боковая панель — стекло (--glass-side)
// прямо над атмосферой; под ней — либо свечения фона галереи, либо своё фото под подложкой цвета рамки.
// Тестовый набор фото — ровные серые от чёрного до белого (худшие случаи для любой светлоты); плотность подложки —
// та же формула, что src/bgPhoto.ts scrimFor (SCRIM_MIN + SCRIM_RANGE × расхождение с темой).
const SCRIM_MIN = 30;
const SCRIM_RANGE = 58;
const GLOWS = ["--glow-a", "--glow-b", "--glow-c"];
const chrome = ["--text-1", "--text-2", "--text-3"];
for (const [name, vars, isDark] of variants) {
  const frame = oklch(resolve(vars, vars["--bg-frame"])).rgb;
  const bases = [];
  for (const luma of [0, 0.25, 0.5, 0.75, 1]) {
    const photo = [1, 1, 1].map(() => toLinear(luma));
    const pct = SCRIM_MIN + SCRIM_RANGE * (isDark ? luma : 1 - luma);
    bases.push([`фото ${luma}`, over({ rgb: frame, alpha: pct / 100 }, photo)]);
  }
  // Свечения фона: каждое по отдельности во всю силу поверх рамки (в углах они не складываются все три).
  for (const g of GLOWS) bases.push([`свечение ${g}`, over(oklch(resolve(vars, vars[g])), frame)]);
  let worst = Infinity;
  for (const [label, base] of bases) {
    const glass = over(oklch(resolve(vars, vars["--glass-side"])), base);
    for (const t of chrome) {
      const r = ratio(over(oklch(resolve(vars, vars[t])), glass), glass);
      worst = Math.min(worst, r);
      if (r < TEXT) {
        failed++;
        console.log(`  FAIL ${r.toFixed(2)} ≥ ${TEXT}  ${name}: ${t} на стекле боковой панели над «${label}»`);
      }
    }
  }
  console.log(`  ${name}: текст боковой панели над фото/свечениями — худший ${worst.toFixed(2)}`);
}

if (failed) {
  console.error(`\n${failed} pair(s) below threshold`);
  process.exit(1);
}
console.log("\nall pairs pass");
