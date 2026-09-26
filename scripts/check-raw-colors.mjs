#!/usr/bin/env node
// ТЗ 5.4 п.4 — сырые цвета вне файла токенов роняют CI. Компоненты берут цвет
// только из токенов (классы Tailwind на токенах или var(--…)): иначе цвет не
// переключится с темой. Мутационная проверка: добавить "#ff0000" в любой
// компонент — скрипт падает.
//
// Запуск: node scripts/check-raw-colors.mjs   (npm run colors:check)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

/** Явные исключения с причинами. Путь → причина. */
const ALLOW = {
  // Цвет направления хранится в БД как hex (contract.ts: /^#[0-9a-f]{6}$/) —
  // это данные пользователя, а не оформление; палитра = палитра проектов ТЗ 5.3.
  "src/components/IssueModal.tsx": "DIRECTION_COLORS — hex хранится в БД",
};

const PATTERNS = [
  { re: /#[0-9a-fA-F]{3,8}\b(?![\w-])/g, what: "hex" },
  { re: /\brgba?\(/g, what: "rgb()" },
  { re: /\bhsla?\(/g, what: "hsl()" },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

let failed = 0;
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (rel === "src/styles/tokens.css") continue; // единственный дом сырых значений
  if (ALLOW[rel]) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Комментарии не считаются: в них допустимо ссылаться на старые значения.
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (/^\s*\*/.test(line)) return;
    for (const { re, what } of PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(code);
      // #1, #2 в строках вида "задача #12" — не цвет: требуем hex-букву или длину 6/8.
      if (m && (what !== "hex" || /[a-fA-F]/.test(m[0]) || m[0].length === 7 || m[0].length === 9)) {
        failed++;
        console.log(`${rel}:${i + 1}: raw ${what} ${m[0]} — используйте токен (src/styles/tokens.css)`);
      }
    }
  });
}
if (failed) {
  console.error(`\n${failed} raw colour(s) outside the token file`);
  process.exit(1);
}
console.log("no raw colours outside tokens");
