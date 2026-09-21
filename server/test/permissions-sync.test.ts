/**
 * Единый источник прав и синхронность клиента с сервером (ТЗ 2.2), плюс синхронность лимитов валидации.
 *
 * Матрица прав живёт в shared/permissions.matrix.json; src/permissions.matrix.ts и server/src/permissions.matrix.ts
 * (и docs/PERMISSIONS.md) ГЕНЕРИРУЮТСЯ из неё (scripts/generate-permissions.mjs). Общий импорт невозможен: сервер
 * собирается из контекста server/ (Dockerfile, rootDir=src), клиент — из корня без server/ — поэтому общий
 * источник — данные, а тест/CI сверяют, что обе копии — ровно то, что порождает источник. Логика поверх матрицы
 * (резолв роли, правило «своей» задачи, тексты отказов) продублирована в коде и проверяется здесь по ПОВЕДЕНИЮ на
 * всех комбинациях роль × право × «своя/чужая».
 *
 * Лимиты валидации (src/validation.ts ↔ server/src/contract.ts) по-прежнему сверяются разбором файла клиента.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MATRIX, PERM_IDS, ROLE_IDS } from "../src/permissions.matrix.js";
import { ACCESS_ROLES as CONTRACT_ROLES, LIMITS as SERVER_LIMITS } from "../src/contract.js";
import { can as serverCan, denialReason as serverDenial, type IssueRef, type Membership } from "../src/permissions.js";
import { can as clientCan, denialReason as clientDenial } from "../../src/permissions.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const norm = (s: string) => s.replace(/\r\n/g, "\n");

/** Вытаскивает объект-литерал по имени из исходника и парсит его как JS. */
function extractObject(source: string, declaration: string): Record<string, unknown> {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`не найдено объявление ${declaration}`);
  const from = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`не удалось разобрать литерал ${declaration}`);
  const literal = source
    .slice(from, end)
    .replace(/\/\*[\s\S]*?\*\//g, "") // блочные комментарии
    .replace(/\/\/[^\n]*/g, "") // строчные
    .replace(/,(\s*[}\]])/g, "$1"); // висячие запятые
  return Function(`"use strict"; return (${literal});`)() as Record<string, unknown>;
}

describe("матрица прав: единый источник", () => {
  const source = JSON.parse(read("shared/permissions.matrix.json")) as {
    roles: { id: string }[];
    permissions: { id: string; roles: string[] }[];
  };

  test("сгенерированные файлы совпадают с источником (тот же чек, что в CI)", () => {
    const r = spawnSync(process.execPath, [join(repoRoot, "scripts", "generate-permissions.mjs"), "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });

  test("клиентская и серверная копии матрицы побайтно одинаковы", () => {
    expect(norm(read("src/permissions.matrix.ts"))).toBe(norm(read("server/src/permissions.matrix.ts")));
  });

  test("серверная MATRIX и роли — ровно данные источника", () => {
    expect([...PERM_IDS]).toEqual(source.permissions.map((p) => p.id));
    expect([...ROLE_IDS]).toEqual(source.roles.map((r) => r.id));
    for (const p of source.permissions) expect([...MATRIX[p.id as keyof typeof MATRIX]], p.id).toEqual(p.roles);
  });

  test("ACCESS_ROLES в contract.ts (ответы API) совпадает с ролями источника", () => {
    expect([...CONTRACT_ROLES]).toEqual([...ROLE_IDS]);
  });
});

describe("модель прав: поведение клиента и сервера совпадает", () => {
  // Все комбинации: роль × право × (нет задачи | своя как исполнитель | своя как автор | чужая).
  const issues: (IssueRef | undefined)[] = [
    undefined,
    { id: "i", assigneeIds: ["me"], reporterId: "other" },
    { id: "i", assigneeIds: ["x"], reporterId: "me" },
    { id: "i", assigneeIds: ["x", "y"], reporterId: "other" },
  ];
  const cases = ROLE_IDS.flatMap((role) => PERM_IDS.flatMap((perm) => issues.map((issue) => ({ role, perm, issue }))));

  const asServer = (role: (typeof ROLE_IDS)[number]) => ({
    user: { id: "me", globalRole: role === "admin" ? ("admin" as const) : ("member" as const) },
    membership: (role === "admin" ? null : { projectId: "p", role }) as Membership,
  });
  const asClient = (role: (typeof ROLE_IDS)[number]) => ({ id: "me", accessRole: role }) as never;
  const clientIssue = (i: IssueRef | undefined) => (i ? ({ id: i.id, assigneeIds: i.assigneeIds, reporterId: i.reporterId } as never) : undefined);

  test("can(): одинаковый ответ на всех комбинациях", () => {
    expect(cases.length).toBeGreaterThan(100);
    for (const { role, perm, issue } of cases) {
      const s = asServer(role);
      expect(clientCan(asClient(role), perm, clientIssue(issue)), `${role}/${perm}/${JSON.stringify(issue)}`).toBe(
        serverCan(s.user, s.membership, perm, issue),
      );
    }
  });

  test("denialReason(): одинаковый русский текст отказа на всех комбинациях", () => {
    for (const { role, perm, issue } of cases) {
      const s = asServer(role);
      expect(clientDenial(asClient(role), perm, clientIssue(issue), "ru"), `${role}/${perm}/${JSON.stringify(issue)}`).toBe(
        serverDenial(s.user, s.membership, perm, issue),
      );
    }
  });
});

describe("лимиты валидации: клиент ↔ сервер", () => {
  const clientLimits = extractObject(read("src/validation.ts"), "export const LIMITS") as Record<string, unknown>;

  test("совпадают поля, которые есть на обеих сторонах", () => {
    // Клиент не знает про серверные лимиты вложений и наоборот — сверяем
    // пересечение, а не полное равенство.
    const shared = Object.keys(clientLimits).filter((k) => k in SERVER_LIMITS);
    expect(shared.length).toBeGreaterThan(4); // защита от «пересечение вдруг стало пустым»
    for (const key of shared) {
      expect(clientLimits[key], `лимит «${key}» разошёлся`).toEqual(
        (SERVER_LIMITS as Record<string, unknown>)[key],
      );
    }
  });
});
