#!/usr/bin/env node
// ТЗ 5.4 п.7 — автоматическая проверка контраста семантических пар
// текст/фон в обеих темах. Читает src/styles/tokens.css, резолвит var()
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

const css = stripAtRules(
  readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
);

/** Декларации из блоков с точно таким селектором. */
function block(selector) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
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
for (const [name, vars] of [
  ["light", light],
  ["dark", dark],
]) {
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
if (failed) {
  console.error(`\n${failed} pair(s) below threshold`);
  process.exit(1);
}
console.log("\nall pairs pass");
