import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * OPS-PG-01: путь отказа на старом PostgreSQL. Настоящую БД версии 13 в тесте не поднять, поэтому запрос
 * `server_version_num` ВЫПОЛНЯЕТСЯ на реальной БД (имя колонки в ответе — настоящее), а число версии в
 * строке результата подменяется. Так проверяются и имя колонки, и отказ.
 */
vi.mock("../src/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/db.js")>("../src/db.js");
  return {
    ...actual,
    q: async (text: string, params: unknown[] = []) => {
      const rows = (await actual.q(text, params)) as Record<string, unknown>[];
      if (!/server_version_num/.test(text)) return rows;
      return rows.map((row) => Object.fromEntries(Object.keys(row).map((k) => [k, "130012"])));
    },
  };
});

import { closePool, initPool } from "../src/db.js";
import { assertSupportedPostgres, resetPgVersionCache } from "../src/services/pgVersion.js";
import { TEST_DB_URL } from "./env.js";

describe("отказ на PostgreSQL ниже минимума", () => {
  afterAll(closePool);

  it("assertSupportedPostgres бросает документированное сообщение", async () => {
    initPool(TEST_DB_URL);
    resetPgVersionCache();
    await expect(assertSupportedPostgres()).rejects.toThrow(
      /PostgreSQL 13\.12 не поддерживается: нужна версия 14 или новее .*OPERATIONS\.md/,
    );
  });
});
