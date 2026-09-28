#!/usr/bin/env node
// ТЗ 5.16 п.5 — анти-список DESIGN.md («Нельзя»), та часть, что проверяется текстом:
//   1) капс-подписи: класс `uppercase` / `text-transform: uppercase` (кроме `first-letter:uppercase` — это
//      заглавная первая буква, регистр предложения) и слова капсом в словарях (кроме аббревиатур);
//   2) стрелка «→» в конце строки словаря — так выглядит текст кнопки «Далее →».
// Остальное из анти-списка (стекло на карточках, градиент-украшение, моно для всего мелкого) текстом не ловится —
// это визуальный обзор. Мутационная проверка: добавить `uppercase` в любой className — скрипт падает.
//
// Запуск: node scripts/check-antilist.mjs   (npm run antilist:check)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
/** Аббревиатуры и коды, которые пишутся капсом по праву. */
const ABBR = new Set(["LDAP", "CSV", "API", "PNG", "WEBP", "JPG", "JPEG", "GIF", "SVG", "JSON", "JSONL", "SIEM", "ID", "URL", "UUID", "HTTP", "HTTPS", "S3", "SMTP", "AD", "DN", "IT", "HR", "QA", "UI", "CEO", "SLA", "SSO", "PDF", "ZIP", "RGB", "WCAG", "OK", "VPN", "ERP", "CRM", "CORP", "KPI", "MVP", "PR", "CI", "TLS", "SSL", "DNS", "IP", "ISO", "СНГ", "ТЗ", "НДС", "ИНН", "ООО", "РФ", "US", "NDJSON", "KB", "MB", "GB", "КБ", "МБ", "ГБ"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}
const errors = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/dev/")) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      const code = line.replace(/first-letter:uppercase/g, "").replace(/normal-case/g, "");
      if (/(^|[\s"'`:])uppercase([\s"'`]|$)/.test(code) || /text-transform:\s*uppercase/.test(code))
        errors.push(`${rel}:${i + 1}: капс-подпись (uppercase) — DESIGN.md «Нельзя»; регистр предложения`);
    });
}
for (const dict of ["src/i18n/ru.ts", "src/i18n/en.ts"]) {
  readFileSync(join(ROOT, dict), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const m = /^\s*"[^"]+":\s*"(.*)",\s*$/.exec(line);
      if (!m) return;
      const text = m[1];
      // Имена переменных окружения и файлов (AUTH_MODE=ldap, LDAP_SETUP.md) — не подписи: токены с «_», «.», «=» пропускаются.
      for (const tok of text.split(/[\s,;:()«»"'…—/]+/)) {
        if (/[_.=]/.test(tok)) continue;
        for (const w of tok.match(/\p{Lu}{2,}/gu) ?? []) if (!ABBR.has(w.toUpperCase())) errors.push(`${dict}:${i + 1}: слово капсом «${w}»`);
      }
      if (/→\s*$/.test(text)) errors.push(`${dict}:${i + 1}: стрелка «→» в конце текста — DESIGN.md «Нельзя»`);
    });
}
if (errors.length) {
  console.log(errors.join("\n"));
  console.error(`\n${errors.length} нарушени(й) анти-списка DESIGN.md`);
  process.exit(1);
}
console.log("анти-список: капс-подписей и стрелок в текстах кнопок нет");
