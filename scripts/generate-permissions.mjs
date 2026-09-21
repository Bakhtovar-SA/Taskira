#!/usr/bin/env node
/**
 * ТЗ 2.2: единый источник матрицы прав — shared/permissions.matrix.json.
 * Из него генерируются (и только так меняются):
 *   src/permissions.matrix.ts, server/src/permissions.matrix.ts — одинаковое содержимое (MATRIX, PermId, имена);
 *   docs/PERMISSIONS.md — таблица прав для документации.
 *
 * Почему генерация, а не общий импорт: сервер собирается из контекста server/ (server/Dockerfile, tsconfig
 * rootDir=src), клиент — из корня с .dockerignore, исключающим server/; файл вне обоих контекстов в одну из сборок
 * не попадёт. Поэтому общий источник — данные, а обе копии порождаются машинно и сверяются в CI.
 *
 *   node scripts/generate-permissions.mjs           — записать файлы
 *   node scripts/generate-permissions.mjs --check   — упасть (код 1), если файлы не совпадают с источником
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "shared/permissions.matrix.json"), "utf8"));

function validate(src) {
  const roleIds = src.roles.map((r) => r.id);
  const permIds = src.permissions.map((p) => p.id);
  if (new Set(roleIds).size !== roleIds.length) throw new Error("дубликаты ролей");
  if (new Set(permIds).size !== permIds.length) throw new Error("дубликаты разрешений");
  for (const p of src.permissions) {
    if (!p.roles.length) throw new Error(`у разрешения «${p.id}» нет ролей`);
    for (const r of p.roles) if (!roleIds.includes(r)) throw new Error(`разрешение «${p.id}»: неизвестная роль «${r}»`);
  }
}
validate(source);

const q = (s) => JSON.stringify(s);
const roleIds = source.roles.map((r) => r.id);
const permIds = source.permissions.map((p) => p.id);

const ts = `/* GENERATED from shared/permissions.matrix.json by scripts/generate-permissions.mjs — DO NOT EDIT.
 * Меняйте shared/permissions.matrix.json и запускайте \`npm run permissions:generate\` (ТЗ 2.2).
 * Одинаковое содержимое лежит в src/ и server/src/: CI (\`npm run permissions:check\`) падает при расхождении. */

export const ROLE_IDS = [${roleIds.map(q).join(", ")}] as const;
export type AccessRole = (typeof ROLE_IDS)[number];

export const PERM_IDS = [${permIds.map(q).join(", ")}] as const;
export type PermId = (typeof PERM_IDS)[number];

/** Разрешение → роли, которым оно доступно (уровень задачи для employee сужается в permissions.ts). */
export const MATRIX: Record<PermId, readonly AccessRole[]> = {
${source.permissions.map((p) => `  ${p.id}: [${p.roles.map(q).join(", ")}],`).join("\n")}
};

export const ROLE_NAMES: Record<AccessRole, string> = {
${source.roles.map((r) => `  ${r.id}: ${q(r.name)},`).join("\n")}
};

export const ROLE_DESCRIPTIONS: Record<AccessRole, string> = {
${source.roles.map((r) => `  ${r.id}: ${q(r.desc)},`).join("\n")}
};

export type PermScope = ${[...new Set(source.permissions.map((p) => p.scope))].map(q).join(" | ")};

export const PERM_META: Record<PermId, { name: string; desc: string; scope: PermScope }> = {
${source.permissions.map((p) => `  ${p.id}: { name: ${q(p.name)}, desc: ${q(p.desc)}, scope: ${q(p.scope)} },`).join("\n")}
};
`;

const cell = (has) => (has ? "✔" : "—");
const md = `<!-- GENERATED from shared/permissions.matrix.json by scripts/generate-permissions.mjs — DO NOT EDIT. -->
# Матрица прав доступа

Таблица порождается из \`shared/permissions.matrix.json\` (\`npm run permissions:generate\`); руками не редактируется.
Сервер — источник истины, клиент использует ту же матрицу только для подсказок интерфейса.

Эффективная роль: глобальный \`admin\` → «${source.roles[0].name}»; иначе проектная роль (\`manager\` / \`employee\` /
\`viewer\`); не участник проекта — доступа нет. Права **Редактирование задач** и **Смена статуса** у роли
«${source.roles.find((r) => r.id === "employee").name}» ограничены задачами, где пользователь исполнитель или автор.

| Разрешение | Область | ${source.roles.map((r) => r.name).join(" | ")} | Описание |
|---|---|${source.roles.map(() => ":---:").join("|")}|---|
${source.permissions.map((p) => `| ${p.name} (\`${p.id}\`) | ${p.scope} | ${source.roles.map((r) => cell(p.roles.includes(r.id))).join(" | ")} | ${p.desc} |`).join("\n")}

## Роли

${source.roles.map((r) => `- **${r.name}** (\`${r.id}\`) — ${r.desc}`).join("\n")}
`;

const outputs = [
  ["src/permissions.matrix.ts", ts],
  ["server/src/permissions.matrix.ts", ts],
  ["docs/PERMISSIONS.md", md],
];
const norm = (s) => s.replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([path, content]) => {
    const file = join(root, path);
    return !existsSync(file) || norm(readFileSync(file, "utf8")) !== content;
  });
  if (stale.length) {
    process.stderr.write(
      `Права рассинхронизированы с shared/permissions.matrix.json: ${stale.map(([p]) => p).join(", ")}.\n` +
        "Запустите: npm run permissions:generate (и не правьте сгенерированные файлы руками).\n",
    );
    process.exit(1);
  }
  console.log("permissions: ok");
} else {
  for (const [path, content] of outputs) writeFileSync(join(root, path), content);
  console.log(`permissions: записано ${outputs.length} файла`);
}
