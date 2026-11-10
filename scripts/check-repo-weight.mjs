#!/usr/bin/env node
// Ограничитель веса репозитория. docs/ занимает десятки мегабайт — почти всё это снимки экранов
// датированных аудитов (docs/design/*-2026-*). Удаление, пережатие или перенос в Git LFS уже
// закоммиченных файлов размер истории не уменьшит (старые объекты остаются, пережатые добавляются),
// поэтому существующее не трогаем, а рост ограничиваем здесь:
//   - docs/ целиком не больше DOCS_LIMIT_MB;
//   - один файл в docs/ не больше FILE_LIMIT_KB.
// Новые снимки для аудита кладите в артефакты CI или прикладывайте к PR, в репозиторий — только те,
// на которые ссылается документ. Поднимать лимиты — осознанно, с записью причины в этом файле.
//
//   node scripts/check-repo-weight.mjs      (входит в npm run docs:check)
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_LIMIT_MB = 68; // 10.11.2026: 61.2 МБ; запас на текстовые документы и отдельные снимки
const FILE_LIMIT_KB = 1024; // 10.11.2026: самый большой файл — 472 КБ

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push({ path: relative(root, path), size: statSync(path).size });
  }
})(join(root, "docs"));

const total = files.reduce((sum, file) => sum + file.size, 0);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const tooBig = files.filter((file) => file.size > FILE_LIMIT_KB * 1024);
let failed = false;
if (total > DOCS_LIMIT_MB * 1024 * 1024) {
  failed = true;
  console.error(`docs/ весит ${mb(total)} МБ — больше лимита ${DOCS_LIMIT_MB} МБ.`);
}
for (const file of tooBig) {
  failed = true;
  console.error(`${file.path}: ${(file.size / 1024).toFixed(0)} КБ — больше лимита ${FILE_LIMIT_KB} КБ на файл.`);
}
if (failed) {
  console.error("Снимки и сырые замеры держите вне репозитория (артефакты CI, вложения PR); см. комментарий в scripts/check-repo-weight.mjs.");
  process.exit(1);
}
console.log(`repo weight: docs/ ${mb(total)} МБ из ${DOCS_LIMIT_MB} МБ, файлов больше ${FILE_LIMIT_KB} КБ нет`);
