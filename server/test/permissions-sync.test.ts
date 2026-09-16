/**
 * Синхронность клиентской и серверной копий модели прав и лимитов.
 *
 * `src/permissions.ts` и `server/src/permissions.ts` намеренно держат одну и ту
 * же MATRIX: клиенту она нужна для мгновенной реакции интерфейса, серверу — как
 * источник истины. Решение оправдано, но до сих пор соблюдение правила «менять
 * в двух местах синхронно» ничем не проверялось (аудит DEBT-01), а тестов на
 * клиенте нет вовсе.
 *
 * Рассинхрон не пробивает безопасность — сервер всё равно перепроверит каждую
 * мутацию, — но даёт худший для доверия класс багов: кнопка есть, нажимаешь,
 * получаешь отказ. Или наоборот: право есть, а кнопки нет.
 *
 * Тест живёт в серверном наборе, потому что он единственный в проекте. Файл
 * клиента читается с диска и разбирается текстом — тащить сборку фронтенда
 * в серверные тесты ради этого не нужно.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MATRIX_FOR_TESTS, PERM_IDS_FOR_TESTS } from "../src/permissions.js";
import { LIMITS as SERVER_LIMITS } from "../src/contract.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

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

describe("матрица прав: клиент ↔ сервер", () => {
  const clientSource = read("src/permissions.ts");
  const clientMatrix = extractObject(clientSource, "const MATRIX") as Record<string, string[]>;

  test("наборы разрешений совпадают", () => {
    expect(Object.keys(clientMatrix).sort()).toEqual([...PERM_IDS_FOR_TESTS].sort());
  });

  test("у каждого разрешения одинаковый набор ролей", () => {
    for (const perm of PERM_IDS_FOR_TESTS) {
      expect([...(clientMatrix[perm] ?? [])].sort(), `разрешение «${perm}» разошлось`).toEqual(
        [...MATRIX_FOR_TESTS[perm]].sort(),
      );
    }
  });

  test("правило «своей» задачи описано на обеих сторонах", () => {
    // Сужение edit для employee — вторая половина модели, и она тоже
    // продублирована. Проверяем хотя бы наличие одноимённой функции.
    expect(clientSource).toContain("isOwnIssue");
    // Клиент сравнивает с user.id, сервер — с userId; проверяем саму суть
    // правила: «своя» = я исполнитель ИЛИ я автор, обе половины на месте.
    const rule = clientSource.slice(clientSource.indexOf("isOwnIssue"));
    expect(rule).toMatch(/assigneeIds\.includes/);
    expect(rule).toMatch(/reporterId ===/);
    expect(rule).toMatch(/\|\|/);
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
