#!/usr/bin/env node
// ТЗ 5.13 п.4 — правила движения, проверяемые в CI (ADR-0015):
//   1) длительности — только токены --dur-1…5 (100/150/200/300/450 мс): в CSS — var(--dur-N), в классах Tailwind —
//      duration-100/150/200/300 (те же значения), в WAAPI (`duration: N`) — не больше 450;
//   2) ничего дольше 450 мс — кроме бесконечных индикаторов загрузки/процесса из ALLOW_LOOPS (они не переход, а
//      состояние) и полоски таймера тоста (длина = время жизни тоста, не анимация перехода);
//   3) всё, что двигает (transform, размеры, позиция, stroke-dashoffset…), при prefers-reduced-motion переопределено —
//      мгновенно или только прозрачность.
// Мутационная проверка: поставить `animation: dialogIn 600ms` или `duration-500` — скрипт падает; убрать
// `.anim-dialog` из блока reduced-motion — падает.
//
// Запуск: node scripts/check-motion.mjs   (npm run motion:check)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const TOKENS_MS = [100, 150, 200, 300, 450];
const MAX_MS = 450;
/** Бесконечные индикаторы: спиннер, неопределённый прогресс, блик скелетона, бегущий пунктир ребра под курсором. */
const ALLOW_LOOPS = new Set(["dsSpin", "dsIndet", "dsShimmer", "shimmer", "wfFlow"]);
/** Не переход, а таймер: ширина полоски = оставшееся время жизни тоста. */
const ALLOW_TIMERS = new Set(["dsToastBar"]);
const MOVING = /\b(transform|translate|scale|rotate|left|top|right|bottom|width|height|margin[\w-]*|background-position|stroke-dashoffset|clip-path|inset)\s*:/;

function* walk(dir, re) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, re);
    else if (re.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}
const errors = [];
const ms = (v, unit) => (unit === "s" ? parseFloat(v) * 1000 : parseFloat(v));
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// --- CSS ---------------------------------------------------------------------------------------------
const keyframes = new Map(); // имя → двигает ли
const rules = []; // { file, selector, body, reduced }
for (const file of walk(SRC, /\.css$/)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (rel === "src/styles/tokens.css") continue;
  const css = stripComments(readFileSync(file, "utf8"));
  // Простой разбор на правила верхнего уровня и внутри @media: достаточно для плоского CSS проекта.
  const walkBlock = (text, reduced) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0, j++;
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@keyframes")) keyframes.set(head.split(/\s+/)[1], MOVING.test(body));
      else if (head.startsWith("@media") || head.startsWith("@layer") || head.startsWith("@supports"))
        walkBlock(body, reduced || /prefers-reduced-motion:\s*reduce/.test(head));
      else if (!head.startsWith("@")) rules.push({ file: rel, selector: head.split("\n").pop().trim(), selectors: head, body, reduced });
      i = j;
    }
  };
  walkBlock(css, false);
}

const reducedSelectors = rules.filter((r) => r.reduced).flatMap((r) => r.selectors.split(",").map((s) => s.trim()));
for (const r of rules) {
  if (r.reduced) continue;
  for (const decl of r.body.split(";")) {
    const m = /^\s*(animation|animation-duration|transition|transition-duration)\s*:\s*([\s\S]+)$/.exec(decl);
    if (!m) continue;
    const value = m[2].replace(/var\(--[\w-]+,\s*[^)]*\)/g, "var()"); // фолбэк внутри var() — не значение
    for (const part of value.split(/,(?![^(]*\))/)) {
      const name = m[1].startsWith("animation") ? (part.trim().split(/\s+/).find((w) => keyframes.has(w)) ?? "") : "";
      const t = /(?:^|\s)(\d*\.?\d+)(ms|s)\b/.exec(part); // первое время в части — длительность
      if (!t) continue;
      const v = ms(t[1], t[2]);
      if (ALLOW_TIMERS.has(name) || (ALLOW_LOOPS.has(name) && /infinite/.test(part))) continue;
      errors.push(`${r.file}: «${r.selector}» — ${part.trim()}: длительность ${v} мс литералом; нужен var(--dur-1…5)${v > MAX_MS ? ", и не дольше 450 мс" : ""}`);
    }
    // Двигающая анимация обязана быть переопределена под reduced-motion.
    if (m[1] === "animation") {
      const moving = value.split(/,(?![^(]*\))/).some((p) => p.trim().split(/\s+/).some((w) => keyframes.get(w) && !ALLOW_LOOPS.has(w) && !ALLOW_TIMERS.has(w)));
      const covered = r.selectors.split(",").every((s) => reducedSelectors.includes(s.trim()));
      if (moving && !covered) errors.push(`${r.file}: «${r.selector}» двигает (${value.trim()}), но не переопределён в @media (prefers-reduced-motion: reduce)`);
    }
  }
}

// --- TSX/TS: классы Tailwind и WAAPI ----------------------------------------------------------------------
for (const file of walk(SRC, /\.tsx?$/)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (rel.startsWith("src/dev/")) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(/\bduration-(\d+)\b/g))
        if (!TOKENS_MS.includes(+m[1])) errors.push(`${rel}:${i + 1}: duration-${m[1]} — не токен (100/150/200/300)`);
      for (const m of line.matchAll(/\bduration-\[([^\]]+)\]/g))
        if (!/^var\(--dur-[1-5]\)$/.test(m[1])) errors.push(`${rel}:${i + 1}: duration-[${m[1]}] — только var(--dur-1…5)`);
      for (const m of line.matchAll(/\bduration:\s*(\d+)/g))
        if (+m[1] > MAX_MS) errors.push(`${rel}:${i + 1}: WAAPI duration ${m[1]} мс > 450`);
    });
}

if (errors.length) {
  console.log(errors.join("\n"));
  console.error(`\n${errors.length} нарушени(й) правил движения (ТЗ 5.13, ADR-0015)`);
  process.exit(1);
}
console.log(`motion: ${rules.length} правил CSS, ${keyframes.size} keyframes — длительности из токенов, ≤ 450 мс, reduced-motion покрыт`);
